import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { createPointerTrail, trailEnabled, watchTrailEnv } from './trailEngine';

// The 28 canonical stickers from "rastro mouse.png" (public/caramelo/stickers, transparent WebP).
const STICKERS = [
  'cadeira', 'copo', 'lata', 'spray', 'violao', 'bola', 'chinelo', 'onibus', 'capacete', 'poste',
  'luminaria', 'rolo', 'caderno', 'camera', 'bilhete', 'caneca', 'folha', 'planta', 'raio', 'coracao',
  'olho', 'arcos', 'caramelo', 'palmeira', 'estrelas', 'coroa', 'seta', 'conexoes',
].map((id) => `/caramelo/stickers/${id}.webp`);

/**
 * Decorative sticker trail behind the cursor (`<PointerTrail appearance="stickers">` of the Caramelo DS).
 * Never a click target, never covers controls; touch and reduced motion get just the children.
 */
export function PointerTrail({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(trailEnabled);

  useEffect(() => watchTrailEnv(() => setEnabled(trailEnabled())), []);

  useEffect(() => {
    const container = containerRef.current;
    const layer = layerRef.current;
    if (!container || !layer || !enabled) return;
    return createPointerTrail({ container, slots: Array.from(layer.children) as HTMLElement[] });
  }, [enabled]);

  return (
    <div ref={containerRef} className={['cm-trail', 'cm-trail--stickers', className].filter(Boolean).join(' ')} {...props}>
      {children}
      <div ref={layerRef} className="cm-trail__layer" aria-hidden="true">
        {enabled &&
          STICKERS.map((src) => (
            <div key={src} className="cm-trail__slot" data-active="false">
              <img src={src} alt="" draggable={false} decoding="async" />
            </div>
          ))}
      </div>
    </div>
  );
}
