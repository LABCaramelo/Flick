import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHiggsfieldClient, type HiggsfieldClient, type V2Response, AuthenticationError, NotEnoughCreditsError, ValidationError, BadInputError, APIError } from '@higgsfield/client/v2';
import { ACTIONS, AUDIO_SETTING, DEFAULT_MODEL_BY_ACTION, DEFAULT_MODELS } from '../../shared/actions';
import type { ActionType, CostEstimate, GenerateRequest, MediaKind, MediaRef, ModelInfo, ModelSetting, ProviderStatus } from '../../shared/types';
import { HF_CREDENTIALS } from '../config';
import { run } from '../media';
import { ProviderError, type EstimateOptions, type GenerationProvider, type ProviderContext, type RawOutput } from './types';

// Generation backend on the official Higgsfield API (SDK @higgsfield/client).
// The endpoint catalog (ids + JSON schemas) was extracted from
// docs.higgsfield.ai. The UI lists the flick-aligned models of
// shared/actions.ts; each one maps to the Higgsfield endpoints that serve it,
// and request bodies are built from those endpoints' schemas.

type Schema = { type?: string; properties?: Record<string, Prop>; required?: string[] };
type Prop = { type?: string; enum?: unknown[]; default?: unknown; minimum?: number; maximum?: number; items?: Prop; maxItems?: number; format?: string };

interface CatalogEntry {
  endpoint: string;
  family: string;
  vendor: string;
  workflow: string;
  kind: 'image' | 'video';
  title: string;
  schema: Schema;
}

const require = createRequire(import.meta.url);
const CATALOG: CatalogEntry[] = (require('./higgsfield-catalog.json') as { models: CatalogEntry[] }).models;

const API_BASE = 'https://api.higgsfield.ai';

// ---------------------------------------------------------------------------
// which endpoints can serve which action
// ---------------------------------------------------------------------------

const props = (e: CatalogEntry) => e.schema.properties ?? {};
const has = (e: CatalogEntry, ...names: string[]) => names.some((n) => n in props(e));
const req = (e: CatalogEntry) => e.schema.required ?? [];
const wf = (e: CatalogEntry) => `${e.workflow} ${e.endpoint}`;

/**
 * flick-aligned model id -> the Higgsfield endpoints that serve it (in order of
 * preference per action) and inputs the model pins, e.g. Kling O3 Standard and
 * Pro share endpoints and differ by `mode`.
 */
const ALIGNED: Record<string, { endpoints: string[]; fixed?: Record<string, unknown> }> = {
  'soul-v2': { endpoints: ['higgsfield-ai/soul/v2/standard'] },
  'gpt-image-2.5': { endpoints: ['marketing-studio/image/sunburst'] },
  'gpt-image-2': { endpoints: ['marketing-studio/image'] },
  'grok-imagine': { endpoints: ['xai/grok-imagine-image-2.0'] },
  recraft: { endpoints: ['recraft/v4.1/text-to-image'] },
  'z-image-turbo': { endpoints: ['z-image/turbo'] },
  'qwen-image-3': { endpoints: ['alibaba/qwen-image-3/edit', 'alibaba/qwen-image-3/text-to-image'] },
  'kling-3.0-standard': { endpoints: ['kling-video/v3.0/std/image-to-video', 'kling-video/v3.0/std/text-to-video'] },
  'kling-3.0': { endpoints: ['kling-video/v3.0/pro/image-to-video', 'kling-video/v3.0/pro/text-to-video'] },
  'kling-3.0-4k': { endpoints: ['kling-video/v3.0/4k/image-to-video', 'kling-video/v3.0/4k/text-to-video'] },
  'kling-o3-standard': { endpoints: ['kling-video/o3/image-reference', 'kling-video/o3/first-last-frame'], fixed: { mode: 'std' } },
  'kling-o3': { endpoints: ['kling-video/o3/image-reference', 'kling-video/o3/first-last-frame', 'kling-video/o3/video-edit'], fixed: { mode: 'pro' } },
  'kling-2.6': { endpoints: ['kling-video/v2.6/pro/image-to-video', 'kling-video/v2.6/pro/text-to-video'] },
  'kling-2.6-motion': { endpoints: ['kling-video/motion-control/std'] },
  'kling-2.6-motion-pro': { endpoints: ['kling-video/motion-control/pro'] },
  'seedance-2.5': {
    endpoints: [
      'bytedance/seedance-2.5/image-to-video',
      'bytedance/seedance-2.5/reference-to-video',
      'bytedance/seedance-2.5/text-to-video',
      'bytedance/seedance-2.5/video-edit',
      'bytedance/seedance-2.5/video-extend',
    ],
  },
  'seedance-2.0': { endpoints: ['bytedance/seedance-2.0/image-to-video', 'bytedance/seedance-2.0/reference-to-video', 'bytedance/seedance-2.0/text-to-video'] },
  'minimax-h3': { endpoints: ['minimax/h3/image-to-video', 'minimax/h3/reference-to-video', 'minimax/h3/text-to-video'] },
  'wan3.0': { endpoints: ['alibaba/wan-3.0/image-to-video', 'alibaba/wan-3.0/reference-to-video', 'alibaba/wan-3.0/text-to-video'] },
  'wan2.6': { endpoints: ['wan/v2.6/image-to-video', 'wan/v2.6/reference-to-video', 'wan/v2.6/text-to-video'] },
  'happy-horse-1.1': { endpoints: ['alibaba/happy-horse/v1.1/image-to-video', 'alibaba/happy-horse/v1.1/reference-to-video', 'alibaba/happy-horse/v1.1/text-to-video'] },
  'grok-imagine-video': { endpoints: ['xai/grok-imagine-video/v1.5/reference-to-video'] },
};

