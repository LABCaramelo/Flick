import { memo } from 'react';
import { ACTIONS } from '../../../shared/actions';
import { nodeSize } from '../../../shared/project';
import type { MediaNode, Project, Vec2 } from '../../../shared/types';
import { useProject } from '../../store/project';

export function edgePath(a: Vec2, b: Vec2) {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function anchor(p: Project, id: string, side: 'in' | 'out'): Vec2 | null {
  const n = p.nodes[id];
  if (!n) return null;
  const s = nodeSize(n, p.projectSettings.aspectRatio);
  const sec = n.sectionId ? p.sections[n.sectionId] : undefined;
  if (sec?.collapsed) return { x: sec.position.x + (side === 'out' ? 200 : 0), y: sec.position.y - 14 };
  return { x: n.position.x + (side === 'out' ? s.width : 0), y: n.position.y + s.height / 2 };
}

function inputLabel(p: Project, targetId: string, inputId: string) {
  if (inputId === 'prompt') return 'prompt';
  const t = p.nodes[targetId] as MediaNode | undefined;
  const a = t?.data.generationSettings ? ACTIONS[t.data.generationSettings.actionType] : undefined;
  return a?.mediaInputs.find((m) => m.id === inputId)?.label ?? inputId;
}

export const EdgesLayer = memo(function EdgesLayer({ temp }: { temp: { from: Vec2; to: Vec2 } | null }) {
  const project = useProject((s) => s.project);
  const selectedEdge = useProject((s) => s.selectedEdge);
  const selectEdge = useProject((s) => s.selectEdge);
  if (!project) return null;
  return (
    <svg className="edges">
      {project.edges.map((e) => {
        const a = anchor(project, e.source, 'out');
        const b = anchor(project, e.target, 'in');
        if (!a || !b) return null;
        const d = edgePath(a, b);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return (
          <g key={e.id} className={`edge-group ${selectedEdge === e.id ? 'selected' : ''}`}>
            <path className="edge-path" d={d} />
            <path
              className="edge-hit"
              d={d}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                selectEdge(e.id);
              }}
            />
            <text className="edge-label" x={mid.x} y={mid.y - 6} textAnchor="middle">
              {inputLabel(project, e.target, e.data.mediaInputId)}
            </text>
          </g>
        );
      })}
      {temp && <path className="edge-temp" d={edgePath(temp.from, temp.to)} />}
    </svg>
  );
});
