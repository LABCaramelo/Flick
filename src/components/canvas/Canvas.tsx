import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AudioLines, FileText, Image as ImageIcon, Upload, Video } from 'lucide-react';
import { nodeSize } from '../../../shared/project';
import type { MediaKind, MediaNode, Vec2 } from '../../../shared/types';
import { useProject } from '../../store/project';
import { toast } from '../../store/ui';
import {
  connect,
  copySelection,
  createDownstream,
  createMediaNode,
  createSection,
  createTextNode,
  deleteNodes,
  deleteSection,
  disconnect,
  duplicateNodes,
  pasteClipboard,
  rectOf,
  refreshMembership,
  uploadFilesToCanvas,
  zoomToFit,
} from '../../lib/canvasOps';
import { NodeView, type NodeHandlers } from './NodeView';
import { EdgesLayer } from './EdgesLayer';
import { SectionView } from './SectionView';
import { LeftToolbar } from './LeftToolbar';
import { NodeOverlays } from './NodeOverlays';
import { Popover } from '../ui/Menu';
import './canvas.css';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; sx: number; sy: number; nodes: Record<string, Vec2>; sections: Record<string, Vec2>; snap: ReturnType<ReturnType<typeof useProject.getState>['snapshot']>; moved: boolean; clickId?: string }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'resize'; id: string; sx: number; sy: number; w0: number; h0: number; snap: ReturnType<ReturnType<typeof useProject.getState>['snapshot']> }
  | { kind: 'resize-section'; id: string; sx: number; sy: number; w0: number; h0: number; snap: ReturnType<ReturnType<typeof useProject.getState>['snapshot']> }
  | { kind: 'edge'; source: string; from: Vec2; to: Vec2; target: string | null };

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function Canvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const [dragView, setDragView] = useState<Drag | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number; source: string; world: Vec2 } | null>(null);

  const viewport = useProject((s) => s.viewport);
  const tool = useProject((s) => s.tool);
  const pick = useProject((s) => s.pick);
  const selection = useProject((s) => s.selection);
  const selectedSection = useProject((s) => s.selectedSection);
  const hasProject = useProject((s) => !!s.project);
  const sectionIds = useProject(useShallow((s) => Object.keys(s.project?.sections ?? {})));
  const nodeIds = useProject(
    useShallow((s) => {
      const p = s.project;
      if (!p) return [] as string[];
      return Object.values(p.nodes)
        .filter((n) => !(n.sectionId && p.sections[n.sectionId]?.collapsed))
        .map((n) => n.id);
    }),
  );
  const selSet = useMemo(() => new Set(selection), [selection]);

  const toWorld = useCallback((clientX: number, clientY: number): Vec2 => {
    const r = rootRef.current!.getBoundingClientRect();
    const v = useProject.getState().viewport;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }, []);

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragView(d ? { ...d } : null);
  };

  // first open: center content
  useEffect(() => {
    if (hasProject) requestAnimationFrame(() => zoomToFit());
  }, [hasProject]);

  // ---------- wheel: ctrl/⌘ zooms at cursor, otherwise pans ----------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.gen-panel, .node-side-menu, .note, .menu')) return;
      e.preventDefault();
      const { viewport: v, setViewport } = useProject.getState();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const zoom = Math.max(0.08, Math.min(4, v.zoom * Math.exp(-e.deltaY * 0.0022)));
        setViewport({ zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom });
      } else {
        setViewport({ x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- global pointer move / up while dragging ----------
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const st = useProject.getState();
      if (d.kind === 'pan') {
        st.setViewport({ x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) });
      } else if (d.kind === 'move') {
        const z = st.viewport.zoom;
        const dx = (e.clientX - d.sx) / z;
        const dy = (e.clientY - d.sy) / z;
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
        d.moved = true;
        st.update(
          (p) => {
            for (const [id, o] of Object.entries(d.nodes)) if (p.nodes[id]) p.nodes[id].position = { x: o.x + dx, y: o.y + dy };
            for (const [id, o] of Object.entries(d.sections)) if (p.sections[id]) p.sections[id].position = { x: o.x + dx, y: o.y + dy };
          },
          { record: false },
        );
      } else if (d.kind === 'marquee') {
        const w = toWorld(e.clientX, e.clientY);
        d.x1 = w.x;
        d.y1 = w.y;
        setDragView({ ...d });
      } else if (d.kind === 'resize') {
        const z = st.viewport.zoom;
        const w = Math.max(120, d.w0 + (e.clientX - d.sx) / z);
        st.update(
          (p) => {
            const n = p.nodes[d.id];
            if (!n) return;
            if (n.type === 'text' || n.type === 'richtext') n.data.dimensions = { width: Math.max(160, w), height: Math.max(80, d.h0 + (e.clientY - d.sy) / z) };
            else if (n.type === 'image' || n.type === 'video' || n.type === 'audio') n.data.displayWidth = Math.round(w);
          },
          { record: false },
        );
      } else if (d.kind === 'resize-section') {
        const z = st.viewport.zoom;
        st.update(
          (p) => {
            const s = p.sections[d.id];
            if (s) s.dimensions = { width: Math.max(200, d.w0 + (e.clientX - d.sx) / z), height: Math.max(120, d.h0 + (e.clientY - d.sy) / z) };
          },
          { record: false },
        );
      } else if (d.kind === 'edge') {
        d.to = toWorld(e.clientX, e.clientY);
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node-id]') as HTMLElement | null;
        const target = el?.dataset.nodeId ?? null;
        const n = target ? st.project?.nodes[target] : undefined;
        d.target = n && target !== d.source && (n as MediaNode).data && 'generationSettings' in (n as MediaNode).data ? target : null;
        setDragView({ ...d });
      }
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const st = useProject.getState();
      if (d.kind === 'move') {
        if (d.moved) {
          if (d.snap) st.pushSnapshot(d.snap);
          refreshMembership(Object.keys(d.nodes));
        } else if (d.clickId && !e.shiftKey && st.selection.length > 1) {
          st.select([d.clickId]);
        }
      } else if ((d.kind === 'resize' || d.kind === 'resize-section') && d.snap) {
        st.pushSnapshot(d.snap);
      } else if (d.kind === 'marquee') {
        const x0 = Math.min(d.x0, d.x1);
        const x1 = Math.max(d.x0, d.x1);
        const y0 = Math.min(d.y0, d.y1);
        const y1 = Math.max(d.y0, d.y1);
        const p = st.project;
        if (p && (x1 - x0 > 2 || y1 - y0 > 2)) {
          const hit = Object.values(p.nodes)
            .filter((n) => {
              const r = rectOf(p, n);
              return r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0;
            })
            .map((n) => n.id);
          st.select(hit, d.additive ? 'add' : 'replace');
        }
      } else if (d.kind === 'edge') {
        if (d.target) {
          const err = connect(d.source, d.target);
          if (err) toast(err, 'error');
        } else if (Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y) > 30) {
          setCreateMenu({ x: e.clientX, y: e.clientY, source: d.source, world: d.to });
        }
      }
      setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [toWorld]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const st = useProject.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.code === 'Space' && !spaceDown.current) {
        spaceDown.current = true;
        rootRef.current?.classList.add('hand');
        return;
      }
      if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        st.redo();
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicateNodes(st.selection);
      } else if (mod && k === 'c') {
        copySelection();
      } else if (mod && k === 'a') {
        e.preventDefault();
        st.select(Object.keys(st.project?.nodes ?? {}));
      } else if (k === 'delete' || k === 'backspace') {
        if (st.selection.length) deleteNodes(st.selection);
        else if (st.selectedSection) deleteSection(st.selectedSection);
        else if (st.selectedEdge) {
          disconnect(st.selectedEdge);
          st.selectEdge(null);
        }
      } else if (k === 'escape') {
        if (st.pick) st.setPick(null);
        else st.clearSelection();
      } else if (!mod && k === 't') {
        createTextNode('', { edit: true });
      } else if (!mod && k === 's') {
        createSection(undefined, st.selection);
      } else if (!mod && k === 'h') {
        st.setTool(st.tool === 'hand' ? 'select' : 'hand');
      } else if (!mod && k === 'v') {
        st.setTool('select');
      } else if (!mod && (k === '=' || k === '+')) {
        zoomBy(1.2);
      } else if (!mod && k === '-') {
        zoomBy(1 / 1.2);
      } else if (e.shiftKey && (k === '!' || e.code === 'Digit1')) {
        zoomToFit();
      } else if (k === 'enter' && st.selection.length === 1) {
        e.preventDefault();
        st.requestPromptFocus(st.selection[0]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        if (useProject.getState().tool !== 'hand') rootRef.current?.classList.remove('hand');
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        uploadFilesToCanvas(files).catch((err) => toast(String(err.message), 'error'));
      } else {
        pasteClipboard();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const zoomBy = (f: number) => {
    const el = rootRef.current;
    if (!el) return;
    const { viewport: v, setViewport } = useProject.getState();
    const zoom = Math.max(0.08, Math.min(4, v.zoom * f));
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setViewport({ zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom });
  };

  // ---------- pointer down handlers ----------

  const onBackgroundDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.left-toolbar, .gen-panel, .node-toolbar, .node-side-menu, .pick-banner')) return;
    const st = useProject.getState();
    if (e.button === 1 || e.button === 2 || st.tool === 'hand' || spaceDown.current) {
      e.preventDefault();
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: st.viewport.x, vy: st.viewport.y });
      return;
    }
    if (e.button !== 0) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (st.pick) {
      st.setPick(null);
      return;
    }
    if (!e.shiftKey) st.clearSelection();
    const w = toWorld(e.clientX, e.clientY);
    setDrag({ kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, additive: e.shiftKey });
  };

  const handlers: NodeHandlers = useMemo(
    () => ({
      onNodeDown(e, id) {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('audio, textarea, .node-error button')) return;
        e.stopPropagation();
        const st = useProject.getState();
        if (st.tool === 'hand' || spaceDown.current) {
          setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: st.viewport.x, vy: st.viewport.y });
          return;
        }
        if (st.pick) {
          const err = connect(id, st.pick.nodeId, st.pick.inputId);
          if (err) toast(err, 'error');
          else st.setPick(null);
          return;
        }
        if (st.editingTextId && st.editingTextId !== id) st.setEditingText(null);
        let sel = st.selection;
        if (e.shiftKey) {
          st.select([id], 'toggle');
          return;
        }
        if (!sel.includes(id)) {
          st.select([id]);
          sel = [id];
        }
        const p = st.project!;
        const nodes: Record<string, Vec2> = {};
        for (const nid of sel) if (p.nodes[nid]) nodes[nid] = { ...p.nodes[nid].position };
        setDrag({ kind: 'move', sx: e.clientX, sy: e.clientY, nodes, sections: {}, snap: st.snapshot(), moved: false, clickId: id });
      },
      onHandleDown(e, id) {
        if (e.button !== 0) return;
        e.stopPropagation();
        const p = useProject.getState().project!;
        const n = p.nodes[id];
        const s = nodeSize(n, p.projectSettings.aspectRatio);
        const from = { x: n.position.x + s.width, y: n.position.y + s.height / 2 };
        setDrag({ kind: 'edge', source: id, from, to: from, target: null });
      },
      onResizeDown(e, id) {
        if (e.button !== 0) return;
        e.stopPropagation();
        const st = useProject.getState();
        const p = st.project!;
        const s = nodeSize(p.nodes[id], p.projectSettings.aspectRatio);
        setDrag({ kind: 'resize', id, sx: e.clientX, sy: e.clientY, w0: s.width, h0: s.height, snap: st.snapshot() });
      },
    }),
    [],
  );

  const onSectionHeadDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useProject.getState();
    const p = st.project!;
    st.selectSection(id);
    const nodes: Record<string, Vec2> = {};
    for (const n of Object.values(p.nodes)) if (n.sectionId === id) nodes[n.id] = { ...n.position };
    setDrag({ kind: 'move', sx: e.clientX, sy: e.clientY, nodes, sections: { [id]: { ...p.sections[id].position } }, snap: st.snapshot(), moved: false });
  }, []);

  const onSectionResizeDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useProject.getState();
    const s = st.project!.sections[id];
    setDrag({ kind: 'resize-section', id, sx: e.clientX, sy: e.clientY, w0: s.dimensions.width, h0: s.dimensions.height, snap: st.snapshot() });
  }, []);

  // ---------- drag & drop files ----------
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropHover(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    try {
      await uploadFilesToCanvas(files, toWorld(e.clientX, e.clientY));
    } catch (err) {
      toast(String((err as Error).message), 'error');
    }
  };

  const createFromDrop = (kind: MediaKind | 'text') => {
    if (!createMenu) return;
    const { source, world } = createMenu;
    setCreateMenu(null);
    if (kind === 'text') {
      createTextNode('', { position: world, edit: true });
      return;
    }
    const id = createDownstream(source, kind);
    if (id)
      useProject.getState().update(
        (p) => {
          if (p.nodes[id]) p.nodes[id].position = { x: world.x, y: world.y - 100 };
        },
        { record: false },
      );
  };

  const marquee = dragView?.kind === 'marquee' ? dragView : null;
  const edgeDrag = dragView?.kind === 'edge' ? dragView : null;
  const empty = nodeIds.length === 0 && sectionIds.length === 0;
  const gridSize = 24 * viewport.zoom;

  return (
    <div
      ref={rootRef}
      className={`canvas-root ${tool === 'hand' ? 'hand' : ''} ${dragView?.kind === 'pan' ? 'panning' : ''} ${pick ? 'picking' : ''} ${edgeDrag ? 'connecting' : ''}`}
      style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }}
      onPointerDown={onBackgroundDown}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropHover(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropHover(false);
      }}
      onDrop={onDrop}
      tabIndex={-1}
    >
      <div className="world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, ['--z' as string]: viewport.zoom }}>
        {sectionIds.map((id) => (
          <SectionView key={id} id={id} selected={selectedSection === id} onHeadDown={onSectionHeadDown} onResizeDown={onSectionResizeDown} />
        ))}
        <EdgesLayer temp={edgeDrag ? { from: edgeDrag.from, to: edgeDrag.to } : null} />
        {nodeIds.map((id) => (
          <NodeView key={id} id={id} handlers={handlers} selected={selSet.has(id)} dropTarget={edgeDrag?.target === id} />
        ))}
      </div>

      {marquee && (
        <div
          className="marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1) * viewport.zoom + viewport.x,
            top: Math.min(marquee.y0, marquee.y1) * viewport.zoom + viewport.y,
            width: Math.abs(marquee.x1 - marquee.x0) * viewport.zoom,
            height: Math.abs(marquee.y1 - marquee.y0) * viewport.zoom,
          }}
        />
      )}

      {empty && (
        <div className="canvas-empty">
          <div>
            <h2>Tela em branco</h2>
            <p>Arraste arquivos para cá, adicione um nó pela barra à esquerda ou peça ao agente para começar.</p>
            <div className="row">
              <button className="btn btn-sm" onClick={() => createMediaNode('image', { focus: true })}>
                <ImageIcon size={12} /> Gerar imagem
              </button>
              <button className="btn btn-sm" onClick={() => createMediaNode('video', { actionType: 'ReferenceToVideo', focus: true })}>
                <Video size={12} /> Gerar vídeo
              </button>
              <button className="btn btn-sm" onClick={() => createTextNode('', { edit: true })}>
                <FileText size={12} /> Nota
              </button>
            </div>
          </div>
        </div>
      )}

      {pick && (
        <div className="pick-banner">
          Clique numa mídia do canvas para conectar · <span className="kbd" style={{ color: 'inherit' }}>Esc</span> cancela
        </div>
      )}

      {dropHover && (
        <div className="drop-overlay">
          <div className="row">
            <Upload size={16} /> Solte para enviar ao canvas
          </div>
        </div>
      )}

      <LeftToolbar zoomBy={zoomBy} />
      {hasProject && <NodeOverlays />}

      {createMenu && (
        <Popover anchor={{ x: createMenu.x, y: createMenu.y }} onClose={() => setCreateMenu(null)}>
          <div className="menu-title">Criar a partir daqui</div>
          <button className="menu-item" onClick={() => createFromDrop('image')}>
            <ImageIcon size={14} /> Imagem
          </button>
          <button className="menu-item" onClick={() => createFromDrop('video')}>
            <Video size={14} /> Vídeo
          </button>
          <button className="menu-item" onClick={() => createFromDrop('audio')}>
            <AudioLines size={14} /> Áudio
          </button>
          <button className="menu-item" onClick={() => createFromDrop('text')}>
            <FileText size={14} /> Nota de texto
          </button>
        </Popover>
      )}
    </div>
  );
}