const BY_ENDPOINT = new Map(CATALOG.map((e) => [e.endpoint, e]));
const alignedEntries = (id: string): CatalogEntry[] => (ALIGNED[id]?.endpoints ?? []).flatMap((ep) => BY_ENDPOINT.get(ep) ?? []);
const needsMedia = (e: CatalogEntry) => req(e).some((r) => /image|video|frame/.test(r));

/** endpoint of an aligned model for `action`; prompt-only requests prefer endpoints that need no media */
function endpointFor(modelId: string, action: ActionType, hasImage = true): CatalogEntry | undefined {
  const list = alignedEntries(modelId).filter((e) => supports(action, e));
  return list.find((e) => hasImage || !needsMedia(e)) ?? list[0];
}

/** model used when the request names none (or an unknown one) */
function defaultAlignedFor(action: ActionType): string | undefined {
  const preferred = DEFAULT_MODEL_BY_ACTION[action];
  if (preferred && endpointFor(preferred, action)) return preferred;
  return DEFAULT_MODELS.find((m) => ALIGNED[m.id] && endpointFor(m.id, action))?.id;
}

function supports(action: ActionType, e: CatalogEntry): boolean {
  const w = wf(e);
  const imageInputs = has(e, 'image_urls', 'image_url', 'image_reference_url');
  switch (action) {
    case 'TextToImage':
      return e.kind === 'image' && !req(e).some((r) => /image/.test(r));
    case 'Image':
      return e.kind === 'image';
    case 'EditImage':
    case 'CharacterReference':
    case 'ImageStyleTransfer':
    case 'ChangeAngle':
    case 'ImageInpaint':
      return e.kind === 'image' && imageInputs && !/ads-studio/.test(e.endpoint);
    case 'ImageToVideo':
      return e.kind === 'video' && (/image-to-video|first-last-frame/.test(w) || (has(e, 'image_url') && !has(e, 'video_url')));
    case 'ReferenceToVideo':
      return e.kind === 'video' && (/reference-to-video|image-reference|cinema-studio|text-to-video/.test(w)) && !req(e).includes('video_urls');
    case 'OmniReference':
      return e.kind === 'video' && /image-reference|first-last-frame|reference-to-video/.test(w);
    case 'MotionToVideo':
      return e.kind === 'video' && /motion-control|motion-transfer/.test(w);
    case 'VideoEdit':
      return e.kind === 'video' && /video-edit|restyle|object-swap/.test(w);
    case 'VideoExtension':
      return e.kind === 'video' && /video-extend/.test(w);
    default:
      return false; // audio, upscale, background removal: not in the API catalog
  }
}

// ---------------------------------------------------------------------------
// schema -> UI settings
// ---------------------------------------------------------------------------

