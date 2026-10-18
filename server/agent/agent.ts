import { spawn } from 'node:child_process';
import type { Response } from 'express';
import OpenAI from 'openai';
import { uid } from '../../shared/project';
import type { AgentStreamEvent, ChatMessageView, ChatThread, ToolCardState, ToolCost } from '../../shared/types';
import { OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL } from '../config';
import { resolveMediaUrl } from '../media';
import { readChat, writeChat } from '../storage';
import { systemPrompt, type AgentContext } from './prompt';
import { AGENT_TOOLS, GENERATION_TOOLS, SERVER_TOOLS } from './tools';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ChatRequest {
  projectId: string;
  threadId?: string;
  message: string;
  attachments?: { nodeId: string; url?: string; type: string; title?: string }[];
  context?: AgentContext;
}

export interface ToolResultPayload {
  ok: boolean;
  summary?: string;
  error?: string;
  nodeIds?: string[];
  data?: unknown;
  imageUrl?: string;
  rejected?: boolean;
  /** estimated charge of the generations this call started (or the user declined) */
  cost?: ToolCost;
}

interface Run {
  id: string;
  aborted: boolean;
  controller: AbortController;
  pending: Map<string, (r: ToolResultPayload) => void>;
}

const runs = new Map<string, Run>();

export function agentConfigured(): boolean {
  return !!OPENAI_API_KEY;
}

export function deliverToolResult(runId: string, callId: string, result: ToolResultPayload): boolean {
  const r = runs.get(runId);
  const resolve = r?.pending.get(callId);
  if (!resolve) return false;
  r!.pending.delete(callId);
  resolve(result);
  return true;
}

export function cancelRun(runId: string): boolean {
  const r = runs.get(runId);
  if (!r) return false;
  r.aborted = true;
  r.controller.abort();
  for (const [id, resolve] of r.pending) resolve({ ok: false, error: 'cancelado pelo usuário' });
  r.pending.clear();
  return true;
}

/** Downscaled JPEG data URI for vision input (keeps requests small). */
async function visionDataUri(url: string): Promise<string | undefined> {
  if (/^https?:\/\//.test(url)) return url;
  const file = resolveMediaUrl(url);
  if (!file) return undefined;
  const { code, stdout } = await new Promise<{ code: number; stdout: string }>((resolve) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=768:768:force_original_aspect_ratio=decrease', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', 'pipe:1'], { windowsHide: true });
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', () => resolve({ code: 1, stdout: '' }));
    p.on('close', (c) => resolve({ code: c ?? 1, stdout: Buffer.concat(chunks).toString('base64') }));
  });
  return code === 0 && stdout ? `data:image/jpeg;base64,${stdout}` : undefined;
}

function threadTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 45)}…` : t || 'Novo chat';
}

export async function runAgent(req: ChatRequest, res: Response): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (e: AgentStreamEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  if (!OPENAI_API_KEY) {
    send({ type: 'error', message: 'Configure OPENAI_API_KEY no arquivo .env para usar o agente.' });
    send({ type: 'done', threadId: req.threadId ?? '' });
    res.end();
    return;
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });
  const chat = await readChat(req.projectId);
  const now = new Date().toISOString();
  let thread = req.threadId ? chat.threads[req.threadId] : undefined;
  if (!thread) {
    const id = uid();
    thread = { id, title: threadTitle(req.message), updatedAt: now, messages: [], openai: [] };
    chat.threads[id] = thread;
  }
  const history = thread.openai as Msg[];

  // user turn
  const userView: ChatMessageView = { id: uid(), role: 'user', content: req.message, attachments: req.attachments, createdAt: now };
  thread.messages.push(userView);
  const userParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: req.message }];
  if (req.attachments?.length) {
    userParts.push({ type: 'text', text: `Anexos: ${req.attachments.map((a) => `${a.title ?? a.type} [${a.type}, id ${a.nodeId}]`).join('; ')}` });
    for (const a of req.attachments.slice(0, 6)) {
      if (a.type !== 'image' || !a.url) continue;
      const uri = await visionDataUri(a.url);
      if (uri) userParts.push({ type: 'image_url', image_url: { url: uri, detail: 'low' } });
    }
  }
  history.push({ role: 'user', content: userParts });

  const run: Run = { id: uid(), aborted: false, controller: new AbortController(), pending: new Map() };
  runs.set(run.id, run);
  const assistantView: ChatMessageView = { id: uid(), role: 'assistant', content: '', tools: [], createdAt: now };
  send({ type: 'run', runId: run.id, threadId: thread.id, messageId: assistantView.id });
  res.on('close', () => {
    if (!res.writableEnded) cancelRun(run.id);
  });

  const ctx: AgentContext = { ...(req.context ?? {}) };
  let stopForUser = false;

  try {
    for (let step = 0; step < 14 && !run.aborted && !stopForUser; step++) {
      const messages: Msg[] = [{ role: 'system', content: systemPrompt(ctx) }, ...trimHistory(history)];
      const stream = await openai.chat.completions.create(
        { model: OPENAI_MODEL, messages, tools: AGENT_TOOLS, tool_choice: 'auto', parallel_tool_calls: true, stream: true },
        { signal: run.controller.signal },
      );
      let text = '';
      const calls: { id: string; name: string; args: string }[] = [];
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          assistantView.content += delta.content;
          send({ type: 'delta', text: delta.content });
        }
        for (const tc of delta.tool_calls ?? []) {
          const slot = (calls[tc.index] ??= { id: '', name: '', args: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
      }
      const toolCalls = calls.filter((c) => c && c.name);
      history.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } })) } : {}),
      } as Msg);
      if (!toolCalls.length) break;
      if (text && !assistantView.content.endsWith('\n')) {
        assistantView.content += '\n\n';
        send({ type: 'delta', text: '\n\n' });
      }

      const followUps: Msg[] = [];
      const results = await Promise.all(
        toolCalls.map(async (c) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(c.args || '{}');
          } catch {
            return { c, content: JSON.stringify({ ok: false, error: 'argumentos JSON inválidos' }) };
          }
          if (SERVER_TOOLS.has(c.name)) {
            if (c.name === 'suggest_next_steps') {
              const s = (args.suggestions as string[] | undefined)?.slice(0, 4) ?? [];
              assistantView.suggestions = s;
              send({ type: 'suggestions', suggestions: s });
              return { c, content: JSON.stringify({ ok: true }) };
            }
            const question = String(args.question ?? '');
            const options = ((args.options as string[] | undefined) ?? []).slice(0, 5);
            assistantView.choices = { question, options };
            send({ type: 'choices', question, options });
            stopForUser = true;
            return { c, content: JSON.stringify({ ok: true, note: 'aguardando a escolha do usuário' }) };
          }
          const needsApproval = ctx.approvalMode === 'ask' && GENERATION_TOOLS.has(c.name);
          const card: ToolCardState = { callId: c.id, name: c.name, args, status: needsApproval ? 'pending_approval' : 'running' };
          assistantView.tools!.push(card);
          send({ type: 'tool_call', callId: c.id, name: c.name, args, needsApproval });
          const result = await new Promise<ToolResultPayload>((resolve) => {
            run.pending.set(c.id, resolve);
            setTimeout(() => {
              if (run.pending.delete(c.id)) resolve({ ok: false, error: 'tempo esgotado aguardando o canvas' });
            }, 15 * 60_000);
          });
          card.status = result.rejected ? 'rejected' : result.ok ? 'done' : 'failed';
          card.summary = result.summary;
          card.error = result.error;
          card.nodeIds = result.nodeIds;
          card.cost = result.cost;
          send({ type: 'tool_result', callId: c.id, ok: result.ok, rejected: result.rejected, summary: result.summary, error: result.error, nodeIds: result.nodeIds, cost: result.cost });
          if (result.imageUrl) {
            const uri = await visionDataUri(result.imageUrl);
            if (uri) followUps.push({ role: 'user', content: [{ type: 'text', text: `Imagem do nó ${String(args.node_id ?? '')} para inspeção:` }, { type: 'image_url', image_url: { url: uri, detail: 'high' } }] });
          }
          const { imageUrl, ...rest } = result;
          return { c, content: JSON.stringify(rest).slice(0, 12_000) };
        }),
      );
      for (const r of results) history.push({ role: 'tool', tool_call_id: r.c.id, content: r.content });
      history.push(...followUps);
    }
  } catch (err) {
    if (!run.aborted) {
      const message = String((err as Error)?.message ?? err);
      send({ type: 'error', message: `Erro do agente: ${message}` });
      assistantView.content += `\n\n_Erro: ${message}_`;
    }
  } finally {
    runs.delete(run.id);
    thread.messages.push(assistantView);
    thread.updatedAt = new Date().toISOString();
    await writeChat(req.projectId, chat).catch(() => undefined);
    send({ type: 'done', threadId: thread.id, title: thread.title });
    res.end();
  }
}

/**
 * Keep the request bounded: last ~40 messages, never starting on a dangling
 * tool message, and only the most recent images are re-sent.
 */
function trimHistory(h: Msg[]): Msg[] {
  let start = Math.max(0, h.length - 40);
  const danglingStart = (m: Msg) => m.role === 'tool' || (m.role === 'assistant' && !!(m as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam).tool_calls?.length);
  while (start < h.length && danglingStart(h[start])) start++;
  const kept = h.slice(start);
  const keepImagesFrom = kept.length - 8;
  return kept.map((m, i) => {
    if (i >= keepImagesFrom || m.role !== 'user' || !Array.isArray(m.content)) return m;
    const parts = m.content.map((p) => (p.type === 'image_url' ? { type: 'text' as const, text: '[imagem enviada anteriormente]' } : p));
    return { ...m, content: parts };
  });
}

export async function listThreads(projectId: string) {
  const chat = await readChat(projectId);
  return Object.values(chat.threads)
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getThread(projectId: string, threadId: string): Promise<ChatThread | undefined> {
  const chat = await readChat(projectId);
  const t = chat.threads[threadId];
  if (!t) return undefined;
  const { openai, ...view } = t;
  return view;
}

export async function deleteThread(projectId: string, threadId: string) {
  const chat = await readChat(projectId);
  delete chat.threads[threadId];
  await writeChat(projectId, chat);
}
