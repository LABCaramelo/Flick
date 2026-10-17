import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { ACTIONS, DEFAULT_MODELS } from '../../shared/actions';
import type { ActionType, GenerateRequest, MediaKind, MediaRef, ModelInfo, ProviderStatus } from '../../shared/types';
import { DATA_DIR, HIGGSFIELD_MCP_TOKEN, HIGGSFIELD_MCP_URL, LOCAL_BASE_URL } from '../config';
import { readJson, writeJson } from '../storage';
import { ProviderError, type GenerationProvider, type ProviderContext, type RawOutput } from './types';

// Generation backend backed by Higgsfield's hosted MCP server.
//
// The server's tool list is discovered at runtime (tools/list). Each canvas
// action is mapped to a tool either by an explicit override in
// data/higgsfield-mapping.json or by inference from tool names, descriptions
// and input schemas. Results are parsed for media URLs; when a tool answers
// with a job id instead, a status tool is polled until the media is ready.

const AUTH_FILE = path.join(DATA_DIR, 'higgsfield-auth.json');
const MAPPING_FILE = path.join(DATA_DIR, 'higgsfield-mapping.json');
export const CALLBACK_PATH = '/api/providers/higgsfield/callback';

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]; items?: JsonSchema; description?: string; default?: unknown };

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

export interface ToolMapping {
  tool: string;
  /** argument templates: "{{prompt}}", "{{model}}", "{{startFrame}}", "{{referenceImages[]}}", literals pass through */
  args: Record<string, unknown>;
}

export interface MappingFile {
  actions?: Partial<Record<ActionType, ToolMapping>>;
  statusTool?: string;
  uploadTool?: string;
  modelsTool?: string;
}

// ---------------------------------------------------------------------------
// OAuth client provider persisted on disk
// ---------------------------------------------------------------------------

interface AuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discovery?: OAuthDiscoveryState;
}

class FileOAuthProvider implements OAuthClientProvider {
  pendingAuthUrl?: string;
  private stored: AuthState = {};
  private loaded = false;

