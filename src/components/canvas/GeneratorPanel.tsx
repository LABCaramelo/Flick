import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Upload, X, MousePointer2 } from 'lucide-react';
import { ACTIONS, actionsForOutput, defaultModelId, findModel, modelSettings, modelsForAction } from '../../../shared/actions';
import { nodeTitle } from '../../../shared/project';
import { STYLE_PRESETS } from '../../../shared/styles';
import type { ActionType, MediaNode, ModelSetting } from '../../../shared/types';
import { useProject } from '../../store/project';
import { toast } from '../../store/ui';
import { connect, disconnect, pickFiles, setNodeAction, uploadFilesToCanvas } from '../../lib/canvasOps';
import { describeCost, useCostEstimate } from '../../lib/cost';
import { cancelGeneration, runGeneration } from '../../lib/generation';
import { Dropdown, Popover, anchorBelow, type Anchor } from '../ui/Menu';

export function GeneratorPanel({ nodeId, x, y }: { nodeId: string; x: number; y: number }) {
  const node = useProject((s) => s.project?.nodes[nodeId]) as MediaNode | undefined;
  const edges = useProject((s) => s.project?.edges);
  const nodes = useProject((s) => s.project?.nodes);
  const models = useProject((s) => s.models);
  const customStyles = useProject((s) => s.project?.customStyles ?? []);
  const projectStyle = useProject((s) => s.project?.projectSettings.styleId ?? null);
  const focusPrompt = useProject((s) => s.focusPrompt);
  const update = useProject((s) => s.update);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<{ anchor: Anchor; query: string; start: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ anchor: Anchor; inputId: string } | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    if (focusPrompt?.nodeId === nodeId) setTimeout(() => taRef.current?.focus(), 30);
  }, [focusPrompt, nodeId]);

  // keep the panel on screen
  useEffect(() => {
    const el = panelRef.current;
    const root = document.querySelector('.canvas-root') as HTMLElement | null;
    if (!el || !root) return;
    const w = el.offsetWidth;
    const left = Math.max(60, Math.min(x - w / 2, root.clientWidth - w - 10));
    setPos({ left, top: Math.max(8, y) });
  }, [x, y]);

  const gs = node?.data.generationSettings;
  const action = gs ? ACTIONS[gs.actionType] : undefined;
  const incoming = useMemo(() => (edges ?? []).filter((e) => e.target === nodeId), [edges, nodeId]);
  const cost = describeCost(useCostEstimate(nodeId));
  if (!node || !gs || !action || !nodes) return null;

  const busy = node.data.status === 'queued' || node.data.status === 'processing';
  const modelList = modelsForAction(models, gs.actionType);
  const model = findModel(modelList, gs.inputs.model) ?? findModel(modelList, defaultModelId(models, gs.actionType)) ?? modelList[0];
  const settings: ModelSetting[] = modelSettings(model, gs.actionType);
  const hasStyle = action.common.some((c) => c.id === 'style') || action.output === 'image';
  const promptDef = action.common.find((c) => c.id === 'prompt');
  const versions = node.data.versions ?? [];
  const active = node.data.activeVersion ?? versions.length - 1;

  const setInput = (key: string, value: unknown) =>
    update(
      (d) => {
        const n = d.nodes[nodeId] as MediaNode;
        n.data.generationSettings!.inputs[key] = value;
      },
      { record: false },
    );

  const setVersion = (i: number) => {
    const v = versions[i];
    if (!v) return;
    update((d) => {
      const n = d.nodes[nodeId] as MediaNode;
      Object.assign(n.data, { url: v.url, remoteUrl: v.remoteUrl, width: v.width, height: v.height, duration: v.duration, activeVersion: i });
    });
  };

  const generate = () => {
    runGeneration(nodeId).catch((e) => toast(String(e.message), 'error'));
  };

  // ---------- @mentions ----------
  const candidates = Object.values(nodes).filter((n) => n.id !== nodeId && (n.type === 'text' || ((n.type === 'image' || n.type === 'video' || n.type === 'audio') && (n as MediaNode).data.url)));
  const filtered = mention ? candidates.filter((n) => nodeTitle(n).toLowerCase().includes(mention.query.toLowerCase())).slice(0, 8) : [];

  const onPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput('prompt', value);
    const caret = e.target.selectionStart;
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    if (m) {
      const r = e.target.getBoundingClientRect();
      setMention({ anchor: { x: r.left + 10, y: r.top + 24 }, query: m[2], start: caret - m[2].length - 1 });
    } else setMention(null);
  };

  const insertMention = (id: string) => {
    const ta = taRef.current;
    const target = nodes[id];
    if (!ta || !mention || !target) return;
    const title = nodeTitle(target);
    const value = String(gs.inputs.prompt ?? '');
    const caret = ta.selectionStart;
    const next = `${value.slice(0, mention.start)}@${title} ${value.slice(caret)}`;
    setInput('prompt', next);
    setMention(null);
    const err = connect(id, nodeId);
    if (err && err !== 'já conectado') toast(err, 'error');
    setTimeout(() => {
      ta.focus();
      const p = mention.start + title.length + 2;
      ta.setSelectionRange(p, p);
    }, 0);
  };

  const textEdges = incoming.filter((e) => e.data.mediaInputId === 'prompt');

  return (
    <div ref={panelRef} className="gen-panel" style={{ left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="gp-row">
        <Dropdown<ActionType>
          value={gs.actionType}
          title="Ação"
          options={actionsForOutput(action.output).map((a) => ({ value: a.id, label: a.name, description: a.description }))}
          onChange={(a) => setNodeAction(nodeId, a)}
          width={300}
        />
        <Dropdown
          value={model?.id ?? 'auto'}
          title="Modelo"
          options={modelList.map((m) => ({ value: m.id, label: m.name, description: [m.description, m.estimatedTime].filter(Boolean).join(' · ') }))}
          onChange={(v) => setInput('model', v)}
          width={320}
        />
        {settings
          .filter((s) => s.type === 'select' && s.options)
          .map((s) => (
            <Dropdown
              key={s.id}
              value={String(gs.inputs[s.id] ?? s.defaultValue ?? s.options![0].value)}
              title={s.label}
              options={s.options!}
              onChange={(v) => setInput(s.id, v)}
              width={180}
            />
          ))}
        {settings
          .filter((s) => s.type === 'checkbox')
          .map((s) => {
            const on = (gs.inputs[s.id] ?? s.defaultValue) === true;
            return (
              <button key={s.id} className={`chip ${on ? 'on' : ''}`} title={s.id === 'audio' ? 'Áudio nativo encarece a geração na maioria dos modelos' : s.label} onClick={() => setInput(s.id, !on)}>
                {s.label}: {on ? 'sim' : 'não'}
              </button>
            );
          })}
        {hasStyle && (
          <Dropdown
            value={gs.styleId ?? '__project'}
            title="Estilo"
            options={[
              { value: '__project', label: projectStyle ? `Estilo do projeto` : 'Sem estilo' },
              { value: '__none', label: 'Sem estilo' },
              ...customStyles.map((s) => ({ value: s.id, label: `${s.name} (salvo)` })),
              ...STYLE_PRESETS.map((s) => ({ value: s.id, label: s.name })),
            ]}
            renderLabel={(v) =>
              v === '__project'
                ? projectStyle
                  ? (customStyles.find((s) => s.id === projectStyle) ?? STYLE_PRESETS.find((s) => s.id === projectStyle))?.name ?? 'Estilo'
                  : 'Sem estilo'
                : v === '__none'
                  ? 'Sem estilo'
                  : (customStyles.find((s) => s.id === v) ?? STYLE_PRESETS.find((s) => s.id === v))?.name ?? v
            }
            onChange={(v) =>
              update((d) => {
                const n = d.nodes[nodeId] as MediaNode;
                n.data.generationSettings!.styleId = v === '__project' ? undefined : v === '__none' ? null : v;
              })
            }
            width={240}
          />
        )}
        {versions.length > 1 && (
          <div className="row" style={{ marginLeft: 'auto' }}>
            <button className="icon-btn" disabled={active <= 0} onClick={() => setVersion(active - 1)} title="Versão anterior">
              <ChevronLeft size={13} />
            </button>
            <span className="muted" style={{ fontSize: 11 }}>
              v{active + 1}/{versions.length}
            </span>
            <button className="icon-btn" disabled={active >= versions.length - 1} onClick={() => setVersion(active + 1)} title="Próxima versão">
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>

      {(action.mediaInputs.length > 0 || textEdges.length > 0) && (
        <div className="gp-inputs">
          {action.mediaInputs.map((input) => {
            const conns = incoming.filter((e) => e.data.mediaInputId === input.id);
            return (
              <div key={input.id} className="gp-input">
                <span className="lbl">
                  {input.label}
                  {input.required && <span className="req"> *</span>}
                </span>
                <div className="gp-thumbs">
                  {conns.map((e) => {
                    const src = nodes[e.source] as MediaNode | undefined;
                    if (!src) return null;
                    return (
                      <div key={e.id} className="gp-thumb" title={nodeTitle(src)}>
                        {src.type === 'image' && <img src={src.data.url} alt="" />}
                        {src.type === 'video' && <video src={src.data.url} muted />}
                        {src.type === 'audio' && <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 14 }}>♪</div>}
                        <button className="x" title="Desconectar mídia" onClick={() => disconnect(e.id)}>
                          <X size={9} />
                        </button>
                      </div>
                    );
                  })}
                  {conns.length < input.max && (
                    <button className="gp-add" title="Adicionar" onClick={(e) => setAddMenu({ anchor: anchorBelow(e.currentTarget), inputId: input.id })}>
                      <Plus size={14} />
                    </button>
                  )}
                  <span className="gp-count">
                    {input.max > 1 ? `${conns.length} de ${input.max}` : input.required ? '' : 'Opcional'}
                  </span>
                </div>
              </div>
            );
          })}
          {textEdges.length > 0 && (
            <div className="gp-input">
              <span className="lbl">Notas no prompt</span>
              <div className="gp-thumbs">
                {textEdges.map((e) => (
                  <span key={e.id} className="chip">
                    {nodes[e.source] ? nodeTitle(nodes[e.source]) : '?'}
                    <button onClick={() => disconnect(e.id)} title="Desconectar">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {promptDef && (
        <div className="gp-prompt">
          <textarea
            ref={taRef}
            value={String(gs.inputs.prompt ?? '')}
            placeholder={`${promptDef.placeholder ?? 'Descreva…'}  ·  @ para referenciar`}
            onChange={onPromptChange}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (mention && filtered.length && (e.key === 'Enter' || e.key === 'Tab')) {
                e.preventDefault();
                insertMention(filtered[0].id);
                return;
              }
              if (e.key === 'Escape') setMention(null);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy) generate();
            }}
            onBlur={() => setTimeout(() => setMention(null), 150)}
          />
        </div>
      )}

      <div className="gp-foot">
        <span>
          {busy ? (node.data.status === 'queued' ? 'Na fila…' : `Gerando… ${node.data.progress ?? 0}%`) : model?.estimatedTime ? `Tempo estimado ${model.estimatedTime}` : action.description}
        </span>
        <div className="row">
          {!busy && cost.label && (
            <span className="gp-cost" title={cost.title}>
              {cost.label}
            </span>
          )}
          {busy && (
            <button className="btn btn-sm" onClick={() => cancelGeneration(nodeId)}>
              Cancelar
            </button>
          )}
          <button className="btn btn-primary" disabled={busy} onClick={generate} title="Gerar (Ctrl+Enter)">
            {busy ? <span className="spinner" /> : node.data.url ? 'Gerar de novo' : 'Gerar'}
          </button>
        </div>
      </div>

      {mention && filtered.length > 0 && (
        <Popover anchor={mention.anchor} onClose={() => setMention(null)} width={260}>
          <div className="menu-title">Referenciar</div>
          {filtered.map((n) => (
            <button key={n.id} className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(n.id)}>
              {n.type === 'image' ? <img src={(n as MediaNode).data.url} alt="" style={{ width: 28, height: 20, objectFit: 'cover' }} /> : <span className="kbd">{n.type}</span>}
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nodeTitle(n)}
              </span>
            </button>
          ))}
        </Popover>
      )}

      {addMenu && (
        <Popover anchor={addMenu.anchor} onClose={() => setAddMenu(null)} width={210}>
          <button
            className="menu-item"
            onClick={() => {
              useProject.getState().setPick({ nodeId, inputId: addMenu.inputId });
              setAddMenu(null);
            }}
          >
            <MousePointer2 size={13} /> Escolher no canvas
          </button>
          <button
            className="menu-item"
            onClick={async () => {
              const inputId = addMenu.inputId;
              setAddMenu(null);
              const accepts = action.mediaInputs.find((m) => m.id === inputId)?.accepted ?? ['image'];
              const files = await pickFiles(accepts.map((a) => `${a}/*`).join(','), false);
              if (!files.length) return;
              const n = node;
              const ids = await uploadFilesToCanvas(files, { x: n.position.x - 420, y: n.position.y });
              for (const id of ids) connect(id, nodeId, inputId);
              useProject.getState().select([nodeId]);
            }}
          >
            <Upload size={13} /> Enviar arquivo
          </button>
        </Popover>
      )}
    </div>
  );
}
