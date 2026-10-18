import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  CircleStop,
  History,
  Mic,
  Paperclip,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { nodeTitle, uid } from '../../../shared/project';
import { findStyle } from '../../../shared/styles';
import type { AgentStreamEvent, ChatMessageView, ChatThreadSummary, MediaNode, ToolCardState } from '../../../shared/types';
import { api, streamAgent } from '../../lib/api';
import {
  TOOL_LABELS,
  canvasSummary,
  describeToolArgs,
  discardPlannedGeneration,
  executeAgentTool,
  isGenerationTool,
  planAgentGeneration,
  runPlannedGeneration,
  type ToolResult,
} from '../../lib/agentTools';
import { pickFiles, uploadFilesToCanvas, zoomToFit } from '../../lib/canvasOps';
import { costPhrase, estimateGenerations, formatUsd, getAgentBudget, overBudgetReason, roundUsd, sumEstimates } from '../../lib/cost';
import { useSpeech } from '../../lib/speech';
import { onAskAgent } from '../../lib/events';
import { useProject, type View } from '../../store/project';
import { toast, useUi } from '../../store/ui';
import { Popover, anchorBelow, type Anchor } from '../ui/Menu';
import { PENDING_PROMPT_KEY } from '../../pages/Home';
import './chat.css';

type Approval = 'auto' | 'ask';
const APPROVAL_KEY = 'claquete.approvalMode';

const VIEW_LABEL: Record<View, string> = { canvas: 'Tela', story: 'História', stage: 'Set 3D', editor: 'Editor de Vídeo' };

const SAMPLES = [
  'Me mostre 4 enquadramentos para uma cena de estação de trem à noite.',
  'Escreva uma sinopse de 1 minuto e quebre em planos.',
  'Crie a ficha do personagem principal com 3 ângulos.',
  'Monte a linha do tempo com os vídeos prontos.',
];