const SETTING_LABEL: Record<string, string> = {
  duration: 'Duração',
  resolution: 'Resolução',
  aspect_ratio: 'Proporção',
  quality: 'Qualidade',
  batch_size: 'Quantidade',
  mode: 'Modo',
  bitrate_mode: 'Bitrate',
  rendering_speed: 'Velocidade',
  shot_type: 'Tipo de plano',
  fps: 'FPS',
  camera_movement: 'Câmera',
};

function durationOptions(p: Prop): string[] {
  if (p.enum?.length) return p.enum.map(String);
  const min = p.minimum ?? 4;
  const max = p.maximum ?? 10;
  const picks = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30].filter((v) => v >= min && v <= max);
  return (picks.length ? picks : [min]).map(String);
}

function settingsFor(e: CatalogEntry, fixed: Record<string, unknown> = {}): ModelSetting[] {
  const out: ModelSetting[] = [];
  for (const [key, p] of Object.entries(props(e))) {
    if (!(key in SETTING_LABEL) || key in fixed) continue;
    let values: string[] | undefined;
    if (key === 'duration') values = durationOptions(p);
    else if (p.enum?.length) values = p.enum.map(String);
    if (!values?.length) continue;
    let def = p.default !== undefined ? String(p.default) : key === 'duration' ? (values.includes('5') ? '5' : values[0]) : values[0];
    // the API defaults to "high"; "standard" gives smaller files
    if (key === 'bitrate_mode' && values.includes('standard')) def = 'standard';
    out.push({
      id: key === 'batch_size' ? 'num_images' : key,
      label: SETTING_LABEL[key],
      type: 'select',
      options: values.map((v) => ({ value: v, label: key === 'duration' ? `${v}s` : v })),
      defaultValue: def,
    });
  }
  if (has(e, 'generate_audio', 'sound')) out.push(AUDIO_SETTING);
  return out;
}

function titleOf(e: CatalogEntry): string {
  return e.title.replace(/\s+—\s+/, ' · ');
}

let modelCache: ModelInfo[] | null = null;

/** The flick-aligned catalog, with actions and settings taken from each model's endpoints. */
export function higgsfieldApiModels(): ModelInfo[] {
  if (modelCache) return modelCache;
  modelCache = DEFAULT_MODELS.flatMap((m): ModelInfo[] => {
    const entries = alignedEntries(m.id);
    const actions = (Object.keys(ACTIONS) as ActionType[]).filter((a) => entries.some((e) => supports(a, e)));
    if (!actions.length) return [];
    const settingsByAction: Partial<Record<ActionType, ModelSetting[]>> = {};
    for (const a of actions) settingsByAction[a] = settingsFor(endpointFor(m.id, a)!, ALIGNED[m.id].fixed);
    return [
      {
        ...m,
        description: `${m.description ?? ''} · Higgsfield: ${titleOf(entries[0]).split(' · ')[0]}`.replace(/^ · /, ''),
        actions,
        settings: settingsByAction[actions[0]],
        settingsByAction,
        aliases: entries.map((e) => e.endpoint),
        providerModel: entries[0].endpoint,
      },
    ];
  });
  return modelCache;
}

export function higgsfieldApiSupports(action: ActionType): boolean {
  return defaultAlignedFor(action) !== undefined;
}

// ---------------------------------------------------------------------------
// request body construction
// ---------------------------------------------------------------------------

function coerce(p: Prop | undefined, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return undefined;
  if (!p) return v;
  if (p.enum?.length) {
    const s = String(v).toLowerCase();
    const hit = p.enum.find((x) => String(x).toLowerCase() === s);
    if (hit !== undefined) return hit;
    if (typeof p.enum[0] === 'number') {
      const n = Number(v);
      return p.enum.reduce((best, x) => (Math.abs(Number(x) - n) < Math.abs(Number(best) - n) ? x : best), p.enum[0]);
    }
    return undefined; // unsupported value: let the API default apply
  }
  if (p.type === 'integer' || p.type === 'number') {
    let n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    if (p.type === 'integer') n = Math.round(n);
    if (p.minimum !== undefined) n = Math.max(p.minimum, n);
    if (p.maximum !== undefined) n = Math.min(p.maximum, n);
    return n;
  }
  if (p.type === 'boolean') return v === true || v === 'true';
  return v;
}

