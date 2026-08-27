// =============================================================================
// featureStore — 功能商店状态（网关 /api/features*）
// 网关真相源：features.mjs 注册表 + project/config/features.yaml + custom-features.yaml；
// 本 store 只是前端镜像 + 开关操作 + 自定义功能增删。
// =============================================================================

import { create } from 'zustand';
import * as ipc from '../utils/ipc';
import type { CustomFeatureFields, FeatureItem } from '../utils/ipc';

interface FeatureStore {
  features: FeatureItem[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
  add: (fields: CustomFeatureFields) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useFeatureStore = create<FeatureStore>((set) => ({
  features: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await ipc.getFeatures();
      set({ features: data.features, loading: false });
    } catch (e: any) {
      set({ error: String(e?.message || e), loading: false });
    }
  },

  toggle: async (id, enabled) => {
    try {
      await ipc.setFeature(id, enabled);
      // 本地镜像更新（避免整表重拉）
      set((s) => ({
        features: s.features.map((f) =>
          f.id === id ? { ...f, enabled } : f,
        ),
      }));
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      throw e;
    }
  },

  add: async (fields) => {
    try {
      await ipc.addCustomFeature(fields);
      // 新增后整表重拉：后端 addCustomFeature 只返回定义字段（无 enabled/always/loaded），
      // 重拉可拿到网关计算的完整运行时状态，保证新卡片开关态正确。
      const res = await ipc.getFeatures();
      set({ features: res.features });
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      throw e;
    }
  },

  remove: async (id) => {
    try {
      await ipc.removeCustomFeature(id);
      set((s) => ({ features: s.features.filter((f) => f.id !== id) }));
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      throw e;
    }
  },
}));
