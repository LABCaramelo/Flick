import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Anchor {
  x: number;
  y: number;
  /** open upward/leftward when there is no room */
  align?: 'start' | 'end';
}

/** Fixed-position popover that closes on outside click / Escape and stays on screen. */
export function Popover({ anchor, onClose, children, className = 'menu', width }: { anchor: Anchor; onClose: () => void; children: ReactNode; className?: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = anchor.align === 'end' ? anchor.x - r.width : anchor.x;
    let top = anchor.y;
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, anchor.y - r.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [anchor.x, anchor.y, anchor.align]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => window.addEventListener('pointerdown', down, true), 0);
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className={className} style={{ left: pos.left, top: pos.top, width }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

export function anchorBelow(el: HTMLElement, align: 'start' | 'end' = 'start'): Anchor {
  const r = el.getBoundingClientRect();
  return { x: align === 'end' ? r.right : r.left, y: r.bottom + 4, align };
}

export function anchorRight(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  return { x: r.right + 6, y: r.top };
}

/** Small dropdown built on Popover. */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  renderLabel,
  title,
  icon,
  width = 260,
}: {
  value: T;
  options: { value: T; label: string; description?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  renderLabel?: (v: T) => ReactNode;
  title?: string;
  icon?: ReactNode;
  width?: number;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button className="chip" title={title} onClick={(e) => setAnchor(anchorBelow(e.currentTarget))}>
        {icon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{renderLabel ? renderLabel(value) : current?.label ?? value}</span>
        <svg width="8" height="8" viewBox="0 0 10 10" style={{ opacity: 0.6 }}>
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={width}>
          {title && <div className="menu-title">{title}</div>}
          {options.map((o) => (
            <button
              key={o.value}
              className={`menu-item ${o.value === value ? 'selected' : ''}`}
              disabled={o.disabled}
              onClick={() => {
                onChange(o.value);
                setAnchor(null);
              }}
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, whiteSpace: 'normal' }}
            >
              <span>{o.label}</span>
              {o.description && <small>{o.description}</small>}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}