const IMAGE_SLOTS: Record<string, string[]> = {
  start: ['image_url', 'first_frame_url'],
  end: ['end_image_url', 'last_image_url', 'last_frame_url'],
  refs: ['image_urls', 'image_reference_url', 'image_url'],
};

function pickProp(e: CatalogEntry, names: string[], used: Set<string>): string | undefined {
  return names.find((n) => n in props(e) && !used.has(n));
}

interface BuildOptions {
  /** inputs pinned by the chosen model */
  fixed?: Record<string, unknown>;
  /** skip the required-field check (cost estimates) */
  lenient?: boolean;
}

export function buildInput(e: CatalogEntry, r: GenerateRequest, media: Record<string, string[]>, opts: BuildOptions = {}): Record<string, unknown> {
  const P = props(e);
  const used = new Set<string>();
  const input: Record<string, unknown> = {};
  const put = (key: string | undefined, value: unknown) => {
    if (!key) return;
    const p = P[key];
    if (p?.type === 'array') {
      const list = (Array.isArray(value) ? value : [value]).filter(Boolean);
      if (!list.length) return;
      const prev = (input[key] as unknown[]) ?? [];
      input[key] = [...prev, ...list].slice(0, p.maxItems ?? 50);
    } else {
      const v = Array.isArray(value) ? value[0] : value;
      if (v === undefined) return;
      input[key] = v;
    }
    used.add(key);
  };

  // prompt (+ style) — some endpoints have no prompt field
  const prompt = [r.prompt, r.stylePrompt ? `Style: ${r.stylePrompt}` : ''].filter(Boolean).join('\n\n');
  if ('prompt' in P && prompt) input.prompt = prompt;

  const images = (ids: string[]) => ids.flatMap((id) => media[id] ?? []);
  const start = images(['startFrame', 'sourceImage', 'imageSource', 'referenceImage']);
  const end = images(['endFrame']);
  const refs = images(['referenceImages', 'character', 'referenceScene', 'element1', 'element2']);
  const videos = [...(media.sourceVideo ?? []), ...(media.motionReference ?? []), ...(media.referenceVideos ?? [])];
  const audios = [...(media.audioSource ?? []), ...(media.referenceAudio ?? []), ...(media.referenceAudios ?? [])];

  if (start.length) put(pickProp(e, IMAGE_SLOTS.start, used) ?? pickProp(e, ['image_urls'], used), start[0]);
  if (end.length) put(pickProp(e, IMAGE_SLOTS.end, used), end[0]);
  if (refs.length) {
    const key = pickProp(e, ['image_urls'], new Set()) ?? pickProp(e, IMAGE_SLOTS.refs, used);
    put(key, P[key ?? '']?.type === 'array' ? refs : refs[0]);
  }
  if (videos.length) put(pickProp(e, ['video_url'], used) ?? pickProp(e, ['video_urls'], new Set()), P.video_url ? videos[0] : videos);
  if (audios.length) put(pickProp(e, ['audio_urls'], new Set()) ?? pickProp(e, ['audio_url'], used), P.audio_urls ? audios : audios[0]);

  // settings
  const s = r.settings ?? {};
  const map: Record<string, unknown> = {
    duration: s.duration,
    resolution: s.resolution,
    aspect_ratio: s.aspect_ratio,
    quality: s.quality,
    batch_size: s.num_images,
    mode: s.mode,
    bitrate_mode: s.bitrate_mode,
    negative_prompt: s.negative_prompt,
    seed: s.seed,
    fps: s.fps,
    camera_movement: s.camera_movement,
    shot_type: s.shot_type,
    rendering_speed: s.rendering_speed,
  };
  for (const [k, v] of Object.entries(map)) {
    if (!(k in P) || used.has(k)) continue;
    const c = coerce(P[k], v);
    if (c !== undefined) input[k] = c;
  }

  // native audio is opt-in: the API turns it on by default and it raises the price
  const audio = s.audio === true || s.audio === 'true';
  if ('generate_audio' in P) input.generate_audio = audio;
  if ('sound' in P) input.sound = audio ? 'on' : 'off';
  if ('bitrate_mode' in P && input.bitrate_mode === undefined) input.bitrate_mode = 'standard';
  for (const [k, v] of Object.entries(opts.fixed ?? {})) if (k in P) input[k] = v;

  const missing = req(e).filter((k) => input[k] === undefined || (Array.isArray(input[k]) && !(input[k] as unknown[]).length));
  if (missing.length && !opts.lenient) {
    const human: Record<string, string> = { image_url: 'imagem de entrada', image_urls: 'imagens de referência', video_url: 'vídeo de origem', video_urls: 'vídeos de referência', prompt: 'prompt', first_frame_url: 'quadro inicial', preset_id: 'preset' };
    throw new ProviderError(`${titleOf(e)} precisa de: ${missing.map((m) => human[m] ?? m).join(', ')}`);
  }
  return input;
}

