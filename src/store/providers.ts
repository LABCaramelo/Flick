import { create } from 'zustand';
import { api, type ProvidersInfo } from '../lib/api';
import { useProject } from './project';

interface ProvidersState {
  info: ProvidersInfo | null;
  refresh(): Promise<void>;
}

export const useProviders = create<ProvidersState>((set) => ({
  info: null,
  refresh: async () => {
    try {
      const info = await api.providers();
      set({ info });
      const models = await api.models();
      useProject.getState().setModels(models);
    } catch {
      /* server offline; keep last state */
    }
  },
}));
