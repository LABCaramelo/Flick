import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface UiState {
  toasts: Toast[];
  settingsOpen: boolean;
  chatCollapsed: boolean;
  fullscreenNodeId: string | null;
  pushToast(text: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: number): void;
  setSettingsOpen(v: boolean): void;
  setChatCollapsed(v: boolean): void;
  setFullscreenNode(id: string | null): void;
}

let seq = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  settingsOpen: false,
  chatCollapsed: false,
  fullscreenNodeId: null,
  pushToast: (text, kind = 'info', action) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind, action }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setChatCollapsed: (v) => set({ chatCollapsed: v }),
  setFullscreenNode: (id) => set({ fullscreenNodeId: id }),
}));

export const toast = (text: string, kind?: Toast['kind'], action?: Toast['action']) => useUi.getState().pushToast(text, kind, action);
