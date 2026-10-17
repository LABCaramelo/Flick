import { create } from 'zustand';

interface EditorState {
  time: number;
  playing: boolean;
  selectedClip: string | null;
  pps: number;
  tool: 'select' | 'razor';
  exportJobId: string | null;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  selectClip(id: string | null): void;
  setPps(v: number): void;
  setTool(t: 'select' | 'razor'): void;
  setExportJob(id: string | null): void;
}

export const useEditor = create<EditorState>((set) => ({
  time: 0,
  playing: false,
  selectedClip: null,
  pps: 60,
  tool: 'select',
  exportJobId: null,
  setTime: (time) => set({ time: Math.max(0, time) }),
  setPlaying: (playing) => set({ playing }),
  selectClip: (selectedClip) => set({ selectedClip }),
  setPps: (pps) => set({ pps: Math.max(8, Math.min(400, pps)) }),
  setTool: (tool) => set({ tool }),
  setExportJob: (exportJobId) => set({ exportJobId }),
}));

export function fmtTime(s: number, frames = false, fps = 30) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return frames ? `${base}:${String(Math.floor((s % 1) * fps)).padStart(2, '0')}` : base;
}