// ---------------------------------------------------------------------------
// uploads (presigned URL -> public_url)
// ---------------------------------------------------------------------------

const UPLOAD_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', wav: 'audio/wav', mp4: 'video/mp4' };

async function normalizeForUpload(file: string, kind: MediaKind): Promise<{ file: string; type: string; cleanup?: string }> {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (UPLOAD_TYPES[ext]) return { file, type: UPLOAD_TYPES[ext] };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claquete-up-'));
  const target = path.join(dir, kind === 'image' ? 'in.png' : kind === 'audio' ? 'in.wav' : 'in.mp4');
  const args = kind === 'video' ? ['-y', '-i', file, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', target] : ['-y', '-i', file, target];
  const res = await run('ffmpeg', args);
  if (res.code !== 0) throw new ProviderError(`não foi possível converter ${path.basename(file)} para envio`);
  return { file: target, type: UPLOAD_TYPES[path.extname(target).slice(1)], cleanup: dir };
}

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------

// POST /estimate/<endpoint> returns an exact quote for most models. Seedance
// and Wan 3.0 answer with their published rate instead ("description"); the
// rates below are those descriptions (October 2026), before the account
// discount.

const SHORT_SIDE: Record<string, number> = { '480p': 480, '720p': 720, '1080p': 1080 };

function outputArea(resolution: string, aspect: unknown): number | undefined {
  const short = SHORT_SIDE[resolution];
  if (!short) return undefined;
  const [a, b] = String(aspect ?? '16:9').split(':').map(Number);
  return short * short * (a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) : 16 / 9);
}

/** list price in USD from the published rate, or undefined when the model has none we know */
function formulaUsd(e: CatalogEntry, input: Record<string, unknown>, opts: EstimateOptions): number | undefined {
  const P = props(e);
  const seconds = Number(input.duration ?? P.duration?.default ?? 5);
  const resolution = String(input.resolution ?? P.resolution?.default ?? '720p');
  const tokens = (area: number, secs: number) => Math.ceil((area * secs * 24) / 1024) / 1000; // thousands of video tokens

  if (e.endpoint.startsWith('bytedance/seedance-2.5/')) {
    const area = outputArea(resolution, input.aspect_ratio);
    if (!area) return undefined;
    // source video is billed too, at 0.6x the rate
    const withVideo = /video-edit|video-extend/.test(e.workflow) || (Array.isArray(input.video_urls) && input.video_urls.length > 0);
    const inputSecs = withVideo ? opts.inputVideoSeconds ?? 0 : 0;
    if (withVideo && !inputSecs) return undefined;
    const generated = e.workflow === 'video-edit' ? inputSecs : seconds; // an edit is as long as its source
    const rate = (resolution === '1080p' ? 0.0234 : 0.0214) * (withVideo ? 0.6 : 1);
    return tokens(area, inputSecs + generated) * rate;
  }
  if (e.endpoint.startsWith('bytedance/seedance-2.0/')) {
    const area = outputArea(resolution, input.aspect_ratio);
    return area ? tokens(area, seconds) * 0.014 : undefined;
  }
  if (e.endpoint.startsWith('alibaba/wan-3.0/')) {
    const perSecond: Record<string, number> = { '480p': 0.05, '720p': 0.1, '1080p': 0.2 };
    return perSecond[resolution] !== undefined ? perSecond[resolution] * seconds : undefined;
  }
  return undefined;
}

interface EstimateResponse {
  type?: string;
  usd?: string;
  credits?: string;
  discount?: { percentage?: string; usd?: string } | null;
  pricing_description?: string;
}

const ESTIMATE_TTL = 10 * 60_000;
const PLACEHOLDER: Record<string, string> = { image: 'png', video: 'mp4', audio: 'mp3' };

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------

