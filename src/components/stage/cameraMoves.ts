import type { CameraMove, CameraPose } from '../../../shared/types';

export const MOVES: { id: CameraMove; label: string; prompt: string }[] = [
  { id: 'static', label: 'Fixa', prompt: 'static locked-off camera' },
  { id: 'dolly_in', label: 'Dolly in', prompt: 'slow dolly in toward the subject' },
  { id: 'dolly_out', label: 'Dolly out', prompt: 'slow dolly out revealing the space' },
  { id: 'truck_left', label: 'Travelling ←', prompt: 'lateral tracking shot moving left' },
  { id: 'truck_right', label: 'Travelling →', prompt: 'lateral tracking shot moving right' },
  { id: 'pan_left', label: 'Pan ←', prompt: 'smooth pan to the left' },
  { id: 'pan_right', label: 'Pan →', prompt: 'smooth pan to the right' },
  { id: 'pan_sweep', label: 'Pan amplo', prompt: 'wide sweeping pan across the scene' },
  { id: 'crane_up', label: 'Grua ↑', prompt: 'crane shot rising up' },
  { id: 'crane_down', label: 'Grua ↓', prompt: 'crane shot descending' },
  { id: 'orbit_left', label: 'Órbita ←', prompt: 'orbiting around the subject to the left' },
  { id: 'orbit_right', label: 'Órbita →', prompt: 'orbiting around the subject to the right' },
  { id: 'dolly_zoom', label: 'Dolly zoom', prompt: 'vertigo dolly zoom effect' },
  { id: 'custom', label: 'Personalizado', prompt: 'camera moves from the first framing to the last framing' },
];

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

function rotY(v: V3, deg: number): V3 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

export function defaultPose(): CameraPose {
  return { position: [0, 1.6, 6], target: [0, 1.3, 0], fov: 45 };
}

/** End pose for a preset move, derived from the start pose. */
export function presetEnd(move: CameraMove, start: CameraPose, customEnd?: CameraPose): CameraPose {
  const { position: p, target: t, fov } = start;
  const dir = sub(t, p);
  const d = len(dir) || 1;
  const side: V3 = (() => {
    const s: V3 = [dir[2], 0, -dir[0]];
    const l = Math.hypot(s[0], s[2]) || 1;
    return [s[0] / l, 0, s[2] / l];
  })();
  switch (move) {
    case 'dolly_in':
      return { position: add(p, mul(dir, 0.35)), target: t, fov };
    case 'dolly_out':
      return { position: add(p, mul(dir, -0.5)), target: t, fov };
    case 'truck_left':
      return { position: add(p, mul(side, d * 0.3)), target: add(t, mul(side, d * 0.3)), fov };
    case 'truck_right':
      return { position: add(p, mul(side, -d * 0.3)), target: add(t, mul(side, -d * 0.3)), fov };
    case 'pan_left':
      return { position: p, target: add(p, rotY(dir, 25)), fov };
    case 'pan_right':
      return { position: p, target: add(p, rotY(dir, -25)), fov };
    case 'pan_sweep':
      return { position: p, target: add(p, rotY(dir, -50)), fov };
    case 'crane_up':
      return { position: [p[0], p[1] + 2.2, p[2]], target: [t[0], t[1] + 0.4, t[2]], fov };
    case 'crane_down':
      return { position: [p[0], Math.max(0.3, p[1] - 1.4), p[2]], target: t, fov };
    case 'orbit_left':
      return { position: add(t, rotY(sub(p, t), 35)), target: t, fov };
    case 'orbit_right':
      return { position: add(t, rotY(sub(p, t), -35)), target: t, fov };
    case 'dolly_zoom': {
      const np = add(p, mul(dir, 0.4));
      const d1 = len(sub(t, np)) || 1;
      const f = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (d / d1)) * 180) / Math.PI;
      return { position: np, target: t, fov: Math.min(100, f) };
    }
    case 'custom':
      return customEnd ?? start;
    default:
      return start;
  }
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export function lerpPose(a: CameraPose, b: CameraPose, x: number): CameraPose {
  const k = ease(Math.max(0, Math.min(1, x)));
  const l = (u: V3, v: V3): V3 => [u[0] + (v[0] - u[0]) * k, u[1] + (v[1] - u[1]) * k, u[2] + (v[2] - u[2]) * k];
  return { position: l(a.position, b.position), target: l(a.target, b.target), fov: a.fov + (b.fov - a.fov) * k };
}
