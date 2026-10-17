import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_MODELS } from '../../shared/actions';
import { ACTIONS } from '../../shared/actions';
import { aspectToSize } from '../../shared/project';
import type { GenerateRequest, ModelInfo, ProviderStatus } from '../../shared/types';
import { run } from '../media';
import { paintPlaceholder } from '../util/png';
import type { GenerationProvider, ProviderContext, RawOutput } from './types';

// Offline provider: no network, no credits. Paints deterministic frames,
// animates them with ffmpeg and synthesizes audio, so every flow of the app
// can be exercised locally.

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('cancelado'));
    });
  });

async function tmpFile(ext: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claquete-'));
  return path.join(dir, `out.${ext}`);
}

async function readAsDataUri(file: string, mime: string): Promise<string> {
  const buf = await fs.readFile(file);
  await fs.rm(path.dirname(file), { recursive: true, force: true }).catch(() => undefined);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export class MockProvider implements GenerationProvider {
  id = 'mock';
  name = 'Offline (simulado)';

  async status(): Promise<ProviderStatus> {
    return { id: this.id, name: this.name, connected: true, detail: 'Gera mídias de demonstração localmente, sem custo.' };
  }

  async models(): Promise<ModelInfo[]> {
    return DEFAULT_MODELS;
  }

  async generate(req: GenerateRequest, ctx: ProviderContext): Promise<RawOutput[]> {
    const action = ACTIONS[req.actionType];
    const steps = action.output === 'video' ? 10 : 5;
    for (let i = 1; i <= steps; i++) {
      await sleep(350, ctx.signal);
      ctx.progress(Math.round((i / (steps + 1)) * 100), 'Gerando (simulado)…');
    }
    const seed = `${req.prompt}|${req.model}|${Date.now()}`;
    if (action.output === 'image') {
      const n = Math.max(1, Math.min(4, Number(req.settings.num_images ?? req.count ?? 1)));
      const ar = String(req.settings.aspect_ratio ?? '16:9');
      const { width, height } = aspectToSize(ar, 768);
      return Array.from({ length: n }, (_, i) => ({
        type: 'image' as const,
        url: `data:image/png;base64,${paintPlaceholder(width, height - (height % 2), `${seed}#${i}`).toString('base64')}`,
      }));
    }
    if (action.output === 'video') return [await this.video(req, ctx, seed)];
    return [await this.audio(req, ctx)];
  }

  private async video(req: GenerateRequest, ctx: ProviderContext, seed: string): Promise<RawOutput> {
    const duration = Math.max(2, Math.min(15, Number(req.settings.duration ?? 5)));
    const first = Object.values(req.mediaInputs).flat().find((r) => r.type === 'image');
    let still = first ? ctx.localFile(first) : undefined;
    let cleanup: string | undefined;
    if (!still) {
      still = await tmpFile('png');
      cleanup = still;
      await fs.writeFile(still, paintPlaceholder(1280, 720, seed));
    }
    const out = await tmpFile('mp4');
    const frames = Math.round(duration * 24);
    const zoom = /dolly_out|afast|out/i.test(req.prompt) ? `zoom='max(1.25-0.0025*on,1)'` : `zoom='min(1+0.0018*on,1.25)'`;
    const vf = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=${zoom}:d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=24,format=yuv420p`;
    const res = await run('ffmpeg', ['-y', '-loop', '1', '-i', still, '-f', 'lavfi', '-i', `anoisesrc=d=${duration}:c=pink:a=0.02`, '-vf', vf, '-t', String(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', out]);
    if (cleanup) await fs.rm(path.dirname(cleanup), { recursive: true, force: true }).catch(() => undefined);
    if (res.code !== 0) throw new Error(`ffmpeg falhou: ${res.stderr.slice(-400)}`);
    ctx.progress(95);
    return { type: 'video', url: await readAsDataUri(out, 'video/mp4') };
  }

  private async audio(req: GenerateRequest, ctx: ProviderContext): Promise<RawOutput> {
    const isMusic = req.actionType === 'TextToMusic';
    const duration = isMusic ? Math.max(5, Math.min(120, Number(req.settings.duration ?? 15))) : Math.max(2, Math.min(30, req.prompt.length / 14));
    const out = await tmpFile('mp3');
    const src = isMusic
      ? `aevalsrc='0.15*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.1*sin(2*PI*330*t)+0.08*sin(2*PI*440*t)*(t-floor(t)<0.5)':d=${duration}`
      : `aevalsrc='0.2*sin(2*PI*(160+40*sin(2*PI*3*t))*t)*(0.5+0.5*sin(2*PI*4*t))':d=${duration}`;
    const res = await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', src, '-c:a', 'libmp3lame', '-q:a', '5', out]);
    if (res.code !== 0) throw new Error(`ffmpeg falhou: ${res.stderr.slice(-400)}`);
    ctx.progress(95);
    return { type: 'audio', url: await readAsDataUri(out, 'audio/mpeg') };
  }
}
