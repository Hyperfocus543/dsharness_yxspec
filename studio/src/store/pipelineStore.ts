// =============================================================================
// Pipeline Store - 17 模块编码状态
// =============================================================================

import { create } from 'zustand';
import type { PipelineState } from '../data/types';
import * as ipc from '../utils/ipc';

interface PipelineStore {
  state: PipelineState | null;
  loading: boolean;
  load: (projectPath: string) => Promise<void>;
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  state: null,
  loading: false,
  load: async (projectPath: string) => {
    set({ loading: true });
    try {
      const state = await ipc.readPipelineState(projectPath);
      set({ state, loading: false });
    } catch (e) {
      console.error('load pipeline failed:', e);
      set({ loading: false });
    }
  },
}));

/** 按模块状态统计 */
export function pipelineStats(state: PipelineState | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!state) return counts;
  for (const m of Object.values(state.modules)) {
    counts[m.status] = (counts[m.status] || 0) + 1;
  }
  return counts;
}