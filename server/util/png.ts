import zlib from 'node:zlib';

// Tiny dependency-free PNG encoder used by the offline provider to paint
// deterministic placeholder frames.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h: number, s: number, l: number): [number, number, number] => {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};

/** A cinematic-looking abstract frame (sky gradient, sun, layered hills, vignette) seeded by `seedText`. */
export function paintPlaceholder(width: number, height: number, seedText: string): Buffer {
  const r = rng(hash(seedText));
  const hue = r() * 360;
  const top = hsl(hue, 0.55, 0.22);
  const bottom = hsl((hue + 40) % 360, 0.65, 0.62);
  const sun = { x: 0.2 + r() * 0.6, y: 0.25 + r() * 0.25, r: 0.06 + r() * 0.08 };
  const layers = Array.from({ length: 4 }, (_, i) => ({
    base: 0.55 + i * 0.1 + r() * 0.05,
    amp: 0.03 + r() * 0.06,
    freq: 2 + r() * 5,
    phase: r() * Math.PI * 2,
    color: hsl((hue + 200 + i * 12) % 360, 0.35, 0.18 - i * 0.035),
  }));
  const px = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      let c: [number, number, number] = [
        top[0] + (bottom[0] - top[0]) * v,
        top[1] + (bottom[1] - top[1]) * v,
        top[2] + (bottom[2] - top[2]) * v,
      ];
      const dx = (u - sun.x) * (width / height);
      const dy = v - sun.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const glow = Math.max(0, 1 - d / (sun.r * 4)) ** 2 * 0.6 + (d < sun.r ? 0.7 : 0);
      c = [c[0] + 255 * glow, c[1] + 220 * glow, c[2] + 170 * glow];
      for (const L of layers) {
        const ridge = L.base + Math.sin(u * L.freq + L.phase) * L.amp + Math.sin(u * L.freq * 3.1 + L.phase) * L.amp * 0.3;
        if (v > ridge) c = [L.color[0], L.color[1], L.color[2]];
      }
      const vig = 1 - Math.min(0.55, ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 1.4);
      const grain = (r() - 0.5) * 10;
      const i = (y * width + x) * 3;
      px[i] = Math.max(0, Math.min(255, c[0] * vig + grain));
      px[i + 1] = Math.max(0, Math.min(255, c[1] * vig + grain));
      px[i + 2] = Math.max(0, Math.min(255, c[2] * vig + grain));
    }
  }
  return encodePng(width, height, px);
}
