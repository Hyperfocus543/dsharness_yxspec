// =============================================================================
// Review Store - 审查报告
// =============================================================================

import { create } from 'zustand';
import type { ReviewEntry } from '../data/types';
import * as ipc from '../utils/ipc';

interface ReviewStore {
  entries: ReviewEntry[];
  loading: boolean;
  load: (projectPath: string) => Promise<void>;
  byStage: (stage: string) => ReviewEntry | undefined;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  entries: [],
  loading: false,
  load: async (projectPath: string) => {
    set({ loading: true });
    try {
      const entries = await ipc.listReviews(projectPath);
      set({ entries, loading: false });
    } catch (e) {
      console.error('load reviews failed:', e);
      set({ loading: false });
    }
  },
  byStage: (stage: string) => get().entries.find((e) => e.stage === stage),
}));

export function countByVerdict(entries: ReviewEntry[]): Record<string, number> {
  const counts = { approved: 0, conditional: 0, rejected: 0, none: 0 };
  for (const e of entries) {
    if (e.review) {
      counts[e.review.verdict]++;
    } else {
      counts.none++;
    }
  }
  return counts;
}