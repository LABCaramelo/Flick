/**
 * Sticker trail behind the mouse — ported from @caramelo/design-system (motion/pointer.ts).
 * Fixed pool, no permanent RAF, never covers controls; clears on scroll, click, focus or tab change.
 * Only runs with a fine pointer and full motion (touch and reduced motion see just the content).
 */

const TRAIL = { minDistance: 64, minInterval: 85, lifetime: 1100, scrollPause: 140, easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)' };
const FINE = '(hover: hover) and (pointer: fine)';
const REDUCED = '(prefers-reduced-motion: reduce)';

export const INTERACTIVE_SELECTOR =
  'a,button,input,select,textarea,summary,label,[role="button"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';

export function trailEnabled(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const off = new URLSearchParams(window.location.search).get('motion') === 'off' || document.documentElement.dataset.motion === 'off';
  return !off && window.matchMedia(FINE).matches && !window.matchMedia(REDUCED).matches;
}

export function watchTrailEnv(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const lists = [FINE, REDUCED].map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener('change', callback));
  return () => lists.forEach((l) => l.removeEventListener('change', callback));
}

interface Options {
  container: HTMLElement;
  slots: HTMLElement[];
  /** width/height of a slot; stickers are square boxes with object-fit: contain */
  aspect?: number;
}

export function createPointerTrail({ container, slots: elements, aspect = 1 }: Options): () => void {
  if (!elements.length || !Element.prototype.animate) return () => {};
  const widthOf = () => Math.min(196, Math.max(130, window.innerWidth * 0.135));
  const slots = elements.map((el) => ({ el, animation: null as Animation | null }));

  let enabled = false;
  let last: { x: number; y: number; time: number } | null = null;
  let bounds: DOMRect | null = null;
  let controls: DOMRect[] = [];
  let cursor = 0;
  let sequence = 0;
  let suspendedUntil = 0;

  const cancel = (slot: (typeof slots)[number]) => {
    if (slot.animation) {
      slot.animation.onfinish = null;
      slot.animation.cancel();
      slot.animation = null;
    }
    slot.el.dataset.active = 'false';
    slot.el.style.opacity = '0';
  };
  const clear = () => {
    slots.forEach(cancel);
    last = null;
    bounds = null;
    controls = [];
  };

  const measure = () => {
    bounds = container.getBoundingClientRect();
    controls = Array.from(container.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR))
      .filter((e) => {
        const s = getComputedStyle(e);
        return s.visibility !== 'hidden' && s.display !== 'none';
      })
      .map((e) => e.getBoundingClientRect());
  };

  const move = (event: PointerEvent) => {
    if (!enabled || event.pointerType !== 'mouse' || event.buttons || document.hidden) return clear();
    const now = performance.now();
    if (now < suspendedUntil) return;
    if (!bounds) measure();
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) {
      last = null;
      return;
    }
    const point = { x: event.clientX, y: event.clientY, time: now };
    if (!last) {
      last = point;
      return;
    }
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (Math.hypot(dx, dy) < TRAIL.minDistance || now - last.time < TRAIL.minInterval) return;

    const b = bounds!;
    const width = widthOf();
    const height = width / aspect;
    if (b.height < height + 24 || b.width < width) return;
    const x = Math.max(b.left + width / 2, Math.min(b.right - width / 2, point.x));
    const y = Math.max(b.top + height / 2 + 12, Math.min(b.bottom - height / 2 - 12, point.y));
    const fp = { l: x - width / 2 - 32, r: x + width / 2 + 32, t: y - height / 2 - 24, b: y + height / 2 + 44 };
    // never cover a control
    if (controls.some((c) => c.width && c.height && fp.l < c.right && fp.r > c.left && fp.t < c.bottom && fp.b > c.top)) {
      last = point;
      return;
    }

    const slot = slots[cursor++ % slots.length];
    cancel(slot);
    const angle = (sequence % 2 ? -1 : 1) * (4 + (sequence % 5));
    const drift = Math.max(-18, Math.min(18, dx * 0.06));
    slot.el.style.width = `${width}px`;
    slot.el.style.height = `${height}px`;
    slot.el.style.left = `${x - b.left - width / 2}px`;
    slot.el.style.top = `${y - b.top - height / 2}px`;
    slot.el.style.zIndex = String(++sequence);
    slot.el.dataset.active = 'true';
    const animation = slot.el.animate(
      [
        { opacity: 0, transform: `translate3d(0,14px,0) rotate(${angle - 5}deg) scale(.82)`, offset: 0 },
        { opacity: 1, transform: `translate3d(0,0,0) rotate(${angle}deg) scale(1)`, offset: 0.12 },
        { opacity: 1, transform: `translate3d(${drift * 0.45}px,-4px,0) rotate(${angle}deg) scale(1)`, offset: 0.56 },
        { opacity: 0, transform: `translate3d(${drift}px,22px,0) rotate(${angle + 5}deg) scale(.94)`, offset: 1 },
      ],
      { duration: TRAIL.lifetime, easing: TRAIL.easing, fill: 'none' },
    );
    slot.animation = animation;
    animation.onfinish = () => {
      if (slot.animation !== animation) return;
      slot.animation = null;
      slot.el.dataset.active = 'false';
    };
    last = point;
  };

  const ac = new AbortController();
  const signal = ac.signal;
  const sync = () => {
    enabled = trailEnabled();
    if (!enabled) clear();
  };
  sync();
  const unwatch = watchTrailEnv(sync);
  container.addEventListener('pointermove', move, { passive: true, signal });
  container.addEventListener('pointerenter', measure, { passive: true, signal });
  container.addEventListener('pointerleave', clear, { passive: true, signal });
  window.addEventListener(
    'scroll',
    () => {
      suspendedUntil = performance.now() + TRAIL.scrollPause;
      clear();
    },
    { capture: true, passive: true, signal },
  );
  window.addEventListener('resize', clear, { passive: true, signal });
  window.addEventListener('blur', clear, { signal });
  document.addEventListener('visibilitychange', clear, { signal });
  document.addEventListener('pointerdown', clear, { capture: true, passive: true, signal });
  document.addEventListener('focusin', clear, { signal });

  return () => {
    ac.abort();
    unwatch();
    clear();
  };
}
