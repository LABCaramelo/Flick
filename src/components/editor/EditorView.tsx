import { useMemo, useState } from 'react';
import { Download, Magnet, Maximize, MousePointer2, Pause, Play, Plus, Scissors, SkipBack, Sparkles, Trash2, Type, X, ZoomIn, ZoomOut } from 'lucide-react';
import { nodeTitle, timelineDuration } from '../../../shared/project';
import type { Clip, MediaNode, TransitionType } from '../../../shared/types';
import { useProject } from '../../store/project';
import { toast } from '../../store/ui';
import { api } from '../../lib/api';
import { askAgent } from '../../lib/events';
import { mediaNodeFromUpload, findFreeSpot, viewportCenter } from '../../lib/canvasOps';
import { addClipFromNode, addTextClip, addTrack, deleteClips, patchClip, setTransition, splitClip } from '../../lib/timelineOps';
import { Preview } from './Preview';
import { Timeline, useTimelineKeys } from './Timeline';
import { useEditor, fmtTime } from './editorStore';
import { Popover, anchorBelow, type Anchor } from '../ui/Menu';
import './editor.css';

const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: 'none', label: 'Corte seco' },
  { id: 'fade', label: 'Fade' },
  { id: 'dissolve', label: 'Dissolver' },
  { id: 'fadeblack', label: 'Fade do preto' },
];