const TERMINAL_FAIL: Record<string, string> = {
  failed: 'A geração falhou no Higgsfield.',
  nsfw: 'A geração foi bloqueada pela moderação de conteúdo do Higgsfield.',
  canceled: 'A geração foi cancelada.',
  cancelled: 'A geração foi cancelada.',
};

export class HiggsfieldApiProvider implements GenerationProvider {
  id = 'higgsfield-api';
  name = 'Higgsfield API';
  private client?: HiggsfieldClient;
  private lastError?: string;
  private uploadCache = new Map<string, string>();
  private estimates = new Map<string, { at: number; value: CostEstimate }>();
  /** account discount (%) learned from quotes; applied to published rates */
  private discountPct?: number;

  configured(): boolean {
    return /^[^:\s]+:[^:\s]+$/.test(HF_CREDENTIALS);
  }

  private sdk(): HiggsfieldClient {
    if (!this.configured()) throw new ProviderError('Defina HF_CREDENTIALS (key-id:key-secret) no .env.local para usar a API do Higgsfield.');
    // no automatic resubmission: a retried submit after a timeout or 5xx can
    // start (and bill) a second generation
    this.client ??= createHiggsfieldClient({ credentials: HF_CREDENTIALS, timeout: 120_000, maxRetries: 0 });
    return this.client;
  }

  private authHeader() {
    return { Authorization: `Key ${HF_CREDENTIALS}` };
  }

  async status(): Promise<ProviderStatus> {
    return {
      id: this.id,
      name: this.name,
      connected: this.configured(),
      error: this.configured() ? this.lastError : 'HF_CREDENTIALS ausente no .env.local',
      detail: `${higgsfieldApiModels().length} modelos alinhados ao flick · api.higgsfield.ai`,
    };
  }

  async models(): Promise<ModelInfo[]> {
    return higgsfieldApiModels();
  }

