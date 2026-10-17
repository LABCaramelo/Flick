import { nodeTitle, uid } from '../../shared/project';
import type { Clip, MediaNode, Timeline, Track, TrackType, TransitionType } from '../../shared/types';
import { getProject, useProject } from '../store/project';

const st = () => useProject.getState();

export function activeTimeline(): Timeline | undefined {
  const p = getProject();
  return p ? p.timelines[p.activeTimelineId] : undefined;
}

function mutate(fn: (t: Timeline) => void, record = true) {
  st().update(
    (d) => {
      fn(d.timelines[d.activeTimelineId] as Timeline);
    },
    { record },
  );
}

export const clipsOn = (t: Timeline, trackId: string) =>
  Object.values(t.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);

export const trackEnd = (t: Timeline, trackId: string) => clipsOn(t, trackId).reduce((m, c) => Math.max(m, c.start + c.duration), 0);

/** Main track with the magnet on stays gap-free (ripple). */
export function packTrack(t: Timeline, trackId: string) {
  const track = t.tracks.find((x) => x.id === trackId);
  if (!track || track.type !== 'main' || !t.magnetEnabled) return;
  let cursor = 0;
  for (const c of clipsOn(t, trackId)) {
    c.start = Math.round(cursor * 1000) / 1000;
    cursor += c.duration;
  }
}

export function trackForMedia(t: Timeline, kind: Clip['mediaType'], preferred?: string): Track {
  const pref = t.tracks.find((x) => x.id === preferred);
  const fits = (tr: Track) => (kind === 'audio' ? tr.type === 'audio' : tr.type !== 'audio');
  if (pref && fits(pref)) return pref;
  return t.tracks.find((tr) => (kind === 'audio' ? tr.type === 'audio' : tr.type === 'main'))!;
}

export function addClipFromNode(nodeId: string, at?: number, trackId?: string): string | null {
  const p = getProject();
  const n = p?.nodes[nodeId] as MediaNode | undefined;
  if (!p || !n?.data.url || !(n.type === 'image' || n.type === 'video' || n.type === 'audio')) return null;
  const t = p.timelines[p.activeTimelineId];
  if (n.type === 'audio' && !t.tracks.some((tr) => tr.type === 'audio')) addTrack('audio');
  const id = uid();
  mutate((tl) => {
    const track = trackForMedia(tl, n.type, trackId);
    const dur = n.type === 'image' ? 3 : n.data.duration ?? 5;
    let start = at ?? trackEnd(tl, track.id);
    if (track.type === 'main' && tl.magnetEnabled && at !== undefined) {
      // insert between clips at the nearest boundary
      const list = clipsOn(tl, track.id);
      const idx = list.findIndex((c) => at < c.start + c.duration / 2);
      start = idx < 0 ? trackEnd(tl, track.id) : list[idx].start - 0.0001;
    }
    tl.clips[id] = {
      id,
      trackId: track.id,
      nodeId,
      mediaType: n.type,
      url: n.data.url,
      label: nodeTitle(n),
      start: Math.max(0, start),
      duration: dur,
      in: 0,
      sourceDuration: n.type === 'image' ? undefined : n.data.duration,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
    };
    packTrack(tl, track.id);
  });
  return id;
}

export function addTextClip(at: number, content = 'Título'): string {
  const id = uid();
  mutate((tl) => {
    let track = tl.tracks.find((tr) => tr.type === 'video');
    if (!track) {
      track = { id: uid(), type: 'video', name: 'Sobreposição', visible: true, volume: 1, muted: false };
      tl.tracks.splice(1, 0, track);
    }
    tl.clips[id] = { id, trackId: track.id, mediaType: 'text', label: content, start: at, duration: 3, in: 0, speed: 1, volume: 0, fadeIn: 0.3, fadeOut: 0.3, text: { content, size: 56, color: '#ffffff', y: 0.82 } };
  });
  return id;
}

export function addTrack(type: TrackType) {
  mutate((tl) => {
    const n = tl.tracks.filter((t) => t.type === type).length + 1;
    const track: Track = { id: uid(), type, name: type === 'audio' ? `Áudio ${n}` : `Vídeo ${n}`, visible: true, volume: 1, muted: false };
    if (type === 'audio') tl.tracks.push(track);
    else tl.tracks.splice(1, 0, track);
  });
}

export function removeTrack(trackId: string) {
  mutate((tl) => {
    const t = tl.tracks.find((x) => x.id === trackId);
    if (!t || t.type === 'main') return;
    tl.tracks = tl.tracks.filter((x) => x.id !== trackId);
    for (const c of Object.values(tl.clips)) if (c.trackId === trackId) delete tl.clips[c.id];
  });
}

export function patchTrack(trackId: string, patch: Partial<Track>) {
  mutate((tl) => {
    const t = tl.tracks.find((x) => x.id === trackId);
    if (t) Object.assign(t, patch);
  });
}

export function patchClip(id: string, patch: Partial<Clip>, record = true) {
  mutate((tl) => {
    const c = tl.clips[id];
    if (!c) return;
    Object.assign(c, patch);
    if (patch.speed !== undefined && c.mediaType !== 'image' && c.mediaType !== 'text' && c.sourceDuration) {
      c.duration = Math.min(c.duration, (c.sourceDuration - c.in) / c.speed);
    }
    packTrack(tl, c.trackId);
  }, record);
}

export function deleteClips(ids: string[]) {
  mutate((tl) => {
    const tracks = new Set<string>();
    for (const id of ids) {
      const c = tl.clips[id];
      if (!c) continue;
      tracks.add(c.trackId);
      delete tl.clips[id];
    }
    tracks.forEach((t) => packTrack(tl, t));
  });
}

export function splitClip(id: string, at: number): string | null {
  const t = activeTimeline();
  const c = t?.clips[id];
  if (!c || at <= c.start + 0.05 || at >= c.start + c.duration - 0.05) return null;
  const newId = uid();
  mutate((tl) => {
    const a = tl.clips[id];
    const leftDur = at - a.start;
    const b: Clip = { ...(JSON.parse(JSON.stringify(a)) as Clip), id: newId, start: at, duration: a.duration - leftDur, in: a.mediaType === 'image' || a.mediaType === 'text' ? 0 : a.in + leftDur * a.speed, fadeIn: 0, transitionIn: undefined };
    a.duration = leftDur;
    a.fadeOut = 0;
    tl.clips[newId] = b;
  });
  return newId;
}

export function setTransition(id: string, type: TransitionType, duration = 0.6) {
  patchClip(id, { transitionIn: type === 'none' ? undefined : { type, duration } });
}

/** Move/trim helpers used by drag interactions (no history; caller records once). */
export function setClipGeometry(id: string, g: { start?: number; duration?: number; in?: number; trackId?: string }) {
  mutate((tl) => {
    const c = tl.clips[id];
    if (!c) return;
    Object.assign(c, g);
  }, false);
}

export function finishDrag(id: string) {
  mutate((tl) => {
    const c = tl.clips[id];
    if (c) packTrack(tl, c.trackId);
    for (const tr of tl.tracks) packTrack(tl, tr.id);
  }, false);
}

export function clipAt(t: Timeline, trackId: string, time: number): Clip | undefined {
  return Object.values(t.clips).find((c) => c.trackId === trackId && time >= c.start && time < c.start + c.duration);
}
