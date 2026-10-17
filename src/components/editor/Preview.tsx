import { useEffect, useMemo, useRef } from 'react';
import { timelineDuration } from '../../../shared/project';
import type { Clip, Timeline } from '../../../shared/types';
import { useEditor } from './editorStore';

function alphaAt(c: Clip, t: number) {
  const local = t - c.start;
  const fin = Math.max(c.fadeIn ?? 0, c.transitionIn && c.transitionIn.type !== 'none' ? c.transitionIn.duration : 0);
  let a = 1;
  if (fin > 0) a = Math.min(a, local / fin);
  if ((c.fadeOut ?? 0) > 0) a = Math.min(a, (c.duration - local) / c.fadeOut);
  return Math.max(0, Math.min(1, a));
}

/** Plays the timeline by driving one media element per clip. */
export function Preview({ timeline, aspect }: { timeline: Timeline; aspect: string }) {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const els = useRef(new Map<string, HTMLMediaElement>());
  const raf = useRef<number | undefined>(undefined);
  const last = useRef<number>(0);
  const total = useMemo(() => timelineDuration(timeline), [timeline]);
  const [aw, ah] = aspect.split(':').map(Number);

  const trackIndex = useMemo(() => new Map(timeline.tracks.map((t, i) => [t.id, i])), [timeline.tracks]);
  const trackById = useMemo(() => new Map(timeline.tracks.map((t) => [t.id, t])), [timeline.tracks]);
  const clips = useMemo(() => Object.values(timeline.clips).sort((a, b) => trackIndex.get(a.trackId)! - trackIndex.get(b.trackId)!), [timeline.clips, trackIndex]);

  // clock
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      const st = useEditor.getState();
      const next = st.time + dt;
      if (next >= total) {
        st.setTime(total);
        st.setPlaying(false);
        return;
      }
      st.setTime(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [playing, total]);

  // sync media elements to the clock
  useEffect(() => {
    for (const c of clips) {
      const el = els.current.get(c.id);
      if (!el) continue;
      const track = trackById.get(c.trackId);
      const active = time >= c.start && time < c.start + c.duration && track?.visible !== false;
      if (!active) {
        if (!el.paused) el.pause();
        continue;
      }
      const target = c.in + (time - c.start) * c.speed;
      el.playbackRate = c.speed;
      const vol = Math.max(0, Math.min(1, c.volume * (track?.volume ?? 1) * alphaAt(c, time)));
      el.volume = vol;
      el.muted = !!track?.muted || vol === 0;
      if (playing) {
        if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
        if (el.paused) el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
      }
    }
  }, [time, playing, clips, trackById]);

  useEffect(() => () => els.current.forEach((el) => el.pause()), []);

  const visible = clips.filter((c) => c.mediaType !== 'audio');
  const audio = clips.filter((c) => c.mediaType === 'audio');

  return (
    <div className="preview-frame" style={{ ['--ar' as string]: (aw || 16) / (ah || 9) }}>
      {visible.map((c) => {
        const track = trackById.get(c.trackId);
        const active = time >= c.start && time < c.start + c.duration && track?.visible !== false;
        const style: React.CSSProperties = { opacity: active ? alphaAt(c, time) : 0, zIndex: trackIndex.get(c.trackId) ?? 0, visibility: active ? 'visible' : 'hidden' };
        if (c.mediaType === 'text')
          return (
            <div key={c.id} className="preview-text" style={{ ...style, top: `${(c.text?.y ?? 0.85) * 100}%`, color: c.text?.color, fontSize: `${((c.text?.size ?? 48) / 720) * 100}cqh` }}>
              {c.text?.content}
            </div>
          );
        if (c.mediaType === 'image') return <img key={c.id} className="preview-layer" src={c.url} alt="" style={style} />;
        return (
          <video
            key={c.id}
            className="preview-layer"
            src={c.url}
            style={style}
            playsInline
            preload="auto"
            ref={(el) => {
              if (el) els.current.set(c.id, el);
              else els.current.delete(c.id);
            }}
          />
        );
      })}
      {audio.map((c) => (
        <audio
          key={c.id}
          src={c.url}
          preload="auto"
          ref={(el) => {
            if (el) els.current.set(c.id, el);
            else els.current.delete(c.id);
          }}
        />
      ))}
    </div>
  );
}