  private async upload(ref: MediaRef, ctx: ProviderContext): Promise<string> {
    if (ref.remoteUrl) return ref.remoteUrl;
    if (ref.url && /^https?:\/\//.test(ref.url)) return ref.url;
    const local = ctx.localFile(ref);
    if (!local) throw new ProviderError(`mídia sem arquivo local (${ref.nodeId})`);
    const cached = this.uploadCache.get(local);
    if (cached) return cached;
    const norm = await normalizeForUpload(local, ref.type === 'text' ? 'image' : ref.type);
    try {
      const res = await fetch(`${API_BASE}/files/generate-upload-url`, {
        method: 'POST',
        headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: norm.type }),
        signal: ctx.signal,
      });
      if (!res.ok) throw new ProviderError(`upload recusado (${res.status}) ${await res.text().catch(() => '')}`.trim(), res.status === 401);
      const slot = (await res.json()) as { upload_url: string; public_url: string; upload_headers?: Record<string, string> };
      const put = await fetch(slot.upload_url, { method: 'PUT', headers: slot.upload_headers ?? { 'Content-Type': norm.type }, body: await fs.readFile(norm.file), signal: ctx.signal });
      if (!put.ok) throw new ProviderError(`falha ao enviar arquivo (${put.status})`);
      this.uploadCache.set(local, slot.public_url);
      return slot.public_url;
    } finally {
      if (norm.cleanup) await fs.rm(norm.cleanup, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** endpoint (and pinned inputs) that will run `r` */
  resolveEndpoint(r: GenerateRequest): { entry: CatalogEntry; fixed?: Record<string, unknown> } {
    const hasImage = Object.values(r.mediaInputs).flat().some((r) => r.type === 'image');
    // raw endpoint ids come from projects saved before the flick-aligned catalog
    let entry = CATALOG.find((e) => e.endpoint === r.model && supports(r.actionType, e));
    if (entry) {
      // a text-only request on an image-to-video endpoint: switch to the family's text-to-video sibling
      if (!hasImage && req(entry).some((r) => /image_url|first_frame/.test(r))) {
        const sibling = CATALOG.find((e) => e.family === entry!.family && /text-to-video|text-to-image/.test(e.workflow) && !req(e).some((r) => /image|video/.test(r)));
        if (sibling) entry = sibling;
      }
      return { entry };
    }
    const id = ALIGNED[r.model] && endpointFor(r.model, r.actionType) ? r.model : defaultAlignedFor(r.actionType);
    entry = id ? endpointFor(id, r.actionType, hasImage) : undefined;
    if (!id || !entry) throw new ProviderError(`A API do Higgsfield não tem modelo para "${ACTIONS[r.actionType].name}".`);
    return { entry, fixed: ALIGNED[id].fixed };
  }

  /** Expected charge for `r`, from Higgsfield's estimate endpoint or its published rate. */
  async estimate(r: GenerateRequest, opts: EstimateOptions = {}): Promise<CostEstimate> {
    if (!this.configured()) return { usd: null, source: 'unknown', note: 'Defina HF_CREDENTIALS no .env.local para ver o custo.' };
    let resolved: ReturnType<HiggsfieldApiProvider['resolveEndpoint']>;
    try {
      resolved = this.resolveEndpoint(r);
    } catch (err) {
      return { usd: null, source: 'unknown', note: (err as Error).message };
    }
    const { entry, fixed } = resolved;
    // the estimate never fetches media: provider-hosted URLs are reused, the rest get a placeholder
    const media: Record<string, string[]> = {};
    for (const [inputId, refs] of Object.entries(r.mediaInputs)) {
      media[inputId] = refs
        .filter((ref) => ref.type !== 'text')
        .map((ref) => ref.remoteUrl ?? (ref.url && /^https?:\/\//.test(ref.url) ? ref.url : `https://example.com/claquete-estimate.${PLACEHOLDER[ref.type]}`));
    }
    const input = buildInput(entry, { ...r, prompt: 'estimate' }, media, { fixed, lenient: true });
    const key = `${entry.endpoint} ${JSON.stringify(input)} ${opts.inputVideoSeconds ?? 0}`;
    const hit = this.estimates.get(key);
    if (hit && Date.now() - hit.at < ESTIMATE_TTL) return hit.value;
    const value = await this.quote(entry, input, opts);
    if (value.usd !== null) this.estimates.set(key, { at: Date.now(), value });
    return value;
  }

  private async quote(entry: CatalogEntry, input: Record<string, unknown>, opts: EstimateOptions): Promise<CostEstimate> {
    const endpoint = entry.endpoint;
    let data: EstimateResponse;
    try {
      const res = await fetch(`${API_BASE}/estimate/${endpoint}`, {
        method: 'POST',
        headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { usd: null, source: 'unknown', endpoint, note: `A Higgsfield não estimou este pedido (HTTP ${res.status}).` };
      data = (await res.json()) as EstimateResponse;
    } catch (err) {
      return { usd: null, source: 'unknown', endpoint, note: `Sem estimativa: ${(err as Error).message}` };
    }
    if (data.usd !== undefined) {
      const usd = Number(data.usd);
      const discountPct = data.discount?.percentage ? Number(data.discount.percentage) : undefined;
      if (discountPct !== undefined) this.discountPct = discountPct;
      const listUsd = data.discount?.usd ? usd + Number(data.discount.usd) : usd;
      return { usd, listUsd, discountPct, source: 'quote', endpoint, note: 'Estimativa da Higgsfield para esta configuração.' };
    }
    const listUsd = formulaUsd(entry, input, opts);
    if (listUsd === undefined) {
      return { usd: null, source: 'unknown', endpoint, note: 'Cobrado por tokens: a Higgsfield só fecha o valor ao fim da geração.' };
    }
    const discountPct = await this.accountDiscount();
    return {
      usd: discountPct ? listUsd * (1 - discountPct / 100) : listUsd,
      listUsd,
      discountPct,
      source: 'formula',
      endpoint,
      note: 'Calculado pela tabela da Higgsfield (resolução × duração)' + (discountPct === undefined ? ', sem o desconto da conta.' : '.'),
    };
  }

  /** the account discount shows up on exact quotes; ask for one if none was seen yet */
  private async accountDiscount(): Promise<number | undefined> {
    if (this.discountPct !== undefined) return this.discountPct;
    const probe = BY_ENDPOINT.get('kling-video/v3.0/std/image-to-video');
    if (!probe) return undefined;
    const q = await this.quote(probe, { prompt: 'estimate', image_url: 'https://example.com/claquete-estimate.png', duration: 5, sound: 'off' }, {});
    if (q.source === 'quote') this.discountPct = q.discountPct ?? 0;
    return this.discountPct;
  }

  async generate(r: GenerateRequest, ctx: ProviderContext): Promise<RawOutput[]> {
    const client = this.sdk();
    const { entry, fixed } = this.resolveEndpoint(r);
    ctx.progress(3, 'Enviando referências…');
    const media: Record<string, string[]> = {};
    for (const [inputId, refs] of Object.entries(r.mediaInputs)) {
      media[inputId] = [];
      for (const ref of refs) if (ref.type !== 'text') media[inputId].push(await this.upload(ref, ctx));
    }
    const input = buildInput(entry, r, media, { fixed });

    ctx.progress(8, `Enviando para ${titleOf(entry)}…`);
    let submitted: V2Response;
    try {
      submitted = await client.subscribe(entry.endpoint, { input, withPolling: false });
    } catch (err) {
      throw this.translate(err);
    }
    this.lastError = undefined;
    const statusUrl = submitted.status_url || `${API_BASE}/requests/${submitted.request_id}/status`;
    const cancelUrl = submitted.cancel_url || `${API_BASE}/requests/${submitted.request_id}/cancel`;
    const onAbort = () => fetch(cancelUrl, { method: 'POST', headers: this.authHeader() }).catch(() => undefined);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    try {
      let result = submitted;
      let progress = 10;
      const started = Date.now();
      const expected = entry.kind === 'video' ? 150_000 : 30_000;
      while (result.status !== 'completed') {
        const s = String(result.status);
        if (TERMINAL_FAIL[s]) throw new ProviderError(`${TERMINAL_FAIL[s]}${(result as { error?: string }).error ? ` (${(result as { error?: string }).error})` : ''}`);
        if (ctx.signal.aborted) throw new ProviderError('Cancelado');
        if (Date.now() - started > 25 * 60_000) throw new ProviderError('Tempo esgotado aguardando o Higgsfield.');
        await new Promise((res) => setTimeout(res, entry.kind === 'video' ? 4000 : 2000));
        const res = await fetch(statusUrl, { headers: this.authHeader(), signal: ctx.signal });
        if (res.status >= 500) continue;
        if (!res.ok) throw new ProviderError(`status ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status === 401);
        result = (await res.json()) as V2Response;
        // time-based progress estimate (the API reports no percentage)
        progress = Math.min(94, 10 + Math.round(((Date.now() - started) / expected) * 80));
        ctx.progress(progress, result.status === 'queued' ? 'Na fila do Higgsfield…' : `Gerando com ${titleOf(entry)}…`);
      }
      const out: RawOutput[] = [];
      for (const img of result.images ?? []) out.push({ url: img.url, type: 'image' });
      if (result.video?.url) out.push({ url: result.video.url, type: 'video' });
      const extra = result as { audio?: { url: string }; audios?: { url: string }[] };
      if (extra.audio?.url) out.push({ url: extra.audio.url, type: 'audio' });
      if (!out.length) throw new ProviderError('O Higgsfield concluiu sem retornar mídia.');
      return out;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  }

  private translate(err: unknown): Error {
    if (err instanceof ProviderError) return err;
    let msg: string;
    if (err instanceof AuthenticationError) msg = 'Credenciais do Higgsfield inválidas (401). Verifique HF_CREDENTIALS.';
    else if (err instanceof NotEnoughCreditsError) msg = 'Créditos insuficientes na conta da API do Higgsfield (403).';
    else if (err instanceof ValidationError || err instanceof BadInputError) msg = `Entrada recusada pelo modelo: ${formatDetail((err as ValidationError).details ?? (err as Error).message)}`;
    else if (err instanceof APIError) msg = `Erro da API do Higgsfield (${err.statusCode}): ${formatDetail(err.responseData?.detail ?? err.message)}`;
    else msg = String((err as Error)?.message ?? err);
    this.lastError = msg;
    return new ProviderError(msg, err instanceof AuthenticationError);
  }
}

function formatDetail(d: unknown): string {
  if (Array.isArray(d)) return d.map((x) => `${(x.loc ?? []).slice(1).join('.')}: ${x.msg}`).join('; ');
  return typeof d === 'string' ? d : JSON.stringify(d);
}
