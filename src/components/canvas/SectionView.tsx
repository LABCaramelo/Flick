import { memo, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useProject } from '../../store/project';
import { deleteSection } from '../../lib/canvasOps';

export const SectionView = memo(function SectionView({
  id,
  selected,
  onHeadDown,
  onResizeDown,
}: {
  id: string;
  selected: boolean;
  onHeadDown(e: React.PointerEvent, id: string): void;
  onResizeDown(e: React.PointerEvent, id: string): void;
}) {
  const section = useProject((s) => s.project?.sections[id]);
  const update = useProject((s) => s.update);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(section?.label ?? '');
  useEffect(() => setLabel(section?.label ?? ''), [section?.label]);
  if (!section) return null;

  const commit = () => {
    setEditing(false);
    if (label.trim() && label !== section.label)
      update((d) => {
        d.sections[id].label = label.trim();
      });
  };

  return (
    <div
      className={`section ${selected ? 'selected' : ''} ${section.collapsed ? 'collapsed' : ''}`}
      data-section-id={id}
      style={{ transform: `translate(${section.position.x}px, ${section.position.y}px)`, width: section.dimensions.width, height: section.dimensions.height }}
    >
      <div className="section-head" onPointerDown={(e) => onHeadDown(e, id)} onDoubleClick={() => setEditing(true)}>
        <button
          className="icon-btn"
          title={section.collapsed ? 'Expandir seção' : 'Recolher seção'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            update((d) => {
              d.sections[id].collapsed = !d.sections[id].collapsed;
            })
          }
        >
          {section.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        {editing ? (
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') commit();
            }}
          />
        ) : (
          <span>{section.label}</span>
        )}
        {selected && (
          <button className="icon-btn" title="Excluir seção (mantém os nós)" onPointerDown={(e) => e.stopPropagation()} onClick={() => deleteSection(id)}>
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {!section.collapsed && <div className="section-resize" onPointerDown={(e) => onResizeDown(e, id)} />}
    </div>
  );
});
