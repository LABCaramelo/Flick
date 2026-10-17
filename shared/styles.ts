import type { StylePreset } from './types';

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'cinematic',
    name: 'Cinematográfico',
    prompt: 'cinematic film still, anamorphic lens, shallow depth of field, motivated lighting, rich contrast, subtle film grain, color graded',
  },
  {
    id: 'noir',
    name: 'Noir',
    prompt: 'film noir, high-contrast black and white, hard key light, deep shadows, venetian blind light patterns, smoky atmosphere',
  },
  {
    id: 'anime',
    name: 'Anime',
    prompt: 'anime style, clean line art, cel shading, vibrant palette, expressive characters, detailed painted backgrounds',
  },
  {
    id: 'claymation',
    name: 'Massinha',
    prompt: 'claymation stop-motion look, handmade plasticine textures, visible fingerprints, miniature set, soft studio lighting',
  },
  {
    id: 'painterly-3d',
    name: 'Animação pintada',
    prompt: 'stylized hybrid 2D/3D painterly animation, bold geometric shapes, painterly textures, expressive cinematic lighting',
  },
  {
    id: 'watercolor',
    name: 'Aquarela',
    prompt: 'watercolor illustration, soft bleeding pigments, paper texture, delicate washes, gentle light',
  },
  {
    id: 'documentary',
    name: 'Documental',
    prompt: 'documentary photography, natural light, handheld feel, authentic textures, muted realistic colors',
  },
  {
    id: 'retro-70s',
    name: 'Anos 70',
    prompt: '1970s 35mm film look, warm faded colors, halation, soft focus edges, period production design',
  },
  {
    id: 'cyberpunk',
    name: 'Neon',
    prompt: 'neon-lit night, wet reflective streets, magenta and cyan practical lights, volumetric haze, futuristic signage',
  },
  {
    id: 'wes',
    name: 'Simétrico pastel',
    prompt: 'perfectly symmetrical composition, pastel color palette, whimsical production design, flat frontal staging',
  },
];

export function findStyle(id: string | null | undefined, custom: StylePreset[] = []): StylePreset | undefined {
  if (!id) return undefined;
  return custom.find((s) => s.id === id) ?? STYLE_PRESETS.find((s) => s.id === id);
}
