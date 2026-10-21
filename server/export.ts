import fs from 'node:fs';
import { timelineDuration, uid } from '../shared/project';
import type { Clip, Project, Timeline } from '../shared/types';
import { createJob, emitJob } from './jobs';
import { mediaPath, resolveMediaUrl, run } from './media';
import { buildR2Key, uploadBufferToR2 } from './r2';
import { getProject } from './storage';

// Timeline -> MP4. Every visual clip is overlaid on a black canvas inside
// its [start, end) window, in track order (main track at the bottom), so the
// render matches the editor preview. Audio from video clips and audio tracks
// is delayed to its timeline position and mixed.

export interface ExportOptions {
  projectId: string;
  timelineId?: string;
  width?: number;
  height?: number;
  fps?: number;
}

const FONT_CANDIDATES = [
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

const fontFile = () => FONT_CANDIDATES.find((f) => fs.existsSync(f));

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019").replace(/%/g, '\\%');
const n3 = (x: number) => Math.max(0, Math.round(x * 1000) / 1000);

function atempoChain(speed: number): string {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) {
    parts.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  parts.push(`atempo=${n3(s)}`);
  return parts.join(',');
}

async function hasAudio(file: string): Promise<boolean> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]).catch(() => ({ stdout: '' }));
  return stdout.trim().length > 0;
}

export async function buildExportArgs(project: Project, timeline: Timeline, outFile: string, W: number, H: number, fps: number) {
  const total = Math.max(0.5, timelineDuration(timeline));
  const trackOrder = new Map(timeline.tracks.map((t, i) => [t.id, i]));
  const trackById = new Map(timeline.tracks.map((t) => [t.id, t]));
  const clips = Object.values(timeline.clips)
    .filter((c) => {
      const t = trackById.get(c.trackId);
      return t && t.visible !== false;
    })
    .sort((a, b) => (trackOrder.get(a.trackId)! - trackOrder.get(b.trackId)!) || a.start - b.start);

  const args: string[] = ['-y'];
  const filters: string[] = [`color=c=black:s=${W}x${H}:r=${fps}:d=${n3(total)},format=yuv420p[base]`];
  const audioLabels: string[] = [];
  let inputIndex = 0;
  let last = 'base';
  const font = fontFile();

  for (const [i, c] of clips.entries()) {
    const track = trackById.get(c.trackId)!;
    const end = c.start + c.duration;
    if (c.mediaType === 'text') {
      if (!font || !c.text?.content) continue;
      const lbl = `t${i}`;
      const size = Math.round((c.text.size ?? 48) * (H / 720));
      filters.push(
        `[${last}]drawtext=fontfile='${esc(font)}':text='${esc(c.text.content)}':fontcolor=${(c.text.color ?? '#ffffff').replace('#', '0x')}:fontsize=${size}:x=(w-text_w)/2:y=h*${n3(c.text.y ?? 0.85)}-text_h/2:box=1:boxcolor=black@0.35:boxborderw=12:enable='between(t,${n3(c.start)},${n3(end)})'[${lbl}]`,
      );
      last = lbl;
      continue;
    }
    const file = c.url ? resolveMediaUrl(c.url) : undefined;
    if (!file || !fs.existsSync(file)) continue;
    const speed = c.speed > 0 ? c.speed : 1;
    const srcDur = c.duration * speed;

    if (c.mediaType === 'image') {
      args.push('-loop', '1', '-t', String(n3(c.duration + 0.1)), '-i', file);
    } else {
      args.push('-i', file);
    }
    const idx = inputIndex++;

    if (c.mediaType === 'image' || c.mediaType === 'video') {
      const v = `v${i}`;
      const chain: string[] = [];
      if (c.mediaType === 'video') chain.push(`trim=start=${n3(c.in)}:duration=${n3(srcDur)}`, `setpts=(PTS-STARTPTS)/${n3(speed)}`);
      else chain.push(`trim=duration=${n3(c.duration)}`, 'setpts=PTS-STARTPTS');
      chain.push(`fps=${fps}`, `scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`, 'format=yuva420p');
      const tIn = c.transitionIn && c.transitionIn.type !== 'none' ? c.transitionIn.duration : 0;
      const fadeIn = Math.max(c.fadeIn ?? 0, tIn);
      if (fadeIn > 0) chain.push(`fade=t=in:st=0:d=${n3(fadeIn)}:alpha=1`);
      if ((c.fadeOut ?? 0) > 0) chain.push(`fade=t=out:st=${n3(Math.max(0, c.duration - c.fadeOut))}:d=${n3(c.fadeOut)}:alpha=1`);
      chain.push(`setpts=PTS+${n3(c.start)}/TB`);
      filters.push(`[${idx}:v]${chain.join(',')}[${v}]`);
      const o = `o${i}`;
      filters.push(`[${last}][${v}]overlay=eof_action=pass:enable='between(t,${n3(c.start)},${n3(end)})'[${o}]`);
      last = o;
    }

    const audible = c.mediaType === 'audio' || (c.mediaType === 'video' && (await hasAudio(file)));
    if (audible && !track.muted && c.volume > 0) {
      const a = `a${i}`;
      const vol = n3(c.volume * (track.volume ?? 1));
      const chain = [`atrim=start=${n3(c.in)}:duration=${n3(srcDur)}`, 'asetpts=PTS-STARTPTS'];
      if (speed !== 1) chain.push(atempoChain(speed));
      chain.push(`volume=${vol}`);
      if ((c.fadeIn ?? 0) > 0) chain.push(`afade=t=in:st=0:d=${n3(c.fadeIn)}`);
      if ((c.fadeOut ?? 0) > 0) chain.push(`afade=t=out:st=${n3(Math.max(0, c.duration - c.fadeOut))}:d=${n3(c.fadeOut)}`);
      const ms = Math.round(c.start * 1000);
      chain.push(`adelay=${ms}|${ms}`, 'aformat=sample_rates=48000:channel_layouts=stereo');
      filters.push(`[${idx}:a]${chain.join(',')}[${a}]`);
      audioLabels.push(a);
    }
  }

  filters.push(`[${last}]trim=duration=${n3(total)},format=yuv420p[vout]`);
  if (audioLabels.length) {
    filters.push(`${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${n3(total)}[aout]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n3(total)}[aout]`);
  }

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(n3(total)), outFile);
  return { args, total };
}

