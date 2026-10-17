import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Trash2, Volume2, VolumeX } from 'lucide-react';
import { timelineDuration } from '../../../shared/project';
import type { Clip, Timeline as TL } from '../../../shared/types';
import { useProject } from '../../store/project';
import { addClipFromNode, clipsOn, deleteClips, finishDrag, patchTrack, removeTrack, setClipGeometry, splitClip } from '../../lib/timelineOps';
import { useEditor, fmtTime } from './editorStore';

const LABEL_W = 132;

type Drag =
  | { kind: 'move'; id: string; sx: number; sy: number; start0: number; track0: string; snap: ReturnType<ReturnType<typeof useProject.getState>['snapshot']>; moved: boolean }
  | { kind: 'trim-l' | 'trim-r'; id: string; sx: number; start0: number; dur0: number; in0: number; snap: ReturnType<ReturnType<typeof useProject.getState>['snapshot']> }
  | { kind: 'scrub' };

export function Timeline({ timeline }: { timeline: TL }) {
  const pps = useEditor((s) => s.pps);
  const time = useEditor((s) => s.time);
  const tool = useEditor((s) => s.tool);
  const selected = useEditor((s) => s.selectedClip);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const total = timelineDuration(timeline);
  const width = Math.max(total + 20, 60) * pps;

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - LABEL_W + el.scrollLeft) / pps);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const tl = useProject.getState().project?.timelines[useProject.getState().project!.activeTimelineId];
      if (!tl) return;
      if (d.kind === 'scrub') {
        useEditor.getState().setTime(timeAt(e.clientX));
        return;
      }
      const c = tl.clips[d.id];
      if (!c) return;
      const dt = (e.clientX - d.sx) / pps;
      if (d.kind === 'move') {
        if (!d.moved && Math.abs(e.clientX - d.sx) < 3 && Math.abs(e.clientY - d.sy) < 3) return;
        d.moved = true;
        // vertical: hop to the track under the pointer when the media kind fits
        const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-track-id]') as HTMLElement | null;
        let trackId = c.trackId;
        const target = row ? tl.tracks.find((t) => t.id === row.dataset.trackId) : undefined;
        if (target && (c.mediaType === 'audio' ? target.type === 'audio' : target.type !== 'audio') && !(c.mediaType === 'text' && target.type === 'main')) trackId = target.id;
        let start = Math.max(0, d.start0 + dt);
        // snap to neighbours and playhead
        const edges = [useEditor.getState().time, ...Object.values(tl.clips).filter((x) => x.id !== c.id).flatMap((x) => [x.start, x.start + x.duration])];
        for (const s of edges) {
          if (Math.abs(start - s) * pps < 8) start = s;
          else if (Math.abs(start + c.duration - s) * pps < 8) start = s - c.duration;
        }
        setClipGeometry(c.id, { start, trackId });
      } else if (d.kind === 'trim-r') {
        const maxDur = c.mediaType === 'video' || c.mediaType === 'audio' ? ((c.sourceDuration ?? Infinity) - c.in) / c.speed : 600;
        setClipGeometry(c.id, { duration: Math.max(0.2, Math.min(maxDur, d.dur0 + dt)) });
      } else if (d.kind === 'trim-l') {
        const media = c.mediaType === 'video' || c.mediaType === 'audio';
        const minDt = media ? -d.in0 / c.speed : -d.start0;
        const delta = Math.max(minDt, Math.min(d.dur0 - 0.2, dt));
        setClipGeometry(c.id, { start: Math.max(0, d.start0 + delta), duration: d.dur0 - delta, in: media ? d.in0 + delta * c.speed : 0 });
      }
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.kind === 'scrub') return;
      if (d.kind === 'move' && !d.moved) return;
      if (d.snap) useProject.getState().pushSnapshot(d.snap);
      finishDrag(d.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [pps]);

  // keep the playhead in view while playing
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !useEditor.getState().playing) return;
    const x = time * pps;
    if (x > el.scrollLeft + el.clientWidth - LABEL_W - 40) el.scrollLeft = x - 80;
  }, [time, pps]);

  const onClipDown = (e: React.PointerEvent, c: Clip, kind: 'move' | 'trim-l' | 'trim-r') => {
    e.stopPropagation();
    const ed = useEditor.getState();
    if (ed.tool === 'razor' && kind === 'move') {
      const id = splitClip(c.id, timeAt(e.clientX));
      if (id) ed.selectClip(id);
      return;
    }
    ed.selectClip(c.id);
    const snap = useProject.getState().snapshot();
    drag.current = kind === 'move' ? { kind, id: c.id, sx: e.clientX, sy: e.clientY, start0: c.start, track0: c.trackId, snap, moved: false } : { kind, id: c.id, sx: e.clientX, start0: c.start, dur0: c.duration, in0: c.in, snap };
  };

  const ticks: number[] = [];
  const step = pps >= 120 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10;
  for (let s = 0; s * pps <= width; s += step) ticks.push(s);

  return (
    <div className="tl-scroll" ref={scrollRef}>
      <div className="tl-inner" style={{ width: width + LABEL_W }}>
        <div className="tl-ruler">
          <div className="tl-label tl-sticky">Régua</div>
          <div
            className="tl-ruler-lane"
            onPointerDown={(e) => {
              useEditor.getState().setPlaying(false);
              useEditor.getState().setTime(timeAt(e.clientX));
              drag.current = { kind: 'scrub' };
            }}
          >
            {ticks.map((s) => (
              <span key={s} className="tick" style={{ left: s * pps }}>
                {fmtTime(s)}
              </span>
            ))}
          </div>
        </div>

        {timeline.tracks.map((track) => (
          <div key={track.id} className={`tl-track tl-${track.type} ${dropTrack === track.id ? 'drop' : ''}`} data-track-id={track.id}>
            <div className="tl-label tl-sticky">
              <span className="grow">{track.name ?? (track.type === 'main' ? 'Principal' : track.type === 'audio' ? 'Áudio' : 'Vídeo')}</span>
              {track.type !== 'audio' && (
                <button className="icon-btn" title={track.visible ? 'Ocultar trilha' : 'Mostrar trilha'} onClick={() => patchTrack(track.id, { visible: !track.visible })}>
                  {track.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                </button>
              )}
              <button className="icon-btn" title={track.muted ? 'Ativar som' : 'Silenciar'} onClick={() => patchTrack(track.id, { muted: !track.muted })}>
                {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
              {track.type !== 'main' && (
                <button className="icon-btn" title="Remover trilha" onClick={() => removeTrack(track.id)}>
                  <Trash2 size={11} />
                </button>
              )}
              <input type="range" min={0} max={1} step={0.05} value={track.volume} title={`Volume ${Math.round(track.volume * 100)}%`} onChange={(e) => patchTrack(track.id, { volume: Number(e.target.value) })} className="tl-vol" />
            </div>
            <div
              className={`tl-lane ${tool === 'razor' ? 'razor' : ''}`}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                useEditor.getState().selectClip(null);
                useEditor.getState().setTime(timeAt(e.clientX));
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-claquete-node')) {
                  e.preventDefault();
                  setDropTrack(track.id);
                }
              }}
              onDragLeave={() => setDropTrack(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropTrack(null);
                const nodeId = e.dataTransfer.getData('application/x-claquete-node');
                if (nodeId) {
                  const id = addClipFromNode(nodeId, timeAt(e.clientX), track.id);
                  if (id) useEditor.getState().selectClip(id);
                }
              }}
            >
              {clipsOn(timeline, track.id).map((c) => (
                <div
                  key={c.id}
                  className={`tl-clip tl-clip-${c.mediaType} ${selected === c.id ? 'selected' : ''}`}
                  style={{ left: c.start * pps, width: Math.max(4, c.duration * pps), backgroundImage: c.mediaType === 'image' ? `url("${c.url}")` : undefined }}
                  onPointerDown={(e) => onClipDown(e, c, 'move')}
                  title={c.label}
                >
                  {c.mediaType === 'video' && c.url && <video src={`${c.url}#t=${c.in + 0.1}`} muted preload="metadata" className="tl-thumb" />}
                  {c.transitionIn && c.transitionIn.type !== 'none' && <span className="tl-trans" style={{ width: c.transitionIn.duration * pps }} />}
                  <span className="tl-clip-label">
                    {c.mediaType === 'text' ? `T · ${c.text?.content}` : c.label}
                    {c.speed !== 1 ? ` · ${c.speed}x` : ''}
                  </span>
                  <span className="tl-trim l" onPointerDown={(e) => onClipDown(e, c, 'trim-l')} />
                  <span className="tl-trim r" onPointerDown={(e) => onClipDown(e, c, 'trim-r')} />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="tl-playhead" style={{ left: LABEL_W + time * pps }}>
          <span>{fmtTime(time, true)}</span>
        </div>
      </div>
    </div>
  );
}

export function useTimelineKeys(timeline: TL | undefined) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const ed = useEditor.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        ed.setPlaying(!ed.playing);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && ed.selectedClip) {
        deleteClips([ed.selectedClip]);
        ed.selectClip(null);
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && ed.selectedClip) {
        const id = splitClip(ed.selectedClip, ed.time);
        if (id) ed.selectClip(id);
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
        ed.setTool(ed.tool === 'razor' ? 'select' : 'razor');
      } else if (e.key === 'ArrowLeft') {
        ed.setTime(ed.time - (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === 'ArrowRight') {
        ed.setTime(ed.time + (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === 'Home') {
        ed.setTime(0);
      } else if (e.key === 'End' && timeline) {
        ed.setTime(timelineDuration(timeline));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? useProject.getState().redo() : useProject.getState().undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timeline]);
}
