// =============================================================================
// Project Store - 当前打开的项目信息
// =============================================================================

import { create } from 'zustand';
import type { ProjectInfo } from '../data/types';
import * as ipc from '../utils/ipc';

interface ProjectStore {
  current: ProjectInfo | null;
  loading: boolean;
  error: string | null;
  load: (path: string) => Promise<void>;
  close: () => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  current: null,
  loading: false,
  error: null,
  load: async (path: string) => {
    set({ loading: true, error: null });
    try {
      const info = await ipc.openProject(path);
      set({ current: info, loading: false });
    } catch (e: any) {
      set({ error: String(e?.message || e), loading: false });
    }
  },
  close: () => set({ current: null, error: null }),
}));