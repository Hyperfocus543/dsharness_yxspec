// =============================================================================
// communityStore — 社区插件市场状态（网关 /api/community-plugins）
// 网关是真相源：GitHub search（topic:dsh-plugin）→ 6h 缓存 → 静态精选兜底。
// 本 store 只是前端镜像 + 加载；加载失败静默（不 toast、不抛错），
// 市场页降级为空态/静态提示。
// =============================================================================

import { create } from 'zustand';
import * as ipc from '../utils/ipc';
import type { CommunityPlugin } from '../utils/ipc';

interface CommunityStore {
  plugins: CommunityPlugin[];
  source: 'github' | 'cache' | 'static' | null;
  stale: boolean;
  fetchedAt: string | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useCommunityStore = create<CommunityStore>((set) => ({
  plugins: [],
  source: null,
  stale: false,
  fetchedAt: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true });
    try {
      const data = await ipc.fetchCommunityPlugins();
      if (!data || !Array.isArray(data.plugins)) {
        set({ loading: false, error: '网关未返回社区插件数据' });
        return;
      }
      set({
        plugins: data.plugins,
        source: data.source,
        stale: data.stale,
        fetchedAt: data.fetchedAt,
        loading: false,
        error: null,
      });
    } catch (e: any) {
      // 失败静默：市场页按空态渲染，不打扰用户
      set({ loading: false, error: String(e?.message || e), plugins: [] });
    }
  },
}));