export async function startExport(opts: ExportOptions) {
  const project = await getProject(opts.projectId);
  if (!project) throw Object.assign(new Error('projeto não encontrado'), { status: 404 });
  const timeline = project.timelines[opts.timelineId ?? project.activeTimelineId];
  if (!timeline || !Object.keys(timeline.clips).length) throw Object.assign(new Error('A linha do tempo está vazia.'), { status: 400 });

  const [aw, ah] = project.projectSettings.aspectRatio.split(':').map(Number);
  const H = opts.height ?? 1080;
  const W = opts.width ?? Math.round(((H * (aw || 16)) / (ah || 9)) / 2) * 2;
  const fps = opts.fps ?? 30;

  const job = createJob('export', project.projectId, timeline.id);
  const name = `${uid()}.mp4`;
  const outFile = mediaPath(project.projectId, 'exports', name);
  fs.mkdirSync(mediaPath(project.projectId, 'exports'), { recursive: true });

  (async () => {
    try {
      const { args, total } = await buildExportArgs(project, timeline, outFile, W, H, fps);
      job.status = 'processing';
      job.message = 'Renderizando…';
      emitJob(job);
      const res = await run('ffmpeg', args, (line) => {
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
        if (!m) return;
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        const p = Math.min(99, Math.round((t / total) * 100));
        if (p > job.progress) {
          job.progress = p;
          emitJob(job);
        }
      });
      if (res.code !== 0) throw new Error(res.stderr.split('\n').slice(-6).join('\n'));
      job.status = 'completed';
      job.progress = 100;
      let exportUrl = `/media/${project.projectId}/exports/${name}`;
      try {
        const r2Key = buildR2Key(project.projectId, 'exports', name);
        const buf = await fs.promises.readFile(outFile);
        const r2 = await uploadBufferToR2(r2Key, buf, 'video/mp4');
        if (r2?.url) exportUrl = r2.url;
      } catch (r2Err) {
        console.warn('[export] Fallback para mídia local:', r2Err);
      }
      job.outputs = [{ url: exportUrl, type: 'video', width: W, height: H, duration: total }];
      emitJob(job);
    } catch (err) {
      job.status = 'failed';
      job.error = String((err as Error)?.message ?? err).slice(-800);
      emitJob(job);
    }
  })();
  return job;
}

export type { Clip };
