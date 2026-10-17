import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AudioLines,
  BookOpen,
  ChevronRight,
  Clapperboard,
  Film,
  Frame,
  Hand,
  Image as ImageIcon,
  LayoutGrid,
  Library,
  Mic,
  MousePointer2,
  Music,
  Plus,
  Sparkles,
  StickyNote,
  Type,
  Upload,
  Video,
} from 'lucide-react';
import { ACTION_LIST, ACTIONS } from '../../../shared/actions';
import type { ActionType, MediaKind } from '../../../shared/types';
import { useProject } from '../../store/project';
import { toast } from '../../store/ui';
import { createMediaNode, createSection, createTextNode, organizeCanvas, pickFiles, uploadFilesToCanvas, zoomToFit } from '../../lib/canvasOps';
import { Popover, anchorRight, type Anchor } from '../ui/Menu';
import { AssetsDrawer } from './AssetsDrawer';

export function LeftToolbar({ zoomBy }: { zoomBy: (f: number) => void }) {
  const tool = useProject((s) => s.tool);
  const setTool = useProject((s) => s.setTool);
  const zoom = useProject((s) => s.viewport.zoom);
  const selection = useProject((s) => s.selection);
  const [, setParams] = useSearchParams();
  const [addMenu, setAddMenu] = useState<Anchor | null>(null);
  const [sub, setSub] = useState<{ kind: 'video' | 'more'; anchor: Anchor } | null>(null);
  const [zoomMenu, setZoomMenu] = useState<Anchor | null>(null);
  const [assets, setAssets] = useState(false);

  const close = () => {
    setAddMenu(null);
    setSub(null);
  };
  const add = (kind: MediaKind, actionType?: ActionType) => {
    close();
    createMediaNode(kind, { actionType, focus: true });
  };

  return (
    <>
      <div className="left-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button className={`icon-btn ${addMenu ? 'active' : ''}`} title="Adicionar nó" onClick={(e) => setAddMenu(addMenu ? null : anchorRight(e.currentTarget))}>
          <Plus size={17} />
        </button>
        <button className={`icon-btn ${tool === 'select' ? '' : ''}`} title={tool === 'hand' ? 'Modo seleção (V)' : 'Mudar para Modo Mão (H)'} onClick={() => setTool(tool === 'hand' ? 'select' : 'hand')}>
          {tool === 'hand' ? <Hand size={16} /> : <MousePointer2 size={16} />}
        </button>
        <button className="icon-btn" title="Adicionar Seção (S)" onClick={() => createSection(undefined, selection)}>
          <Frame size={16} />
        </button>
        <button className="icon-btn" title="Adicionar Texto (T)" onClick={() => createTextNode('', { edit: true })}>
          <Type size={16} />
        </button>
        <button className="icon-btn" title="Organizar tela" onClick={() => (organizeCanvas(), setTimeout(() => zoomToFit(), 30))}>
          <LayoutGrid size={16} />
        </button>
        <div className="sep" />
        <button className={`icon-btn ${assets ? 'active' : ''}`} title="Recursos" onClick={() => setAssets(!assets)}>
          <Library size={16} />
        </button>
        <button className="icon-btn" title="História" onClick={() => setParams({ view: 'story' })}>
          <BookOpen size={16} />
        </button>
        <button className="icon-btn" title="Editor de Vídeo" onClick={() => setParams({ view: 'editor' })}>
          <Clapperboard size={16} />
        </button>
        <div className="sep" />
        <div className="zoom-label" title="Opções de zoom" onClick={(e) => setZoomMenu(anchorRight(e.currentTarget))}>
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {assets && <AssetsDrawer onClose={() => setAssets(false)} />}

      {addMenu && (
        <Popover anchor={addMenu} onClose={close} width={210}>
          <button
            className="menu-item"
            onClick={async () => {
              close();
              const files = await pickFiles();
              uploadFilesToCanvas(files).catch((e) => toast(String(e.message), 'error'));
            }}
          >
            <Upload size={15} /> Enviar
          </button>
          <button className="menu-item" onClick={() => (close(), createTextNode('', { edit: true }))}>
            <StickyNote size={15} /> Nota de Texto
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => add('image', 'Image')}>
            <ImageIcon size={15} /> Gerar imagem
          </button>
          <button className="menu-item" onMouseEnter={(e) => setSub({ kind: 'video', anchor: anchorRight(e.currentTarget) })} onClick={(e) => setSub({ kind: 'video', anchor: anchorRight(e.currentTarget) })}>
            <Video size={15} /> <span className="grow">Gerar vídeo</span> <ChevronRight size={13} />
          </button>
          <button className="menu-item" onMouseEnter={() => setSub(null)} onClick={() => add('audio', 'TextToDialog')}>
            <Mic size={15} /> Gerar voz
          </button>
          <button className="menu-item" onMouseEnter={() => setSub(null)} onClick={() => add('audio', 'TextToMusic')}>
            <Music size={15} /> Gerar música
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onMouseEnter={(e) => setSub({ kind: 'more', anchor: anchorRight(e.currentTarget) })} onClick={(e) => setSub({ kind: 'more', anchor: anchorRight(e.currentTarget) })}>
            <Sparkles size={15} /> <span className="grow">Mais ações</span> <ChevronRight size={13} />
          </button>
        </Popover>
      )}

      {addMenu && sub?.kind === 'video' && (
        <Popover anchor={sub.anchor} onClose={() => setSub(null)} width={230}>
          {(['ImageToVideo', 'ReferenceToVideo', 'OmniReference', 'MotionToVideo', 'AudioToVideo'] as ActionType[]).map((a) => (
            <button key={a} className="menu-item" onClick={() => add('video', a)} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0, whiteSpace: 'normal' }}>
              <span>{ACTIONS[a].name}</span>
              <small>{ACTIONS[a].description}</small>
            </button>
          ))}
        </Popover>
      )}

      {addMenu && sub?.kind === 'more' && (
        <Popover anchor={sub.anchor} onClose={() => setSub(null)} width={250}>
          {(['image', 'video', 'audio'] as MediaKind[]).map((cat) => (
            <div key={cat}>
              <div className="menu-title">{cat === 'image' ? 'Imagem' : cat === 'video' ? 'Vídeo' : 'Áudio'}</div>
              {ACTION_LIST.filter((a) => a.output === cat || (cat === 'video' && a.category === 'video')).filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i).map((a) => (
                <button key={a.id} className="menu-item" onClick={() => add(a.output, a.id)}>
                  {a.output === 'image' ? <ImageIcon size={13} /> : a.output === 'video' ? <Film size={13} /> : <AudioLines size={13} />} {a.name}
                </button>
              ))}
            </div>
          ))}
        </Popover>
      )}

      {zoomMenu && (
        <Popover anchor={zoomMenu} onClose={() => setZoomMenu(null)} width={180}>
          <button className="menu-item" onClick={() => (zoomBy(1.25), setZoomMenu(null))}>
            <span className="grow">Ampliar</span> <span className="kbd">+</span>
          </button>
          <button className="menu-item" onClick={() => (zoomBy(0.8), setZoomMenu(null))}>
            <span className="grow">Reduzir</span> <span className="kbd">-</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              zoomBy(1 / useProject.getState().viewport.zoom);
              setZoomMenu(null);
            }}
          >
            <span className="grow">Zoom 100%</span>
          </button>
          <button className="menu-item" onClick={() => (zoomToFit(), setZoomMenu(null))}>
            <span className="grow">Ajustar à tela</span> <span className="kbd">⇧1</span>
          </button>
          {selection.length > 0 && (
            <button className="menu-item" onClick={() => (zoomToFit(selection), setZoomMenu(null))}>
              <span className="grow">Ir para a seleção</span>
            </button>
          )}
        </Popover>
      )}
    </>
  );
}
