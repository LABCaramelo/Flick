import { memo, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AudioLines, Box, Image as ImageIcon, RotateCcw, Video } from 'lucide-react';
import { ACTIONS } from '../../../shared/actions';
import { nodeSize, nodeTitle } from '../../../shared/project';
import type { CanvasNode, MediaNode, TextNode } from '../../../shared/types';
import { useProject } from '../../store/project';
import { runGeneration } from '../../lib/generation';
import { toast } from '../../store/ui';

export interface NodeHandlers {
  onNodeDown(e: React.PointerEvent, id: string): void;
  onHandleDown(e: React.PointerEvent, id: string): void;
  onResizeDown(e: React.PointerEvent, id: string): void;
}

const KIND_ICON = { image: ImageIcon, video: Video, audio: AudioLines } as const;

function fmtTime(s?: number) {
  if (!s && s !== 0) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function MediaBody({ node }: { node: MediaNode }) {
  const d = node.data;
  const gs = d.generationSettings;
  const action = gs ? ACTIONS[gs.actionType] : undefined;
  const busy = d.status === 'queued' || d.status === 'processing';
  const videoRef = useRef<HTMLVideoElement>(null);
  const Icon = KIND_ICON[node.type];

  return (
    <>
      {d.url && node.type === 'image' && <img src={d.url} alt="" draggable={false} loading="lazy" />}
      {d.url && node.type === 'video' && (
        <video
          ref={videoRef}
          src={d.url}
          muted
          loop
          playsInline
          preload="metadata"
          onMouseEnter={() => videoRef.current?.play().catch(() => undefined)}
          onMouseLeave={() => videoRef.current?.pause()}
          style={{ pointerEvents: 'auto' }}
        />
      )}
      {d.url && node.type === 'audio' && <AudioBody url={d.url} seed={node.id} />}
      {!d.url && !busy && (
        <div className="node-empty">
          <Icon size={18} strokeWidth={1.4} />
          <b>{action?.name ?? (node.type === 'image' ? 'Imagem' : node.type === 'video' ? 'Vídeo' : 'Áudio')}</b>
          <span>{d.status === 'failed' ? 'A geração falhou' : `Pronto para gerar ${node.type === 'image' ? 'imagem' : node.type === 'video' ? 'vídeo' : 'áudio'}`}</span>
        </div>
      )}
      {busy && (
        <div className="node-progress">
          <span>{d.status === 'queued' ? 'Na fila…' : `Gerando… ${d.progress ?? 0}%`}</span>
          <div className="bar">
            <div style={{ width: `${Math.max(4, d.progress ?? 0)}%` }} />
          </div>
        </div>
      )}
      {d.status === 'failed' && d.error && (
        <div className="node-error" title={d.error}>
          {d.error.replace(' [auth]', '')}
          <button
            className="icon-btn"
            style={{ float: 'right', color: '#fff', width: 20, height: 20 }}
            title="Tentar de novo"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => runGeneration(node.id).catch((err) => toast(String(err.message), 'error'))}
          >
            <RotateCcw size={12} />
          </button>
        </div>
      )}
      {d.url && (
        <div className="node-kind">
          {node.type === 'video' && <span>vídeo</span>}
          {(d.versions?.length ?? 0) > 1 && (
            <span>
              v{(d.activeVersion ?? d.versions!.length - 1) + 1}/{d.versions!.length}
            </span>
          )}
        </div>
      )}
      {d.url && node.type === 'video' && d.duration ? <div className="node-badge">{fmtTime(d.duration)}</div> : null}
    </>
  );
}

function AudioBody({ url, seed }: { url: string; seed: string }) {
  const bars = useMemo(() => {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return Array.from({ length: 48 }, (_, i) => {
      h = (h * 1103515245 + 12345) >>> 0;
      return 15 + ((h >>> 8) % 85) * (0.55 + 0.45 * Math.sin(i / 4));
    });
  }, [seed]);
  return (
    <div className="audio-node">
      <div className="wave">
        {bars.map((b, i) => (
          <i key={i} style={{ height: `${b}%` }} />
        ))}
      </div>
      <audio src={url} controls preload="none" onPointerDown={(e) => e.stopPropagation()} />
    </div>
  );
}

function NoteBody({ node, editing }: { node: TextNode; editing: boolean }) {
  const [value, setValue] = useState(node.data.content);
  const update = useProject((s) => s.update);
  const setEditing = useProject((s) => s.setEditingText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setValue(node.data.content);
    else setTimeout(() => ref.current?.focus(), 0);
  }, [editing, node.data.content]);

  const commit = () => {
    if (value !== node.data.content)
      update((d) => {
        const n = d.nodes[node.id] as TextNode | undefined;
        if (n) n.data.content = value;
      });
    setEditing(null);
  };

  return (
    <div className={`note note-${node.data.color}`}>
      {editing ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') commit();
          }}
          placeholder="Escreva em markdown…"
        />
      ) : node.data.content ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.data.content}</ReactMarkdown>
      ) : (
        <span style={{ opacity: 0.5 }}>Clique duas vezes para escrever…</span>
      )}
    </div>
  );
}

function StageBody({ node }: { node: CanvasNode }) {
  return (
    <div className="node-empty">
      <Box size={18} strokeWidth={1.4} />
      <b>Cena 3D</b>
      <span>{nodeTitle(node)}</span>
    </div>
  );
}

export const NodeView = memo(function NodeView({ id, handlers, selected, dropTarget }: { id: string; handlers: NodeHandlers; selected: boolean; dropTarget: boolean }) {
  const node = useProject((s) => s.project?.nodes[id]);
  const aspect = useProject((s) => s.project?.projectSettings.aspectRatio ?? '16:9');
  const editing = useProject((s) => s.editingTextId === id);
  if (!node) return null;
  const size = nodeSize(node, aspect);
  const isMedia = node.type === 'image' || node.type === 'video' || node.type === 'audio';
  const isGenerator = isMedia && !!(node as MediaNode).data.generationSettings;
  const title = nodeTitle(node);

  return (
    <div
      className={`node node-${node.type} ${selected ? 'selected' : ''} ${dropTarget ? 'drop-target' : ''}`}
      data-node-id={id}
      style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: size.width, height: size.height }}
      onPointerDown={(e) => handlers.onNodeDown(e, id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (node.type === 'text') useProject.getState().setEditingText(id);
        else if (isGenerator) useProject.getState().requestPromptFocus(id);
      }}
    >
      {node.type !== 'text' && <div className="node-title">{title}</div>}
      <div className="node-body">
        {isMedia && <MediaBody node={node as MediaNode} />}
        {node.type === 'text' && <NoteBody node={node as TextNode} editing={editing} />}
        {node.type === 'stage_scene' && <StageBody node={node} />}
      </div>
      {isGenerator && <div className="handle handle-in" />}
      <div className="handle handle-out" title="Arraste para conectar" onPointerDown={(e) => handlers.onHandleDown(e, id)} />
      <div className="resize-handle" onPointerDown={(e) => handlers.onResizeDown(e, id)} />
    </div>
  );
});
