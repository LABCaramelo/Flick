import { useState } from 'react';
import { X } from 'lucide-react';
import { nodeTitle } from '../../../shared/project';
import type { MediaNode } from '../../../shared/types';
import { useProject } from '../../store/project';
import { zoomToFit } from '../../lib/canvasOps';

export function AssetsDrawer({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project);
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'audio' | 'fav'>('all');
  if (!project) return null;
  const media = Object.values(project.nodes).filter((n): n is MediaNode => (n.type === 'image' || n.type === 'video' || n.type === 'audio') && !!(n as MediaNode).data.url);
  const shown = media.filter((n) => (filter === 'all' ? true : filter === 'fav' ? n.data.favorite : n.type === filter));
  return (
    <div className="assets-drawer" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="assets-head">
        <span className="label">Recursos · {media.length}</span>
        <button className="icon-btn" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="assets-filters">
        {(
          [
            ['all', 'Todos'],
            ['image', 'Imagens'],
            ['video', 'Vídeos'],
            ['audio', 'Áudios'],
            ['fav', 'Favoritos'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="assets-grid">
        {shown.map((n) => (
          <button
            key={n.id}
            className="asset"
            title={nodeTitle(n)}
            onClick={() => {
              useProject.getState().select([n.id]);
              zoomToFit([n.id]);
            }}
          >
            {n.type === 'image' && <img src={n.data.url} alt="" loading="lazy" />}
            {n.type === 'video' && <video src={n.data.url} muted preload="metadata" />}
            {n.type === 'audio' && <div className="asset-audio">♪</div>}
            <span>{nodeTitle(n)}</span>
          </button>
        ))}
        {!shown.length && <div className="muted" style={{ padding: 12, fontSize: 12 }}>Nada aqui ainda.</div>}
      </div>
    </div>
  );
}
