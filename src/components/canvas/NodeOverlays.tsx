import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AudioLines,
  Box,
  Clapperboard,
  Copy,
  Download,
  Frame,
  Image as ImageIcon,
  Maximize2,
  MessageSquarePlus,
  Palette,
  Star,
  Trash2,
  Video,
} from 'lucide-react';
import { nodeSize, nodeTitle, uid } from '../../../shared/project';
import type { MediaNode, StageScene } from '../../../shared/types';
import { useProject } from '../../store/project';
import { toast, useUi } from '../../store/ui';
import { addNodesToTimeline, createDownstream, createSection, deleteNodes, duplicateNodes } from '../../lib/canvasOps';
import { GeneratorPanel } from './GeneratorPanel';

/** Screen-space UI attached to the current selection. */
export function NodeOverlays() {
  const selection = useProject((s) => s.selection);
  const viewport = useProject((s) => s.viewport);
  const node = useProject((s) => (s.selection.length === 1 ? s.project?.nodes[s.selection[0]] : undefined));
  const aspect = useProject((s) => s.project?.projectSettings.aspectRatio ?? '16:9');
  const editingText = useProject((s) => s.editingTextId);
  const [, setParams] = useSearchParams();

  if (selection.length > 1) return <MultiToolbar ids={selection} />;
  if (!node || editingText === node.id) return null;

  const size = nodeSize(node, aspect);
  const left = node.position.x * viewport.zoom + viewport.x;
  const top = node.position.y * viewport.zoom + viewport.y;
  const w = size.width * viewport.zoom;
  const h = size.height * viewport.zoom;
  const isMedia = node.type === 'image' || node.type === 'video' || node.type === 'audio';
  const media = isMedia ? (node as MediaNode) : undefined;
  const hasUrl = !!media?.data.url;
  const isGenerator = !!media?.data.generationSettings;

  // flip the side menu to the left of the node when it would leave the canvas
  const rootW = (document.querySelector('.canvas-root') as HTMLElement | null)?.clientWidth ?? window.innerWidth;
  const sideX = left + w + 10 + 180 > rootW ? left - 190 : left + w + 10;

  return (
    <>
      <NodeToolbar nodeId={node.id} x={left + w / 2} y={top - 26} />
      {(hasUrl || node.type === 'text') && <SideMenu nodeId={node.id} x={sideX} y={top} onOpenStage={() => setParams({ view: 'stage' })} />}
      {isGenerator && <GeneratorPanel nodeId={node.id} x={left + w / 2} y={top + h + 12} />}
    </>
  );
}

