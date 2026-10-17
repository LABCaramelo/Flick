import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHiggsfieldClient, type HiggsfieldClient, type V2Response, AuthenticationError, NotEnoughCreditsError, ValidationError, BadInputError, APIError } from '@higgsfield/client/v2';
import { ACTIONS } from '../../shared/actions';
import type { ActionType, GenerateRequest, MediaKind, MediaRef, ModelInfo, ModelSetting, ProviderStatus } from '../../shared/types';
import { HF_CREDENTIALS } from '../config';
import { run } from '../media';
import { ProviderError, type GenerationProvider, type ProviderContext, type RawOutput } from './types';

// Generation backend on the official Higgsfield API (SDK @higgsfield/client).
// The model catalog (endpoint ids + JSON schemas) was extracted from
// docs.higgsfield.ai; each canvas action lists the endpoints whose schema can
// serve it, and request bodies are built from those schemas.

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

/** endpoint preference per action (first = default) */
const PREFERRED: Partial<Record<ActionType, string[]>> = {
  Image: ['higgsfield-ai/soul/v2/standard', 'alibaba/qwen-image-3/edit', 'xai/grok-imagine-image-2.0'],
  TextToImage: ['higgsfield-ai/soul/v2/standard', 'higgsfield-ai/soul/cinema'],
  EditImage: ['alibaba/qwen-image-3/edit', 'xai/grok-imagine-image-2.0'],
  CharacterReference: ['alibaba/qwen-image-3/edit', 'xai/grok-imagine-image-2.0'],
  ImageStyleTransfer: ['alibaba/qwen-image-3/edit'],
  ChangeAngle: ['alibaba/qwen-image-3/edit'],
  ImageInpaint: ['alibaba/qwen-image-3/edit'],
  ImageToVideo: ['bytedance/seedance-2.5/image-to-video', 'kling-video/v3.0/pro/image-to-video', 'kling-video/v3.0/std/image-to-video'],
  ReferenceToVideo: ['bytedance/seedance-2.5/reference-to-video', 'bytedance/seedance-2.5/text-to-video'],
  OmniReference: ['kling-video/o3/image-reference', 'kling-video/omni/image-reference'],
  MotionToVideo: ['kling-video/v3/motion-control/std', 'kling-video/v3/motion-control/pro'],
  VideoEdit: ['bytedance/seedance-2.5/video-edit', 'kling-video/o3/video-edit'],
  VideoExtension: ['bytedance/seedance-2.5/video-extend'],
};

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

function actionsFor(e: CatalogEntry): ActionType[] {
  return (Object.keys(ACTIONS) as ActionType[]).filter((a) => supports(a, e));
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

function settingsFor(e: CatalogEntry): ModelSetting[] {
  const out: ModelSetting[] = [];
  for (const [key, p] of Object.entries(props(e))) {
    if (!(key in SETTING_LABEL)) continue;
    let values: string[] | undefined;
    if (key === 'duration') values = durationOptions(p);
    else if (p.enum?.length) values = p.enum.map(String);
    if (!values?.length) continue;
    const def = p.default !== undefined ? String(p.default) : key === 'duration' ? (values.includes('5') ? '5' : values[0]) : values[0];
    out.push({
      id: key === 'batch_size' ? 'num_images' : key,
      label: SETTING_LABEL[key],
      type: 'select',
      options: values.map((v) => ({ value: v, label: key === 'duration' ? `${v}s` : v })),
      defaultValue: def,
    });
  }
  return out;
}

function titleOf(e: CatalogEntry): string {
  return e.title.replace(/\s+—\s+/, ' · ');
}

let modelCache: ModelInfo[] | null = null;

export function higgsfieldApiModels(): ModelInfo[] {
  if (modelCache) return modelCache;
  const list = CATALOG.map((e) => ({
    id: e.endpoint,
    name: titleOf(e),
    description: `${e.vendor} · ${e.endpoint}`,
    actions: actionsFor(e),
    settings: settingsFor(e),
    providerModel: e.endpoint,
  })).filter((m) => m.actions.length);
  // preferred endpoints first so they become each action's default
  const rank = (m: ModelInfo) => {
    let best = 999;
    for (const a of m.actions) {
      const i = PREFERRED[a]?.indexOf(m.id) ?? -1;
      if (i >= 0) best = Math.min(best, i);
    }
    return best;
  };
  modelCache = list.sort((a, b) => rank(a) - rank(b));
  return modelCache;
}

export function higgsfieldApiSupports(action: ActionType): boolean {
  return CATALOG.some((e) => supports(action, e));
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

export function buildInput(e: CatalogEntry, r: GenerateRequest, media: Record<string, string[]>): Record<string, unknown> {
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

  const missing = req(e).filter((k) => input[k] === undefined || (Array.isArray(input[k]) && !(input[k] as unknown[]).length));
  if (missing.length) {
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

  configured(): boolean {
    return /^[^:\s]+:[^:\s]+$/.test(HF_CREDENTIALS);
  }

  private sdk(): HiggsfieldClient {
    if (!this.configured()) throw new ProviderError('Defina HF_CREDENTIALS (key-id:key-secret) no .env.local para usar a API do Higgsfield.');
    this.client ??= createHiggsfieldClient({ credentials: HF_CREDENTIALS, timeout: 120_000, maxRetries: 2 });
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
      detail: `${higgsfieldApiModels().length} endpoints · api.higgsfield.ai`,
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

  resolveEndpoint(r: GenerateRequest): CatalogEntry {
    const hasImage = Object.values(r.mediaInputs).flat().some((r) => r.type === 'image');
    let entry = CATALOG.find((e) => e.endpoint === r.model && supports(r.actionType, e));
    if (!entry) {
      const ranked = higgsfieldApiModels().filter((m) => m.actions.includes(r.actionType));
      // for prompt-only video/image requests prefer endpoints that need no media
      const pick = ranked.find((m) => {
        const e = CATALOG.find((c) => c.endpoint === m.id)!;
        return hasImage || !req(e).some((r) => /image|video|frame/.test(r));
      }) ?? ranked[0];
      entry = pick ? CATALOG.find((e) => e.endpoint === pick.id) : undefined;
    }
    if (!entry) throw new ProviderError(`A API do Higgsfield não tem modelo para "${ACTIONS[r.actionType].name}".`);
    // a text-only request on an image-to-video endpoint: switch to the family's text-to-video sibling
    if (!hasImage && req(entry).some((r) => /image_url|first_frame/.test(r))) {
      const sibling = CATALOG.find((e) => e.family === entry!.family && /text-to-video|text-to-image/.test(e.workflow) && !req(e).some((r) => /image|video/.test(r)));
      if (sibling) entry = sibling;
    }
    return entry;
  }

  async generate(r: GenerateRequest, ctx: ProviderContext): Promise<RawOutput[]> {
    const client = this.sdk();
    const entry = this.resolveEndpoint(r);
    ctx.progress(3, 'Enviando referências…');
    const media: Record<string, string[]> = {};
    for (const [inputId, refs] of Object.entries(r.mediaInputs)) {
      media[inputId] = [];
      for (const ref of refs) if (ref.type !== 'text') media[inputId].push(await this.upload(ref, ctx));
    }
    const input = buildInput(entry, r, media);

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
