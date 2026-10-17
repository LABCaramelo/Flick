import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { MediaNode } from '../../../shared/types';
import { useProject } from '../../store/project';
import { useUi } from '../../store/ui';

export function FullscreenViewer() {
  const id = useUi((s) => s.fullscreenNodeId);
  const close = () => useUi.getState().setFullscreenNode(null);
  const node = useProject((s) => (id ? (s.project?.nodes[id] as MediaNode | undefined) : undefined));
  const update = useProject((s) => s.update);

  useEffect(() => {
    if (!id) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [id]);

  if (!id || !node?.data.url) return null;
  const versions = node.data.versions ?? [];
  return (
    <div className="fullscreen-viewer" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <button className="icon-btn fs-close" onClick={close}>
        <X size={18} />
      </button>
      {node.type === 'image' && <img src={node.data.url} alt="" />}
      {node.type === 'video' && <video src={node.data.url} controls autoPlay loop />}
      {node.type === 'audio' && <audio src={node.data.url} controls autoPlay />}
      {versions.length > 1 && (
        <div className="fs-versions">
          {versions.map((v, i) => (
            <button
              key={v.url}
              className={v.url === node.data.url ? 'on' : ''}
              onClick={() =>
                update((d) => {
                  Object.assign((d.nodes[id] as MediaNode).data, { url: v.url, remoteUrl: v.remoteUrl, width: v.width, height: v.height, duration: v.duration, activeVersion: i });
                })
              }
            >
              {node.type === 'image' ? <img src={v.url} alt="" /> : node.type === 'video' ? <video src={v.url} muted /> : `v${i + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