function NodeToolbar({ nodeId, x, y }: { nodeId: string; x: number; y: number }) {
  const node = useProject((s) => s.project?.nodes[nodeId]);
  const update = useProject((s) => s.update);
  const [title, setTitle] = useState(node ? nodeTitle(node) : '');
  useEffect(() => setTitle(node ? nodeTitle(node) : ''), [nodeId, node && nodeTitle(node)]);
  if (!node) return null;
  const media = node.type === 'image' || node.type === 'video' || node.type === 'audio' ? (node as MediaNode) : undefined;

  const commitTitle = () => {
    if (title !== nodeTitle(node))
      update((d) => {
        (d.nodes[nodeId].data as { user_input_title?: string }).user_input_title = title;
      });
  };

  return (
    <div className="node-toolbar" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      {media && (
        <button
          className="icon-btn"
          title={media.data.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          onClick={() =>
            update((d) => {
              const n = d.nodes[nodeId] as MediaNode;
              n.data.favorite = !n.data.favorite;
            })
          }
        >
          <Star size={13} fill={media.data.favorite ? 'currentColor' : 'none'} />
        </button>
      )}
      <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && (e.target as HTMLInputElement).blur())} />
      {media?.data.url && (
        <>
          <a className="icon-btn" title="Baixar como arquivo" href={media.data.url} download={`${title || 'midia'}`}>
            <Download size={13} />
          </a>
          <button className="icon-btn" title="Ver em tela cheia" onClick={() => useUi.getState().setFullscreenNode(nodeId)}>
            <Maximize2 size={13} />
          </button>
        </>
      )}
      <button className="icon-btn" title="Anexar ao chat" onClick={() => attachToChat([nodeId])}>
        <MessageSquarePlus size={13} />
      </button>
      <button className="icon-btn" title="Duplicar (Ctrl+D)" onClick={() => duplicateNodes([nodeId])}>
        <Copy size={13} />
      </button>
      <button className="icon-btn" title="Excluir" onClick={() => deleteNodes([nodeId])}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export function attachToChat(ids: string[]) {
  const st = useProject.getState();
  st.setChatAttachments([...new Set([...st.chatAttachments, ...ids])]);
  useUi.getState().setChatCollapsed(false);
  setTimeout(() => (document.querySelector('.chat-input textarea') as HTMLTextAreaElement | null)?.focus(), 50);
}

function SideMenu({ nodeId, x, y, onOpenStage }: { nodeId: string; x: number; y: number; onOpenStage: () => void }) {
  const node = useProject((s) => s.project?.nodes[nodeId]);
  if (!node) return null;
  const media = node.type !== 'text' ? (node as MediaNode) : undefined;

  const saveAsStyle = () => {
    if (!media?.data.url) return;
    const name = window.prompt('Nome do estilo', nodeTitle(node));
    if (!name) return;
    const description = window.prompt('Descreva o estilo em inglês (opcional — usado no prompt)', '') ?? '';
    const id = uid();
    useProject.getState().update((d) => {
      d.customStyles.push({ id, name, prompt: description || `match the visual style of the reference image "${name}"`, thumbnail: media.data.url, referenceUrls: [media.data.url!], custom: true });
      d.projectSettings.styleId = id;
    });
    toast(`Estilo "${name}" salvo e ativado.`);
  };

  const toStage = () => {
    if (!media?.data.url || node.type !== 'image') return;
    const id = uid();
    const scene: StageScene = { id, name: nodeTitle(node), backdropUrl: media.data.url, backdropNodeId: nodeId, objects: [], shots: [] };
    useProject.getState().update((d) => {
      d.stage.scenes[id] = scene;
      d.stage.activeSceneId = id;
    });
    onOpenStage();
  };

  return (
    <div className="node-side-menu" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <button className="menu-item" onClick={() => createDownstream(nodeId, 'image')}>
        <ImageIcon size={13} /> Imagem
      </button>
      <button className="menu-item" onClick={() => createDownstream(nodeId, 'video')}>
        <Video size={13} /> Vídeo
      </button>
      <button className="menu-item" onClick={() => createDownstream(nodeId, 'audio')}>
        <AudioLines size={13} /> Áudio
      </button>
      {media && <div className="menu-sep" />}
      {node.type === 'image' && (
        <button className="menu-item" onClick={saveAsStyle}>
          <Palette size={13} /> Salvar como Estilo
        </button>
      )}
      <button className="menu-item" onClick={() => createSection(undefined, [nodeId])}>
        <Frame size={13} /> Adicionar a uma seção
      </button>
      {media && (
        <button
          className="menu-item"
          onClick={() => {
            const n = addNodesToTimeline([nodeId]);
            toast(n ? 'Adicionado à linha do tempo.' : 'Nada para adicionar.');
          }}
        >
          <Clapperboard size={13} /> Adicionar à Linha do Tempo
        </button>
      )}
      {node.type === 'image' && (
        <button className="menu-item" onClick={toStage}>
          <Box size={13} /> Converter para 3D
        </button>
      )}
    </div>
  );
}

function MultiToolbar({ ids }: { ids: string[] }) {
  const project = useProject((s) => s.project);
  const viewport = useProject((s) => s.viewport);
  if (!project) return null;
  const nodes = ids.map((id) => project.nodes[id]).filter(Boolean);
  if (!nodes.length) return null;
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const right = Math.max(...nodes.map((n) => n.position.x + nodeSize(n, project.projectSettings.aspectRatio).width));
  const x = ((Math.min(...xs) + right) / 2) * viewport.zoom + viewport.x;
  const y = Math.min(...ys) * viewport.zoom + viewport.y - 26;
  return (
    <div className="node-toolbar" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <span className="muted" style={{ fontSize: 12, padding: '0 8px' }}>
        {ids.length} selecionados
      </span>
      <button className="icon-btn" title="Agrupar em seção (S)" onClick={() => createSection(undefined, ids)}>
        <Frame size={13} />
      </button>
      <button className="icon-btn" title="Adicionar à linha do tempo" onClick={() => toast(`${addNodesToTimeline(ids)} clipe(s) adicionados.`)}>
        <Clapperboard size={13} />
      </button>
      <button className="icon-btn" title="Anexar ao chat" onClick={() => attachToChat(ids)}>
        <MessageSquarePlus size={13} />
      </button>
      <button className="icon-btn" title="Duplicar" onClick={() => duplicateNodes(ids)}>
        <Copy size={13} />
      </button>
      <button className="icon-btn" title="Excluir" onClick={() => deleteNodes(ids)}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}
