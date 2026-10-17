import { useId, type SVGProps } from 'react';
import geometry from './isotype-geometry.json';

// Ported from @caramelo/design-system (Isotype). Geometry traced from the LABCaramelo icon.
const SPECTRUM = ['#FF701A', '#FF3D8D', '#7657FF', '#25BFFF', '#FFD52A'];
const STOPS = [0, 24, 48, 72, 100];

type Variant = 'caramel' | 'spectrum' | 'ink' | 'cream' | 'current';

interface IsotypeProps extends Omit<SVGProps<SVGSVGElement>, 'title'> {
  variant?: Variant;
  size?: number | string;
  title?: string;
  decorative?: boolean;
  /** Spectral echo on hover/focus of the symbol or its link. */
  interactive?: boolean;
}

/** Handwritten C with dot. Caramel = Ink symbol on the #FF701A tile. */
export function Isotype({ variant = 'caramel', size = 32, title = 'Um Cara Caramelo', decorative = false, interactive = false, className, ...props }: IsotypeProps) {
  const id = `cm-isotype-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fill = variant === 'spectrum' ? `url(#${id}-gradient)` : variant === 'ink' || variant === 'caramel' ? '#101014' : variant === 'cream' ? '#FFF4E8' : 'currentColor';
  const classes = ['cm-isotype', interactive && 'cm-isotype--interactive', className].filter(Boolean).join(' ');
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={geometry.viewBox}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-labelledby={decorative ? undefined : `${id}-title`}
      className={classes}
      {...props}
    >
      {!decorative && <title id={`${id}-title`}>{title}</title>}
      <defs>
        <linearGradient id={`${id}-gradient`} x1="0%" y1="15%" x2="100%" y2="85%">
          {SPECTRUM.map((color, i) => (
            <stop key={color} offset={`${STOPS[i]}%`} stopColor={color} />
          ))}
        </linearGradient>
        <g id={`${id}-shape`}>
          {geometry.paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </defs>
      {variant === 'caramel' && <rect width="256" height="256" rx={geometry.tileRadius} fill="#FF701A" />}
      {interactive && (
        <g className="cm-isotype__echo" aria-hidden="true">
          <use href={`#${id}-shape`} fill={`url(#${id}-gradient)`} />
        </g>
      )}
      <g className="cm-isotype__ink">
        <use href={`#${id}-shape`} fill={fill} />
      </g>
    </svg>
  );
}