export function ChatPanel({ view }: { view: View }) {
  const collapsed = useUi((s) => s.chatCollapsed);
  const projectId = useProject((s) => s.project?.projectId ?? '');
  const attachments = useProject((s) => s.chatAttachments);
  const nodes = useProject((s) => s.project?.nodes);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState<{ runId?: string; controller: AbortController } | null>(null);
  const [approval, setApproval] = useState<Approval>(() => (localStorage.getItem(APPROVAL_KEY) as Approval) || 'auto');
  const [historyMenu, setHistoryMenu] = useState<Anchor | null>(null);
  const [refMenu, setRefMenu] = useState<Anchor | null>(null);
  const [approvalMenu, setApprovalMenu] = useState<Anchor | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const runIdRef = useRef<string | undefined>(undefined);
  const approvals = useRef(new Map<string, (ok: boolean) => void>());
  // estimated spend of the current response, started or awaiting approval (Auto mode limit)
  const spentRef = useRef(0);
  const speech = useSpeech((t) => setInput((v) => (v ? `${v} ${t}` : t)));

  const loadThreads = useCallback(() => api.threads(projectId).then(setThreads).catch(() => undefined), [projectId]);

  useEffect(() => {
    if (!projectId) return;
    loadThreads().then(() => undefined);
    setThreadId(null);
    setMessages([]);
  }, [projectId, loadThreads]);

  // open the most recent thread on first load
  useEffect(() => {
    if (!threadId && threads.length && !messages.length && !running) openThread(threads[0].id);
  }, [threads]);

  // a prompt typed on the home screen
  useEffect(() => {
    if (!projectId) return;
    const raw = sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (!raw) return;
    try {
      const { projectId: pid, text } = JSON.parse(raw);
      if (pid === projectId && text) {
        sessionStorage.removeItem(PENDING_PROMPT_KEY);
        setTimeout(() => send(text, true), 300);
      }
    } catch {
      sessionStorage.removeItem(PENDING_PROMPT_KEY);
    }
  }, [projectId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // buttons elsewhere in the app can hand a request to the agent
  const sendRef = useRef<(t: string) => void>(() => undefined);
  sendRef.current = (t: string) => send(t);
  useEffect(
    () =>
      onAskAgent((t) => {
        useUi.getState().setChatCollapsed(false);
        sendRef.current(t);
      }),
    [],
  );

  async function openThread(id: string) {
    try {
      const t = await api.thread(projectId, id);
      setThreadId(t.id);
      setMessages(t.messages);
    } catch (e) {
      toast(String((e as Error).message), 'error');
    }
  }

  const newChat = () => {
    if (running) return;
    setThreadId(null);
    setMessages([]);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const patchAssistant = (id: string, fn: (m: ChatMessageView) => ChatMessageView) => setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const patchTool = (msgId: string, callId: string, patch: Partial<ToolCardState>) =>
    patchAssistant(msgId, (m) => ({ ...m, tools: (m.tools ?? []).map((t) => (t.callId === callId ? { ...t, ...patch } : t)) }));

  async function handleToolCall(msgId: string, ev: Extract<AgentStreamEvent, { type: 'tool_call' }>) {
    const runId = runIdRef.current!;
    let result: ToolResult;
    try {
      result = isGenerationTool(ev.name) ? await priceAndGenerate(runId, msgId, ev) : await executeAgentTool(ev.name, ev.args);
    } catch (e) {
      result = { ok: false, error: String((e as Error).message ?? e) };
    }
    await api.toolResult(runId, ev.callId, result).catch(() => undefined);
  }

  /** Lays the nodes out, prices them, waits for approval when needed, then generates. */
  async function priceAndGenerate(runId: string, msgId: string, ev: Extract<AgentStreamEvent, { type: 'tool_call' }>): Promise<ToolResult> {
    const plan = planAgentGeneration(ev.name, ev.args);
    if ('error' in plan) return { ok: false, error: plan.error };
    patchTool(msgId, ev.callId, { estimating: true, nodeIds: plan.nodeIds });
    const prices = await estimateGenerations(plan.nodeIds);
    if (runIdRef.current !== runId) {
      // stopped while pricing: nothing left to approve
      discardPlannedGeneration(plan);
      patchTool(msgId, ev.callId, { estimating: false, status: 'rejected', nodeIds: undefined });
      return { ok: false, rejected: true, error: 'cancelado pelo usuário' };
    }
    const priced = Object.values(prices);
    const cost = priced.length ? sumEstimates(priced) : undefined;
    // Auto asks too when the response would pass the limit or the price is unknown
    const reason = cost && approval === 'auto' ? overBudgetReason(cost, spentRef.current, getAgentBudget()) : undefined;
    const ask = ev.needsApproval || !!reason;
    // reserved before any await, so parallel calls count each other
    const reserved = cost?.usd ?? 0;
    spentRef.current = roundUsd(spentRef.current + reserved);
    patchTool(msgId, ev.callId, { estimating: false, cost: cost && { ...cost, reason, responseUsd: spentRef.current }, status: ask ? 'pending_approval' : 'running' });

    if (ask) {
      const ok = await new Promise<boolean>((resolve) => approvals.current.set(ev.callId, resolve));
      approvals.current.delete(ev.callId);
      if (!ok) {
        spentRef.current = roundUsd(spentRef.current - reserved);
        discardPlannedGeneration(plan);
        patchTool(msgId, ev.callId, { status: 'rejected', nodeIds: undefined });
        return {
          ok: false,
          rejected: true,
          error: `o usuário recusou esta geração${cost ? ` (${costPhrase(cost)})` : ''}`,
          cost: cost && { ...cost, responseUsd: spentRef.current },
        };
      }
      patchTool(msgId, ev.callId, { status: 'running' });
    }

    const result = await runPlannedGeneration(plan, prices);
    // nodes refused before submission cost nothing: keep only what was sent
    spentRef.current = roundUsd(spentRef.current + (result.cost?.usd ?? 0) - reserved);
    return result.cost ? { ...result, cost: { ...result.cost, responseUsd: spentRef.current } } : result;
  }

  async function send(text: string, fromHome = false) {
    const st = useProject.getState();
    const p = st.project;
    if (!text.trim() || running || !p) return;
    const atts = st.chatAttachments
      .map((id) => p.nodes[id])
      .filter(Boolean)
      .map((n) => ({ nodeId: n.id, type: n.type, url: (n as MediaNode).data?.url, title: nodeTitle(n) }));
    const userMsg: ChatMessageView = { id: uid(), role: 'user', content: text, attachments: atts, createdAt: new Date().toISOString() };
    const placeholder: ChatMessageView = { id: uid(), role: 'assistant', content: '', tools: [], createdAt: new Date().toISOString() };
    setMessages((ms) => [...ms, userMsg, placeholder]);
    setInput('');
    st.setChatAttachments([]);
    const controller = new AbortController();
    setRunning({ controller });
    spentRef.current = 0;
    const budgetUsd = getAgentBudget();
    let msgId = placeholder.id;
    const style = findStyle(p.projectSettings.styleId, p.customStyles);
    try {
      await streamAgent(
        {
          projectId: p.projectId,
          threadId: threadId ?? undefined,
          message: text,
          attachments: atts,
          context: {
            projectName: p.name,
            canvasSummary: canvasSummary(p),
            memory: p.story.memory,
            styleName: style?.name,
            stylePrompt: style?.prompt,
            selectedNodeIds: atts.map((a) => a.nodeId),
            view: VIEW_LABEL[view],
            approvalMode: approval,
            budgetUsd,
          },
        },
        (ev) => {
          switch (ev.type) {
            case 'run': {
              runIdRef.current = ev.runId;
              setRunning((r) => (r ? { ...r, runId: ev.runId } : r));
              setThreadId(ev.threadId);
              // the updater runs later: capture the placeholder id now
              const placeholderId = msgId;
              setMessages((ms) => ms.map((m) => (m.id === placeholderId ? { ...m, id: ev.messageId } : m)));
              msgId = ev.messageId;
              break;
            }
            case 'delta':
              patchAssistant(msgId, (m) => ({ ...m, content: m.content + ev.text }));
              break;
            case 'tool_call':
              patchAssistant(msgId, (m) => ({ ...m, tools: [...(m.tools ?? []), { callId: ev.callId, name: ev.name, args: ev.args, status: ev.needsApproval ? 'pending_approval' : 'running' }] }));
              handleToolCall(msgId, ev);
              break;
            case 'tool_result':
              patchTool(msgId, ev.callId, {
                status: ev.rejected ? 'rejected' : ev.ok ? 'done' : 'failed',
                summary: ev.summary,
                error: ev.error,
                nodeIds: ev.nodeIds,
                ...(ev.cost ? { cost: ev.cost } : {}),
              });
              break;
            case 'suggestions':
              patchAssistant(msgId, (m) => ({ ...m, suggestions: ev.suggestions }));
              break;
            case 'choices':
              patchAssistant(msgId, (m) => ({ ...m, choices: { question: ev.question, options: ev.options } }));
              break;
            case 'error':
              patchAssistant(msgId, (m) => ({ ...m, content: `${m.content}${m.content ? '\n\n' : ''}⚠️ ${ev.message}` }));
              break;
            case 'done':
              loadThreads();
              break;
          }
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) patchAssistant(msgId, (m) => ({ ...m, content: `${m.content}\n\n⚠️ ${(e as Error).message}` }));
    } finally {
      setRunning(null);
      runIdRef.current = undefined;
      approvals.current.forEach((r) => r(false));
      approvals.current.clear();
      if (fromHome) setTimeout(() => zoomToFit(), 200);
    }
  }

  const stop = () => {
    if (!running) return;
    if (running.runId) api.cancelRun(running.runId).catch(() => undefined);
    running.controller.abort();
  };

  const selectNodes = (ids: string[]) => {
    const p = useProject.getState().project;
    const valid = ids.filter((id) => p?.nodes[id]);
    if (!valid.length) return;
    useProject.getState().select(valid);
    if (document.querySelector('.canvas-root')) zoomToFit(valid);
  };

  if (collapsed)
    return (
      <aside className="chat chat-collapsed">
        <button className="icon-btn" title="Abrir agente" onClick={() => useUi.getState().setChatCollapsed(false)}>
          <ChevronsLeft size={16} />
        </button>
      </aside>
    );

  const title = threads.find((t) => t.id === threadId)?.title ?? 'Novo chat';
  const last = messages[messages.length - 1];

  return (
    <aside className="chat">
      <div className="chat-head">
        <button className="icon-btn" title="Recolher painel" onClick={() => useUi.getState().setChatCollapsed(true)}>
          <ChevronsRight size={15} />
        </button>
        <button className="chat-title" onClick={(e) => setHistoryMenu(anchorBelow(e.currentTarget))} title="Histórico">
          <span>{title}</span> <ChevronDown size={12} />
        </button>
        <button className="icon-btn" title="Histórico" onClick={(e) => setHistoryMenu(anchorBelow(e.currentTarget, 'end'))}>
          <History size={14} />
        </button>
        <button className="icon-btn" title="Novo chat" onClick={newChat} disabled={!!running}>
          <Plus size={15} />
        </button>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {!messages.length && (
          <div className="chat-empty">
            <h3>Pergunte-me qualquer coisa</h3>
            <p className="muted">O agente lê e edita o canvas, escreve a História, gera imagens, vídeos e som, e monta a linha do tempo.</p>
            <div className="chat-samples">
              {SAMPLES.map((s) => (
                <button key={s} className="sample" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            {m.attachments && m.attachments.length > 0 && (
              <div className="msg-atts">
                {m.attachments.map((a) => (
                  <button key={a.nodeId} className="att" onClick={() => selectNodes([a.nodeId])} title={a.title}>
                    {a.type === 'image' && a.url ? <img src={a.url} alt="" /> : <span>{a.title}</span>}
                  </button>
                ))}
              </div>
            )}
            {m.content && (
              <div className="msg-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>
            )}
            {m.tools?.map((t) => (
              <ToolCard
                key={t.callId}
                tool={t}
                onSelect={selectNodes}
                onApprove={(ok) => {
                  approvals.current.get(t.callId)?.(ok);
                }}
              />
            ))}
            {m.role === 'assistant' && !m.content && !m.tools?.length && running && m === last && (
              <div className="thinking">
                <span className="spinner" /> pensando…
              </div>
            )}
            {m.choices && (
              <div className="choices">
                <p>{m.choices.question}</p>
                <div className="chips">
                  {m.choices.options.map((o) => (
                    <button key={o} className="chip chip-round" disabled={!!running || m !== last} onClick={() => send(o)}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {m.suggestions && m === last && !running && (
              <div className="chips">
                {m.suggestions.map((s) => (
                  <button key={s} className="chip chip-round" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="chat-input">
        {attachments.length > 0 && nodes && (
          <div className="input-atts">
            {attachments.map((id) => {
              const n = nodes[id];
              if (!n) return null;
              const url = (n as MediaNode).data?.url;
              return (
                <div key={id} className="att" title={nodeTitle(n)}>
                  {n.type === 'image' && url ? <img src={url} alt="" /> : n.type === 'video' && url ? <video src={url} muted /> : <span>{nodeTitle(n).slice(0, 14)}</span>}
                  <button className="x" onClick={() => useProject.getState().setChatAttachments(attachments.filter((a) => a !== id))}>
                    <X size={9} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <textarea
          ref={taRef}
          value={input}
          placeholder="Faça brainstorming ou crie qualquer coisa com o chat — @ para referenciar um recurso"
          onChange={(e) => {
            setInput(e.target.value);
            if (e.target.value.endsWith('@')) setRefMenu(anchorBelow(e.target));
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={3}
        />
        <div className="chat-input-bar">
          <div className="row">
            <button
              className="icon-btn"
              title="Anexar arquivo"
              onClick={async () => {
                const files = await pickFiles();
                if (!files.length) return;
                try {
                  const ids = await uploadFilesToCanvas(files);
                  useProject.getState().setChatAttachments([...useProject.getState().chatAttachments, ...ids]);
                } catch (e) {
                  toast(String((e as Error).message), 'error');
                }
              }}
            >
              <Paperclip size={14} />
            </button>
            <button className="icon-btn" title="Referenciar um recurso" onClick={(e) => setRefMenu(anchorBelow(e.currentTarget))}>
              <AtSign size={14} />
            </button>
          </div>
          <div className="row">
            <button className="chip" title="Modo de aprovação" onClick={(e) => setApprovalMenu(anchorBelow(e.currentTarget, 'end'))}>
              {approval === 'auto' ? 'Auto' : 'Perguntar'} <ChevronDown size={11} />
            </button>
            {speech.supported && (
              <button className={`icon-btn ${speech.listening ? 'active' : ''}`} title="Gravar voz" onClick={speech.toggle}>
                <Mic size={14} />
              </button>
            )}
            {running ? (
              <button className="send-btn" title="Parar" onClick={stop}>
                <CircleStop size={15} />
              </button>
            ) : (
              <button className="send-btn" title="Enviar" disabled={!input.trim()} onClick={() => send(input)}>
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {historyMenu && (
        <Popover anchor={historyMenu} onClose={() => setHistoryMenu(null)} width={290}>
          <div className="menu-title">Conversas</div>
          <button className="menu-item" onClick={() => (newChat(), setHistoryMenu(null))}>
            <Plus size={13} /> Novo chat
          </button>
          {threads.map((t) => (
            <div key={t.id} className={`menu-item ${t.id === threadId ? 'selected' : ''}`} style={{ cursor: 'pointer' }}>
              <span className="grow" onClick={() => (openThread(t.id), setHistoryMenu(null))} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.title}
              </span>
              <button
                className="icon-btn"
                style={{ width: 20, height: 20 }}
                title="Excluir conversa"
                onClick={async () => {
                  await api.deleteThread(projectId, t.id);
                  if (t.id === threadId) newChat();
                  loadThreads();
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </Popover>
      )}

      {refMenu && nodes && (
        <Popover anchor={refMenu} onClose={() => setRefMenu(null)} width={280}>
          <div className="menu-title">Anexar recurso do canvas</div>
          {Object.values(nodes)
            .filter((n) => n.type === 'text' || (n as MediaNode).data?.url)
            .slice(0, 40)
            .map((n) => (
              <button
                key={n.id}
                className="menu-item"
                onClick={() => {
                  useProject.getState().setChatAttachments([...new Set([...attachments, n.id])]);
                  setInput((v) => v.replace(/@$/, ''));
                  setRefMenu(null);
                  taRef.current?.focus();
                }}
              >
                {n.type === 'image' ? <img src={(n as MediaNode).data.url} alt="" style={{ width: 28, height: 20, objectFit: 'cover' }} /> : <span className="kbd">{n.type}</span>}
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {nodeTitle(n)}
                </span>
              </button>
            ))}
        </Popover>
      )}

      {approvalMenu && (
        <Popover anchor={approvalMenu} onClose={() => setApprovalMenu(null)} width={260}>
          {(
            [
              ['auto', 'Auto', `O agente gera direto. Pede confirmação acima de ${formatUsd(getAgentBudget())} por resposta ou sem estimativa de custo.`],
              ['ask', 'Perguntar', 'Cada geração (que consome créditos) espera sua aprovação, com o custo estimado.'],
            ] as const
          ).map(([v, l, d]) => (
            <button
              key={v}
              className={`menu-item ${approval === v ? 'selected' : ''}`}
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, whiteSpace: 'normal' }}
              onClick={() => {
                setApproval(v);
                localStorage.setItem(APPROVAL_KEY, v);
                setApprovalMenu(null);
              }}
            >
              <span>{l}</span>
              <small>{d}</small>
            </button>
          ))}
        </Popover>
      )}
    </aside>
  );
}

function ToolCard({ tool, onSelect, onApprove }: { tool: ToolCardState; onSelect: (ids: string[]) => void; onApprove: (ok: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABELS[tool.name] ?? tool.name;
  const detail = describeToolArgs(tool.name, tool.args);
  return (
    <div className={`tool-card ${tool.status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        {tool.status === 'running' || tool.status === 'pending_approval' ? (
          <span className="spinner" />
        ) : tool.status === 'done' ? (
          <Check size={13} />
        ) : (
          <CircleAlert size={13} />
        )}
        <span className="grow">
          {label}
          {tool.status === 'failed' && ' · Falhou'}
          {tool.status === 'rejected' && ' · Recusado'}
        </span>
        {tool.estimating ? (
          <span className="tool-cost muted">Calculando custo…</span>
        ) : (
          tool.cost && (
            <span className="tool-cost" title={tool.cost.title || undefined}>
              {tool.cost.label}
            </span>
          )
        )}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {detail && <div className="tool-detail">{detail}</div>}
      {tool.status === 'pending_approval' && (
        <>
          {tool.cost?.reason && <div className="tool-reason">{tool.cost.reason}</div>}
          <div className="tool-approve">
            <button className="btn btn-sm btn-primary" disabled={tool.estimating} onClick={() => onApprove(true)}>
              Aprovar
            </button>
            <button className="btn btn-sm" disabled={tool.estimating} onClick={() => onApprove(false)}>
              Recusar
            </button>
          </div>
        </>
      )}
      {tool.error && <div className="tool-error">{tool.error}</div>}
      {open && (
        <pre className="tool-raw">
          {tool.summary ? `${tool.summary}\n\n` : ''}
          {JSON.stringify(tool.args, null, 1).slice(0, 2000)}
        </pre>
      )}
      {tool.nodeIds && tool.nodeIds.length > 0 && (
        <button className="tool-link" onClick={() => onSelect(tool.nodeIds!)}>
          Ver no canvas ({tool.nodeIds.length})
        </button>
      )}
    </div>
  );
}