export function EditorView() {
  const project = useProject((s) => s.project);
  const timeline = project ? project.timelines[project.activeTimelineId] : undefined;
  const aspect = project?.projectSettings.aspectRatio ?? '16:9';
  const playing = useEditor((s) => s.playing);
  const time = useEditor((s) => s.time);
  const pps = useEditor((s) => s.pps);
  const tool = useEditor((s) => s.tool);
  const selected = useEditor((s) => s.selectedClip);
  const exportJobId = useEditor((s) => s.exportJobId);
  const exportJob = useProject((s) => (exportJobId ? s.jobs[exportJobId] : undefined));
  const [tab, setTab] = useState<'resources' | 'text' | 'transitions'>('resources');
  const [exportMenu, setExportMenu] = useState<Anchor | null>(null);
  useTimelineKeys(timeline);

  const media = useMemo(() => Object.values(project?.nodes ?? {}).filter((n): n is MediaNode => (n.type === 'image' || n.type === 'video' || n.type === 'audio') && !!(n as MediaNode).data.url), [project?.nodes]);
  const groups = useMemo(() => {
    const out: { id: string; label: string; items: MediaNode[] }[] = Object.values(project?.sections ?? {}).map((s) => ({ id: s.id, label: s.label, items: media.filter((m) => m.sectionId === s.id) }));
    out.push({ id: '__none', label: 'Sem agrupamento', items: media.filter((m) => !m.sectionId || !project?.sections[m.sectionId]) });
    return out;
  }, [media, project?.sections]);

  if (!project || !timeline) return null;
  const total = timelineDuration(timeline);
  const clip = selected ? timeline.clips[selected] : undefined;
  const empty = Object.keys(timeline.clips).length === 0;

  async function doExport(height: number, fps: number) {
    setExportMenu(null);
    try {
      // make sure the server renders the latest edit
      await api.saveProject(useProject.getState().project!);
      const job = await api.exportTimeline(project!.projectId, timeline!.id, height, fps);
      useProject.getState().upsertJob(job);
      useEditor.getState().setExportJob(job.id);
    } catch (e) {
      toast(String((e as Error).message), 'error');
    }
  }

  const addExportToCanvas = () => {
    const out = exportJob?.outputs[0];
    if (!out) return;
    const n = mediaNodeFromUpload({ url: out.url, kind: 'video', width: out.width, height: out.height, duration: out.duration, name: `${project.name} · corte final` }, findFreeSpot(viewportCenter(), 360, 210));
    useProject.getState().update((d) => void (d.nodes[n.id] = n));
    toast('Vídeo exportado adicionado à Tela.');
  };

  return (
    <div className="editor">
      <div className="editor-top">
        <aside className="ed-left">
          <div className="ed-tabs">
            <button className={tab === 'resources' ? 'on' : ''} onClick={() => setTab('resources')}>
              Recursos
            </button>
            <button className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>
              Texto
            </button>
            <button className={tab === 'transitions' ? 'on' : ''} onClick={() => setTab('transitions')}>
              Transições
            </button>
          </div>
          {tab === 'resources' && (
            <div className="ed-list">
              {groups.map((g) =>
                g.items.length || g.id !== '__none' ? (
                  <div key={g.id} className="ed-group">
                    <div className="ed-group-head">
                      <span>{g.label}</span>
                      <span className="muted">{g.items.length}</span>
                    </div>
                    {!g.items.length && <div className="muted ed-empty">Vazio</div>}
                    {g.items.map((n) => (
                      <div key={n.id} className="ed-item" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-claquete-node', n.id)}>
                        <div className="ed-thumb">{n.type === 'image' ? <img src={n.data.url} alt="" /> : n.type === 'video' ? <video src={`${n.data.url}#t=0.1`} muted preload="metadata" /> : <span>♪</span>}</div>
                        <span className="grow" title={nodeTitle(n)}>
                          {nodeTitle(n)}
                        </span>
                        <button className="icon-btn" title="Adicionar ao fim" onClick={() => addClipFromNode(n.id)}>
                          <Plus size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null,
              )}
              {!media.length && <div className="muted ed-empty">Gere ou envie mídias na Tela para montar o vídeo.</div>}
            </div>
          )}
          {tab === 'text' && (
            <div className="ed-list" style={{ padding: 12 }}>
              <button className="btn btn-sm" onClick={() => useEditor.getState().selectClip(addTextClip(time, 'Título'))}>
                <Type size={12} /> Adicionar texto no cursor
              </button>
              <p className="muted" style={{ fontSize: 12 }}>
                Textos vão para uma trilha de sobreposição acima do vídeo principal e entram na exportação.
              </p>
            </div>
          )}
          {tab === 'transitions' && (
            <div className="ed-list" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {clip ? `Aplicar na entrada de “${clip.label}”:` : 'Selecione um clipe na linha do tempo.'}
              </p>
              {TRANSITIONS.map((t) => (
                <button key={t.id} className={`btn btn-sm ${clip?.transitionIn?.type === t.id || (!clip?.transitionIn && t.id === 'none' && clip) ? 'btn-primary' : ''}`} disabled={!clip} onClick={() => clip && setTransition(clip.id, t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="ed-center">
          {empty ? (
            <div className="ed-empty-state">
              <h3>Transforme suas tomadas em um vídeo</h3>
              <button className="btn btn-primary" onClick={() => askAgent('Monte a linha do tempo do editor com as mídias prontas, na ordem da história, com cortes e transições adequados.')}>
                <Sparkles size={13} /> Deixar o agente montar minha timeline
              </button>
              <p className="muted">ou arraste uma tomada do painel de Recursos</p>
            </div>
          ) : (
            <div className="ed-stage">
              <Preview timeline={timeline} aspect={aspect} />
            </div>
          )}
        </div>

        <aside className="ed-right">
          {clip ? <ClipProps clip={clip} /> : <div className="muted ed-empty" style={{ padding: 16 }}>Selecione um clipe para ver suas propriedades</div>}
        </aside>
      </div>

      <div className="ed-toolbar">
        <button className="icon-btn" title="Reduzir zoom" onClick={() => useEditor.getState().setPps(pps / 1.4)}>
          <ZoomOut size={14} />
        </button>
        <button className="icon-btn" title="Ampliar zoom" onClick={() => useEditor.getState().setPps(pps * 1.4)}>
          <ZoomIn size={14} />
        </button>
        <span className="chip">{aspect}</span>
        <span className="muted" style={{ fontSize: 11 }}>
          30 fps
        </span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Início" onClick={() => useEditor.getState().setTime(0)}>
          <SkipBack size={14} />
        </button>
        <button className="icon-btn" title="Reproduzir (espaço)" onClick={() => useEditor.getState().setPlaying(!playing)} disabled={empty}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="mono" style={{ fontSize: 12 }}>
          {fmtTime(time, true)} / {fmtTime(total, true)}
        </span>
        <button className="icon-btn" title="Tela cheia" onClick={() => (document.querySelector('.preview-frame') as HTMLElement | null)?.requestFullscreen?.()}>
          <Maximize size={14} />
        </button>
        <span style={{ flex: 1 }} />
        <button className={`icon-btn ${tool === 'select' ? 'active' : ''}`} title="Selecionar (C alterna)" onClick={() => useEditor.getState().setTool('select')}>
          <MousePointer2 size={14} />
        </button>
        <button className={`icon-btn ${tool === 'razor' ? 'active' : ''}`} title="Navalha: clique num clipe para cortar (C)" onClick={() => useEditor.getState().setTool('razor')}>
          <Scissors size={14} />
        </button>
        <button className="icon-btn" title="Dividir no cursor (S)" disabled={!clip} onClick={() => clip && splitClip(clip.id, time)}>
          <Scissors size={14} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <button className="icon-btn" title="Excluir clipe" disabled={!clip} onClick={() => clip && (deleteClips([clip.id]), useEditor.getState().selectClip(null))}>
          <Trash2 size={14} />
        </button>
        <button
          className={`icon-btn ${timeline.magnetEnabled ? 'active' : ''}`}
          title="Ímã: mantém a trilha principal sem buracos"
          onClick={() => useProject.getState().update((d) => void (d.timelines[d.activeTimelineId].magnetEnabled = !d.timelines[d.activeTimelineId].magnetEnabled))}
        >
          <Magnet size={14} />
        </button>
        <button className="btn btn-sm" title="Adicionar trilha de vídeo (sobreposição)" onClick={() => addTrack('video')}>
          + Trilha
        </button>
        <button className="btn btn-sm" onClick={() => addTrack('audio')}>
          + Áudio
        </button>
        <button className="btn btn-sm btn-primary" disabled={empty} onClick={(e) => setExportMenu(anchorBelow(e.currentTarget, 'end'))}>
          <Download size={12} /> Exportar
        </button>
      </div>

      {exportJob && (
        <div className={`export-bar ${exportJob.status}`}>
          {exportJob.status === 'completed' ? (
            <>
              <span>Exportação concluída.</span>
              <a className="btn btn-sm btn-primary" href={exportJob.outputs[0]?.url} download={`${project.name}.mp4`}>
                <Download size={12} /> Baixar MP4
              </a>
              <button className="btn btn-sm" onClick={addExportToCanvas}>
                Adicionar à Tela
              </button>
            </>
          ) : exportJob.status === 'failed' ? (
            <span title={exportJob.error}>Falha na exportação: {exportJob.error?.split('\n').slice(-1)[0]}</span>
          ) : (
            <>
              <span className="spinner" /> Renderizando… {exportJob.progress}%
            </>
          )}
          <button className="icon-btn" onClick={() => useEditor.getState().setExportJob(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      <Timeline timeline={timeline} />

      {exportMenu && (
        <Popover anchor={exportMenu} onClose={() => setExportMenu(null)} width={220}>
          <div className="menu-title">Exportar MP4 (H.264)</div>
          <button className="menu-item" onClick={() => doExport(720, 30)}>
            720p · 30 fps
          </button>
          <button className="menu-item" onClick={() => doExport(1080, 30)}>
            1080p · 30 fps
          </button>
          <button className="menu-item" onClick={() => doExport(1080, 24)}>
            1080p · 24 fps (cinema)
          </button>
        </Popover>
      )}
    </div>
  );
}

function ClipProps({ clip }: { clip: Clip }) {
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <div className="clip-props">
      <div className="label">{clip.mediaType === 'text' ? 'Texto' : clip.mediaType === 'image' ? 'Imagem' : clip.mediaType === 'video' ? 'Vídeo' : 'Áudio'}</div>
      <div className="cp-title">{clip.label}</div>
      {clip.mediaType === 'text' && clip.text && (
        <>
          <label>
            Conteúdo
            <textarea className="textarea" value={clip.text.content} onChange={(e) => patchClip(clip.id, { text: { ...clip.text!, content: e.target.value }, label: e.target.value }, false)} />
          </label>
          <div className="cp-row">
            <label>
              Tamanho
              <input className="input" type="number" value={clip.text.size} onChange={(e) => patchClip(clip.id, { text: { ...clip.text!, size: num(e.target.value) } }, false)} />
            </label>
            <label>
              Cor
              <input type="color" value={clip.text.color} onChange={(e) => patchClip(clip.id, { text: { ...clip.text!, color: e.target.value } }, false)} />
            </label>
          </div>
          <label>
            Posição vertical {Math.round(clip.text.y * 100)}%
            <input type="range" min={0.05} max={0.95} step={0.01} value={clip.text.y} onChange={(e) => patchClip(clip.id, { text: { ...clip.text!, y: Number(e.target.value) } }, false)} />
          </label>
        </>
      )}
      <div className="cp-row">
        <label>
          Início (s)
          <input className="input" type="number" step={0.1} value={Math.round(clip.start * 100) / 100} onChange={(e) => patchClip(clip.id, { start: num(e.target.value) })} />
        </label>
        <label>
          Duração (s)
          <input className="input" type="number" step={0.1} min={0.2} value={Math.round(clip.duration * 100) / 100} onChange={(e) => patchClip(clip.id, { duration: Math.max(0.2, num(e.target.value)) })} />
        </label>
      </div>
      {(clip.mediaType === 'video' || clip.mediaType === 'audio') && (
        <label>
          Velocidade {clip.speed}x
          <input type="range" min={0.25} max={3} step={0.25} value={clip.speed} onChange={(e) => patchClip(clip.id, { speed: Number(e.target.value) })} />
        </label>
      )}
      {clip.mediaType !== 'image' && clip.mediaType !== 'text' && (
        <label>
          Volume {Math.round(clip.volume * 100)}%
          <input type="range" min={0} max={2} step={0.05} value={clip.volume} onChange={(e) => patchClip(clip.id, { volume: Number(e.target.value) }, false)} />
        </label>
      )}
      <div className="cp-row">
        <label>
          Fade in (s)
          <input className="input" type="number" step={0.1} value={clip.fadeIn} onChange={(e) => patchClip(clip.id, { fadeIn: num(e.target.value) })} />
        </label>
        <label>
          Fade out (s)
          <input className="input" type="number" step={0.1} value={clip.fadeOut} onChange={(e) => patchClip(clip.id, { fadeOut: num(e.target.value) })} />
        </label>
      </div>
      <label>
        Transição de entrada
        <select className="select" value={clip.transitionIn?.type ?? 'none'} onChange={(e) => setTransition(clip.id, e.target.value as TransitionType, clip.transitionIn?.duration ?? 0.6)}>
          {TRANSITIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {clip.transitionIn && (
        <label>
          Duração da transição {clip.transitionIn.duration}s
          <input type="range" min={0.2} max={2} step={0.1} value={clip.transitionIn.duration} onChange={(e) => setTransition(clip.id, clip.transitionIn!.type, Number(e.target.value))} />
        </label>
      )}
    </div>
  );
}
