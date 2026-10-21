import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MEDIA_DIR, PUBLIC_BASE_URL } from './config';
import { assertId } from './storage';
import { uid } from '../shared/project';
import type { MediaKind } from '../shared/types';
import { buildR2Key, uploadBufferToR2 } from './r2';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
};

const KIND_BY_EXT: Record<string, MediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
};

export function kindFromName(name: string, mime?: string): MediaKind | undefined {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  const ext = name.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return KIND_BY_EXT[ext];
}

export interface SavedMedia {
  url: string;
  file: string;
  kind: MediaKind;
  width?: number;
  height?: number;
  duration?: number;
}

export function mediaPath(projectId: string, ...parts: string[]): string {
  return path.join(MEDIA_DIR, assertId(projectId), ...parts);
}

/** `/media/<project>/<file>` or `https://media.umcaracaramelo.com.br/claquete/...` -> absolute local path if cached */
export function resolveMediaUrl(url: string): string | undefined {
  const clean = url.split('?')[0];
  let m = /^\/media\/([a-zA-Z0-9-]{6,64})\/([a-zA-Z0-9._/-]+)$/.exec(clean);
  if (m && !m[2].includes('..')) {
    return path.join(MEDIA_DIR, m[1], m[2]);
  }
  m = /media\.umcaracaramelo\.com\.br\/claquete\/([a-zA-Z0-9-]{6,64})\/([a-zA-Z0-9._/-]+)$/.exec(clean);
  if (m && !m[2].includes('..')) {
    return path.join(MEDIA_DIR, m[1], m[2]);
  }
  return undefined;
}

export async function saveBuffer(projectId: string, buf: Buffer, opts: { ext?: string; mime?: string; sub?: string } = {}): Promise<SavedMedia> {
  const ext = (opts.ext ?? (opts.mime ? EXT_BY_MIME[opts.mime.split(';')[0]] : undefined) ?? 'bin').toLowerCase();
  const sub = opts.sub ?? 'uploads';
  const name = `${uid()}.${ext}`;
  const file = mediaPath(projectId, sub, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  const kind = kindFromName(name, opts.mime) ?? 'image';
  const meta = await probe(file, kind);

  // Cloudflare R2 upload (with fallback to local URL)
  const r2Key = buildR2Key(projectId, sub, name);
  const r2Result = await uploadBufferToR2(r2Key, buf, opts.mime);
  const url = r2Result?.url ?? `/media/${projectId}/${sub}/${name}`;

  return { url, file, kind, ...meta };
}

export async function downloadToProject(projectId: string, remoteUrl: string, sub = 'generated'): Promise<SavedMedia> {
  if (remoteUrl.startsWith('data:')) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(remoteUrl);
    if (!m) throw new Error('data URI inválida');
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    return saveBuffer(projectId, buf, { mime: m[1], sub });
  }
  const res = await fetch(remoteUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download falhou (${res.status}) ${remoteUrl}`);
  const mime = res.headers.get('content-type') ?? undefined;
  const urlExt = new URL(remoteUrl).pathname.split('.').pop()?.toLowerCase();
  const ext = (mime && EXT_BY_MIME[mime.split(';')[0]]) || (urlExt && KIND_BY_EXT[urlExt] ? urlExt : undefined);
  const buf = Buffer.from(await res.arrayBuffer());
  return saveBuffer(projectId, buf, { ext, mime, sub });
}

export function run(cmd: string, args: string[], onStderr?: (line: string) => void): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => {
      const s = String(d);
      stderr += s;
      if (onStderr) s.split(/\r|\n/).forEach((l) => l && onStderr(l));
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

export async function probe(file: string, kind: MediaKind): Promise<{ width?: number; height?: number; duration?: number }> {
  if (file.endsWith('.svg')) {
    const svg = await fs.readFile(file, 'utf8').catch(() => '');
    const w = Number(/width="(\d+)/.exec(svg)?.[1]);
    const h = Number(/height="(\d+)/.exec(svg)?.[1]);
    return w && h ? { width: w, height: h } : {};
  }
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,duration:format=duration', '-of', 'json', file]);
    const j = JSON.parse(stdout) as { streams?: { width?: number; height?: number; duration?: string }[]; format?: { duration?: string } };
    const v = j.streams?.find((s) => s.width && s.height);
    const dur = Number(j.format?.duration ?? j.streams?.find((s) => s.duration)?.duration);
    return {
      width: v?.width,
      height: v?.height,
      duration: kind === 'image' || !Number.isFinite(dur) ? undefined : Math.round(dur * 1000) / 1000,
    };
  } catch {
    return {};
  }
}

export async function fileToDataUri(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Public URL for a media file: returns R2 public URL directly or tunnel URL. */
export function publicUrlFor(localUrl: string): string | undefined {
  if (localUrl.startsWith('http://') || localUrl.startsWith('https://')) return localUrl;
  if (!PUBLIC_BASE_URL || !localUrl.startsWith('/media/')) return undefined;
  return `${PUBLIC_BASE_URL}${localUrl}`;
}