  get redirectUrl(): string {
    return `${LOCAL_BASE_URL}${CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Claquete',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.stored = (await readJson<AuthState>(AUTH_FILE)) ?? {};
    this.loaded = true;
  }

  private persist() {
    return writeJson(AUTH_FILE, this.stored);
  }

  hasTokens(): boolean {
    return !!this.stored.tokens?.access_token;
  }

  clientInformation() {
    return this.stored.clientInformation;
  }
  async saveClientInformation(info: OAuthClientInformationMixed) {
    this.stored.clientInformation = info;
    await this.persist();
  }
  tokens() {
    return this.stored.tokens;
  }
  async saveTokens(tokens: OAuthTokens) {
    this.stored.tokens = tokens;
    await this.persist();
  }
  redirectToAuthorization(url: URL) {
    this.pendingAuthUrl = url.toString();
  }
  async saveCodeVerifier(v: string) {
    this.stored.codeVerifier = v;
    await this.persist();
  }
  codeVerifier() {
    if (!this.stored.codeVerifier) throw new Error('code verifier ausente');
    return this.stored.codeVerifier;
  }
  discoveryState() {
    return this.stored.discovery;
  }
  async saveDiscoveryState(s: OAuthDiscoveryState) {
    this.stored.discovery = s;
    await this.persist();
  }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') this.stored = {};
    if (scope === 'client') delete this.stored.clientInformation;
    if (scope === 'tokens') delete this.stored.tokens;
    if (scope === 'verifier') delete this.stored.codeVerifier;
    if (scope === 'discovery') delete this.stored.discovery;
    await this.persist();
  }
}

// ---------------------------------------------------------------------------
// helpers: schema introspection and inference
// ---------------------------------------------------------------------------

const NON_GENERATION = /(^|_)(list|status|get|balance|credits?|history|result|results|poll|check|cancel|delete|upload|whoami|me|account|search|info|help)(_|$)/i;

const ACTION_HINTS: Record<ActionType, RegExp[]> = {
  Image: [/text.?to.?image|generate.?image|image.?gen|create.?image|^image$/i, /image|photo|soul|nano|seedream/i],
  TextToImage: [/text.?to.?image|generate.?image|image.?gen|create.?image/i, /image|photo|soul/i],
  EditImage: [/edit.?image|image.?edit|image.?to.?image|img2img|remix/i, /reference|nano|seedream|image/i],
  CharacterReference: [/character|soul.?id|consisten|reference/i, /edit|image/i],
  ImageStyleTransfer: [/style/i, /edit|image.?to.?image|image/i],
  ChangeAngle: [/angle|camera|perspective/i, /edit|image/i],
  ImageInpaint: [/inpaint|mask|fill/i, /edit/i],
  ImageUpscale: [/upscal|enhanc|super.?res/i],
  ImageRemoveBackground: [/background|remove.?bg|rembg|cutout|matting/i],
  ImageToVideo: [/image.?to.?video|i2v|animate|generate.?video|video.?gen|create.?video/i, /video|dop|kling|veo|seedance/i],
  ReferenceToVideo: [/reference.?to.?video|ref.?video|multi.?ref/i, /image.?to.?video|generate.?video|video/i],
  OmniReference: [/omni|element|reference/i, /video/i],
  MotionToVideo: [/motion/i, /video/i],
  VideoExtension: [/extend/i, /video/i],
  VideoUpscale: [/video.?upscal|upscale.?video/i, /upscal/i],
  VideoEdit: [/video.?edit|edit.?video|video.?to.?video/i],
  VideoToAudio: [/sfx|sound.?effect|foley|video.?to.?audio|audio.?for.?video/i],
  AudioToVideo: [/lip.?sync|talking|avatar|speak|audio.?to.?video/i],
  TextToDialog: [/speech|tts|voice|dialog|speak/i],
  TextToMusic: [/music|song/i],
};

const OUTPUT_HINT: Record<MediaKind, RegExp> = { image: /image|photo|picture|img/i, video: /video|clip|animate/i, audio: /audio|speech|voice|music|sound/i };

function scoreTool(action: ActionType, tool: McpTool): number {
  if (NON_GENERATION.test(tool.name)) return -1;
  const text = `${tool.name} ${tool.description ?? ''}`;
  const hints = ACTION_HINTS[action];
  let score = 0;
  hints.forEach((re, i) => {
    if (re.test(tool.name)) score += (hints.length - i) * 10;
    else if (re.test(text)) score += (hints.length - i) * 4;
  });
  const out = ACTIONS[action].output;
  if (OUTPUT_HINT[out].test(tool.name)) score += 5;
  // penalize tools that clearly produce another media kind
  for (const [kind, re] of Object.entries(OUTPUT_HINT)) if (kind !== out && re.test(tool.name) && !OUTPUT_HINT[out].test(tool.name)) score -= 8;
  const props = Object.keys(tool.inputSchema?.properties ?? {});
  if (props.some((p) => /prompt|text/i.test(p))) score += 2;
  const needsImage = ACTIONS[action].mediaInputs.some((m) => m.required && m.accepted.includes('image'));
  if (needsImage && props.some((p) => /image|frame/i.test(p))) score += 6;
  const needsVideo = ACTIONS[action].mediaInputs.some((m) => m.required && m.accepted.includes('video'));
  if (needsVideo && props.some((p) => /video/i.test(p))) score += 6;
  return score;
}

const isArray = (s?: JsonSchema) => s?.type === 'array' || (Array.isArray(s?.type) && s!.type.includes('array'));

const MEDIA_PROP_PATTERNS: Record<string, RegExp[]> = {
  startFrame: [/start|first|init|^image$|input_image|image_url$|source_image|^image_?urls?$/i, /image/i],
  endFrame: [/end|last|tail|final/i],
  referenceImages: [/reference|ref_|images|image_urls|input_images/i, /image/i],
  character: [/character|subject|identity|reference|images|image/i],
  referenceScene: [/scene|background|environment/i],
  sourceImage: [/source|input|^image$|image_url|image/i],
  imageSource: [/^image$|image_url|source|portrait|avatar|image/i],
  referenceImage: [/^image$|image_url|reference|image/i],
  element1: [/element|reference|images|image/i],
  element2: [/element|reference|images|image/i],
  sourceVideo: [/^video$|video_url|source_video|input_video|video/i],
  motionReference: [/motion|reference_video|driving|video/i],
  referenceVideos: [/reference_video|videos|video/i],
  referenceAudio: [/audio|voice/i],
  referenceAudios: [/voice|reference_audio|audio/i],
  audioSource: [/^audio$|audio_url|speech|voice|audio/i],
};

const COMMON_PROP_PATTERNS: [string, RegExp][] = [
  ['negative_prompt', /negative/i],
  ['prompt', /^(prompt|text|description|input|instructions?|script|lyrics)$/i],
  ['model', /^(model|model_?id|model_?name)$/i],
  ['aspect_ratio', /aspect/i],
  ['duration', /duration|seconds|length/i],
  ['resolution', /resolution|quality|^size$|image_size/i],
  ['seed', /^seed$/i],
  ['num_images', /num_?images|^count$|^n$|batch|num_outputs|number_of_images/i],
];

/** Build an argument template for `tool` serving `action`. */
export function inferArgs(action: ActionType, tool: McpTool): Record<string, unknown> {
  const props = tool.inputSchema?.properties ?? {};
  const args: Record<string, unknown> = {};
  const used = new Set<string>();
  // media inputs first (most specific patterns first)
  for (const input of ACTIONS[action].mediaInputs) {
    const patterns = MEDIA_PROP_PATTERNS[input.id] ?? [/image/i];
    let found: string | undefined;
    for (const re of patterns) {
      found = Object.keys(props).find((p) => !used.has(p) && re.test(p) && (input.accepted.includes('video') || !/video|audio/i.test(p)) && (input.accepted.includes('audio') || !/audio|voice/i.test(p)));
      if (found) break;
    }
    if (!found) continue;
    used.add(found);
    args[found] = isArray(props[found]) ? `{{${input.id}[]}}` : `{{${input.id}}}`;
  }
  for (const [key, re] of COMMON_PROP_PATTERNS) {
    const p = Object.keys(props).find((k) => !used.has(k) && re.test(k));
    if (!p) continue;
    used.add(p);
    args[p] = `{{${key}}}`;
  }
  return args;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** pick the enum value closest to `want` */
function closestEnum(values: unknown[], want: unknown): unknown {
  if (want === undefined || want === null) return values[0];
  const w = normalize(String(want));
  const exact = values.find((v) => normalize(String(v)) === w);
  if (exact !== undefined) return exact;
  const partial = values.find((v) => normalize(String(v)).includes(w) || w.includes(normalize(String(v))));
  if (partial !== undefined) return partial;
  // aspect "16:9" vs "landscape_16_9"
  const digits = String(want).replace(/\D+/g, '_');
  const byDigits = values.find((v) => String(v).replace(/\D+/g, '_').includes(digits));
  return byDigits ?? values[0];
}

function coerce(schema: JsonSchema | undefined, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (schema?.enum?.length) return closestEnum(schema.enum, value);
  const t = Array.isArray(schema?.type) ? schema!.type[0] : schema?.type;
  if (t === 'number' || t === 'integer') {
    const n = parseFloat(String(value));
    return Number.isFinite(n) ? (t === 'integer' ? Math.round(n) : n) : undefined;
  }
  if (t === 'boolean') return value === true || value === 'true';
  if (t === 'array' && !Array.isArray(value)) return [value];
  if (t === 'string' && Array.isArray(value)) return value[0];
  return value;
}

// ---------- result parsing ----------

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif|mp4|mov|webm|m4v|mp3|wav|m4a|ogg|aac|flac)(\?|#|$)/i;
const URL_RE = /https?:\/\/[^\s"'<>\\)\]]+/g;

function kindOfUrl(url: string, hint?: string): MediaKind | undefined {
  const u = url.toLowerCase();
  if (/\.(mp4|mov|webm|m4v)(\?|$)/.test(u)) return 'video';
  if (/\.(mp3|wav|m4a|ogg|aac|flac)(\?|$)/.test(u)) return 'audio';
  if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/.test(u)) return 'image';
  if (hint && /video/i.test(hint)) return 'video';
  if (hint && /audio|speech|music/i.test(hint)) return 'audio';
  if (hint && /image|photo/i.test(hint)) return 'image';
  return undefined;
}

interface ParsedResult {
  outputs: RawOutput[];
  jobId?: string;
  status?: string;
  progress?: number;
  error?: string;
  text: string;
}

function walkJson(v: unknown, visit: (key: string, value: unknown, parentKey: string) => void, key = '', parent = ''): void {
  if (Array.isArray(v)) v.forEach((x) => walkJson(x, visit, key, parent));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    visit(k, x, key);
    walkJson(x, visit, k, key);
  }
}

function tryJson(s: string): unknown {
  const t = s.trim();
  if (!/^[[{]/.test(t)) {
    const m = /```(?:json)?\s*([\s\S]+?)```/.exec(t);
    if (!m) return undefined;
    return tryJson(m[1]);
  }
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export function parseToolResult(result: { content?: unknown; structuredContent?: unknown; isError?: boolean }, expect: MediaKind): ParsedResult {
  const out: ParsedResult = { outputs: [], text: '' };
  const seen = new Set<string>();
  const add = (url: string, hint?: string) => {
    const clean = url.replace(/[.,;]+$/, '');
    if (seen.has(clean)) return;
    const kind = kindOfUrl(clean, hint);
    const looksMedia = MEDIA_EXT.test(clean) || (hint && /url|uri|output|result|media|image|video|audio|file|download|asset/i.test(hint));
    if (!looksMedia) return;
    seen.add(clean);
    out.outputs.push({ url: clean, type: kind ?? expect });
  };
  const jsons: unknown[] = [];
  if (result.structuredContent) jsons.push(result.structuredContent);
  const content = Array.isArray(result.content) ? (result.content as Record<string, unknown>[]) : [];
  for (const c of content) {
    if (c.type === 'text' && typeof c.text === 'string') {
      out.text += `${c.text}\n`;
      const j = tryJson(c.text);
      if (j !== undefined) jsons.push(j);
      else for (const m of c.text.matchAll(URL_RE)) add(m[0], c.text.slice(Math.max(0, (m.index ?? 0) - 40), m.index));
    } else if ((c.type === 'image' || c.type === 'audio') && typeof c.data === 'string') {
      out.outputs.push({ url: `data:${c.mimeType ?? (c.type === 'image' ? 'image/png' : 'audio/mpeg')};base64,${c.data}`, type: c.type as MediaKind });
    } else if (c.type === 'resource_link' && typeof c.uri === 'string') {
      add(c.uri, String(c.mimeType ?? c.name ?? 'resource'));
    } else if (c.type === 'resource' && c.resource && typeof c.resource === 'object') {
      const r = c.resource as Record<string, unknown>;
      if (typeof r.blob === 'string') out.outputs.push({ url: `data:${r.mimeType ?? 'application/octet-stream'};base64,${r.blob}`, type: kindOfUrl(String(r.uri ?? ''), String(r.mimeType ?? '')) ?? expect });
      else if (typeof r.uri === 'string') add(r.uri, String(r.mimeType ?? 'resource'));
    }
  }
  for (const j of jsons) {
    walkJson(j, (k, v, parentKey) => {
      if (typeof v === 'string') {
        if (/^https?:\/\//.test(v)) add(v, `${parentKey} ${k}`);
        if (!out.jobId && /^(job_?id|request_?id|generation_?id|task_?id|prediction_?id|id)$/i.test(k) && v.length >= 6 && !/^https?:/.test(v)) out.jobId = v;
        if (!out.status && /^(status|state)$/i.test(k)) out.status = v;
        if (!out.error && /^(error|error_message|failure_reason|detail)$/i.test(k) && v) out.error = v;
      } else if (typeof v === 'number' && /progress|percent/i.test(k)) {
        out.progress = v <= 1 ? Math.round(v * 100) : Math.round(v);
      }
    });
  }
  if (!out.outputs.length && !out.jobId) {
    const m = /\b(?:job|request|generation|task)[ _-]?id[^a-zA-Z0-9]{1,5}([a-zA-Z0-9_-]{6,})/i.exec(out.text);
    if (m) out.jobId = m[1];
  }
  if (result.isError) out.error ??= out.text.trim() || 'erro do provedor';
  return out;
}

const FAILED = /fail|error|cancel|reject|nsfw|moderat/i;
const DONE = /complete|succe|done|finish|ready/i;

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------

export class HiggsfieldMcpProvider implements GenerationProvider {
  id = 'higgsfield';
  name = 'Higgsfield (MCP)';

  private auth = new FileOAuthProvider();
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private tools: McpTool[] = [];
  private connecting?: Promise<void>;
  private lastError?: string;
  private modelCache?: { at: number; models: ModelInfo[] };
  private mapping: MappingFile = {};

  async init(): Promise<void> {
    await this.auth.load();
    this.mapping = (await readJson<MappingFile>(MAPPING_FILE)) ?? {};
    if (HIGGSFIELD_MCP_TOKEN || this.auth.hasTokens()) {
      // don't block server startup on the network
      void this.ensureConnected().catch((e) => (this.lastError = String(e?.message ?? e)));
    }
  }

  private makeTransport() {
    const url = new URL(HIGGSFIELD_MCP_URL);
    return new StreamableHTTPClientTransport(
      url,
      HIGGSFIELD_MCP_TOKEN ? { requestInit: { headers: { Authorization: `Bearer ${HIGGSFIELD_MCP_TOKEN}` } } } : { authProvider: this.auth },
    );
  }

  private async connectOnce(): Promise<void> {
    const client = new Client({ name: 'claquete', version: '0.1.0' });
    const transport = this.makeTransport();
    this.transport = transport;
    try {
      await client.connect(transport);
    } catch (err) {
      if (err instanceof UnauthorizedError || /unauthori[sz]ed|401/i.test(String((err as Error)?.message))) {
        throw new ProviderError('Conecte sua conta Higgsfield em Configurações.', true);
      }
      throw err;
    }
    this.client = client;
    const listed = await client.listTools();
    this.tools = listed.tools as McpTool[];
    this.lastError = undefined;
    this.modelCache = undefined;
  }

  async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= this.connectOnce().finally(() => (this.connecting = undefined));
    await this.connecting;
    return this.client!;
  }

  /** Starts (or restarts) the OAuth flow; returns the URL the user must open. */
  async beginAuth(): Promise<{ authUrl?: string; connected: boolean }> {
    if (HIGGSFIELD_MCP_TOKEN) {
      await this.ensureConnected();
      return { connected: true };
    }
    this.auth.pendingAuthUrl = undefined;
    await this.disconnect(false);
    try {
      await this.connectOnce();
      return { connected: true };
    } catch (err) {
      if (this.auth.pendingAuthUrl) return { authUrl: this.auth.pendingAuthUrl, connected: false };
      this.lastError = String((err as Error)?.message ?? err);
      throw err;
    }
  }

  async finishAuth(code: string): Promise<void> {
    if (!this.transport) this.transport = this.makeTransport();
    await this.transport.finishAuth(code);
    await this.connectOnce();
  }

  async disconnect(forget: boolean): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    this.client = undefined;
    this.tools = [];
    if (forget) await this.auth.invalidateCredentials('all');
  }

  async status(): Promise<ProviderStatus> {
    if (!this.client && (HIGGSFIELD_MCP_TOKEN || this.auth.hasTokens())) {
      await this.ensureConnected().catch((e) => (this.lastError = String(e?.message ?? e)));
    }
    return {
      id: this.id,
      name: this.name,
      connected: !!this.client,
      needsAuth: !this.client && !HIGGSFIELD_MCP_TOKEN,
      error: this.lastError,
      tools: this.tools.map((t) => ({ name: t.name, description: t.description })),
      detail: HIGGSFIELD_MCP_URL,
    };
  }

  getTools(): McpTool[] {
    return this.tools;
  }

  getMapping(): MappingFile {
    return this.mapping;
  }

  async setMapping(m: MappingFile): Promise<void> {
    this.mapping = m;
    await writeJson(MAPPING_FILE, m);
  }

  /** explicit override, else inferred mapping */
  resolveMapping(action: ActionType): ToolMapping | undefined {
    const explicit = this.mapping.actions?.[action];
    if (explicit && this.tools.some((t) => t.name === explicit.tool)) return explicit;
    const ranked = this.tools.map((t) => ({ t, s: scoreTool(action, t) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const best = ranked[0]?.t;
    return best ? { tool: best.name, args: inferArgs(action, best) } : undefined;
  }

  inferredMappings(): Record<string, ToolMapping | null> {
    const out: Record<string, ToolMapping | null> = {};
    for (const a of Object.keys(ACTIONS) as ActionType[]) out[a] = this.resolveMapping(a) ?? null;
    return out;
  }

  private findTool(re: RegExp, override?: string): McpTool | undefined {
    if (override) return this.tools.find((t) => t.name === override);
    return this.tools.find((t) => re.test(t.name));
  }

  async callTool(name: string, args: Record<string, unknown>, opts: { signal?: AbortSignal; onProgress?: (p: number, msg?: string) => void; timeoutMs?: number } = {}) {
    const client = await this.ensureConnected();
    try {
      return (await client.callTool({ name, arguments: args }, undefined, {
        signal: opts.signal,
        timeout: opts.timeoutMs ?? 15 * 60_000,
        resetTimeoutOnProgress: true,
        onprogress: (p) => {
          const pct = p.total ? Math.round((p.progress / p.total) * 100) : Math.min(95, Math.round(p.progress));
          opts.onProgress?.(pct, p.message);
        },
      })) as { content?: unknown; structuredContent?: unknown; isError?: boolean };
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.client = undefined;
        throw new ProviderError('Sessão Higgsfield expirou. Reconecte em Configurações.', true);
      }
      throw err;
    }
  }

  async models(): Promise<ModelInfo[]> {
    if (this.modelCache && Date.now() - this.modelCache.at < 10 * 60_000) return this.modelCache.models;
    if (!this.client) return DEFAULT_MODELS;
    const tool = this.findTool(/(^|_)(list_?models|models|get_?models|catalog)($|_)/i, this.mapping.modelsTool);
    if (!tool) return DEFAULT_MODELS;
    try {
      const res = await this.callTool(tool.name, {}, { timeoutMs: 60_000 });
      const models = parseModelCatalog(res);
      const result = models.length ? [DEFAULT_MODELS[0], ...models] : DEFAULT_MODELS;
      this.modelCache = { at: Date.now(), models: result };
      return result;
    } catch {
      return DEFAULT_MODELS;
    }
  }

  /** Higgsfield needs fetchable URLs for inputs: reuse remote URLs, upload, or inline. */
  private async mediaForTool(ref: MediaRef, ctx: ProviderContext): Promise<string> {
    if (ref.remoteUrl) return ref.remoteUrl;
    const resolved = await ctx.resolveMedia(ref);
    if (!resolved.startsWith('data:')) return resolved;
    const upload = this.findTool(/upload/i, this.mapping.uploadTool);
    if (!upload) return resolved;
    const props = upload.inputSchema.properties ?? {};
    const args: Record<string, unknown> = {};
    const m = /^data:([^;]+);base64,(.*)$/s.exec(resolved);
    for (const key of Object.keys(props)) {
      if (/data_?uri|url|uri/i.test(key)) args[key] = resolved;
      else if (/base64|data|content|file/i.test(key)) args[key] = m?.[2] ?? resolved;
      else if (/mime|content_?type/i.test(key)) args[key] = m?.[1];
      else if (/name/i.test(key)) args[key] = `${ref.nodeId}.${(m?.[1] ?? 'image/png').split('/')[1]}`;
    }
    const res = await this.callTool(upload.name, args, { signal: ctx.signal, timeoutMs: 120_000 });
    const parsed = parseToolResult(res, ref.type === 'text' ? 'image' : ref.type);
    const any = parsed.outputs[0]?.url ?? /https?:\/\/\S+/.exec(parsed.text)?.[0];
    return any ?? resolved;
  }

  async generate(req: GenerateRequest, ctx: ProviderContext): Promise<RawOutput[]> {
    await this.ensureConnected();
    const mapping = this.resolveMapping(req.actionType);
    if (!mapping) throw new ProviderError(`Nenhuma ferramenta do Higgsfield MCP corresponde à ação "${ACTIONS[req.actionType].name}". Ajuste o mapeamento em Configurações.`);
    const tool = this.tools.find((t) => t.name === mapping.tool)!;
    const props = tool.inputSchema.properties ?? {};

    ctx.progress(3, 'Preparando referências…');
    const media: Record<string, string[]> = {};
    for (const [inputId, refs] of Object.entries(req.mediaInputs)) {
      media[inputId] = [];
      for (const r of refs) if (r.type !== 'text') media[inputId].push(await this.mediaForTool(r, ctx));
    }

    const prompt = [req.prompt, req.stylePrompt].filter(Boolean).join('\n\nStyle: ');
    const values: Record<string, unknown> = { ...req.settings, prompt, model: req.model === 'auto' ? undefined : req.model };
    const args: Record<string, unknown> = {};
    for (const [key, tpl] of Object.entries(mapping.args)) {
      let v: unknown = tpl;
      if (typeof tpl === 'string') {
        const m = /^\{\{(\w+)(\[\])?\}\}$/.exec(tpl);
        if (m) v = m[2] ? media[m[1]] ?? values[m[1]] : media[m[1]]?.[0] ?? values[m[1]];
        else v = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(media[k]?.[0] ?? values[k] ?? ''));
      }
      const c = coerce(props[key], v);
      if (c !== undefined && !(Array.isArray(c) && !c.length)) args[key] = c;
    }
    // fill required enum props we could not map with their default/first value
    for (const r of tool.inputSchema.required ?? []) {
      if (args[r] !== undefined) continue;
      const s = props[r];
      if (s?.default !== undefined) args[r] = s.default;
      else if (s?.enum?.length) args[r] = s.enum[0];
    }

    ctx.progress(8, `Enviando para ${tool.name}…`);
    const expect = ACTIONS[req.actionType].output;
    const res = await this.callTool(tool.name, args, { signal: ctx.signal, onProgress: (p, msg) => ctx.progress(Math.max(10, Math.min(95, p)), msg) });
    let parsed = parseToolResult(res, expect);
    if (parsed.error && !parsed.outputs.length) throw new ProviderError(parsed.error);
    if (parsed.outputs.length) return parsed.outputs;
    if (!parsed.jobId) throw new ProviderError(`O Higgsfield não retornou mídia nem id de job. Resposta: ${parsed.text.slice(0, 300) || '(vazia)'}`);
    parsed = await this.pollJob(parsed.jobId, expect, ctx);
    return parsed.outputs;
  }

  private async pollJob(jobId: string, expect: MediaKind, ctx: ProviderContext): Promise<ParsedResult> {
    const tool = this.findTool(/(status|result|get_?(job|generation|task|request)|poll|check)/i, this.mapping.statusTool);
    if (!tool) throw new ProviderError(`Job ${jobId} criado, mas não há ferramenta de status para acompanhar. Defina "statusTool" no mapeamento.`);
    const idProp = Object.keys(tool.inputSchema.properties ?? {}).find((k) => /id/i.test(k)) ?? 'id';
    const deadline = Date.now() + 25 * 60_000;
    let fake = 15;
    while (Date.now() < deadline) {
      if (ctx.signal.aborted) throw new Error('cancelado');
      await new Promise((r) => setTimeout(r, 4000));
      const res = await this.callTool(tool.name, { [idProp]: jobId }, { signal: ctx.signal, timeoutMs: 60_000 });
      const p = parseToolResult(res, expect);
      if (p.outputs.length && (!p.status || DONE.test(p.status))) return p;
      if ((p.status && FAILED.test(p.status)) || (p.error && !p.outputs.length && res.isError)) throw new ProviderError(p.error ?? `Geração falhou (${p.status})`);
      fake = Math.min(92, fake + 3);
      ctx.progress(p.progress ?? fake, p.status ? `Higgsfield: ${p.status}` : 'Processando no Higgsfield…');
    }
    throw new ProviderError('Tempo esgotado aguardando o Higgsfield.');
  }
}

// ---------- model catalog parsing ----------

function categoryActions(cat: string, name: string): ActionType[] {
  const c = `${cat} ${name}`.toLowerCase();
  if (/upscal/.test(c)) return /video/.test(c) ? ['VideoUpscale'] : ['ImageUpscale'];
  if (/background|bg/.test(c)) return ['ImageRemoveBackground'];
  if (/lip|avatar|talking/.test(c)) return ['AudioToVideo'];
  if (/music|song/.test(c)) return ['TextToMusic'];
  if (/speech|voice|tts|audio/.test(c)) return ['TextToDialog'];
  if (/video|motion|dop|kling|veo|seedance|wan|sora|hailuo|minimax/.test(c)) return ['ImageToVideo', 'ReferenceToVideo', 'OmniReference', 'MotionToVideo', 'VideoExtension'];
  return ['Image', 'TextToImage', 'EditImage', 'CharacterReference', 'ImageStyleTransfer', 'ChangeAngle', 'ImageInpaint'];
}

export function parseModelCatalog(res: { content?: unknown; structuredContent?: unknown }): ModelInfo[] {
  const jsons: unknown[] = [];
  if (res.structuredContent) jsons.push(res.structuredContent);
  for (const c of (Array.isArray(res.content) ? res.content : []) as Record<string, unknown>[]) {
    if (c.type === 'text' && typeof c.text === 'string') {
      const j = tryJson(c.text);
      if (j !== undefined) jsons.push(j);
    }
  }
  const out = new Map<string, ModelInfo>();
  const visit = (v: unknown, cat = '') => {
    if (Array.isArray(v)) return v.forEach((x) => visit(x, cat));
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const id = (o.id ?? o.model ?? o.model_id ?? o.slug ?? o.key) as string | undefined;
    const name = (o.name ?? o.title ?? o.display_name ?? id) as string | undefined;
    if (typeof id === 'string' && typeof name === 'string' && (o.type || o.category || o.kind || o.description || o.name)) {
      const category = String(o.type ?? o.category ?? o.kind ?? o.modality ?? cat ?? '');
      out.set(id, {
        id,
        name,
        description: typeof o.description === 'string' ? o.description : undefined,
        actions: categoryActions(category, `${id} ${name}`),
        providerModel: id,
      });
      return;
    }
    for (const [k, x] of Object.entries(o)) visit(x, /image|video|audio|speech|music|upscale/i.test(k) ? k : cat);
  };
  jsons.forEach((j) => visit(j));
  return [...out.values()];
}

export async function readMappingFile(): Promise<MappingFile> {
  return (await readJson<MappingFile>(MAPPING_FILE)) ?? {};
}

export async function mappingFileExists(): Promise<boolean> {
  return fs
    .access(MAPPING_FILE)
    .then(() => true)
    .catch(() => false);
}
