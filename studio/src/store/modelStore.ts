// =============================================================================
// modelStore — 模型管理状态（网关 /api/models*）
// 模型目录的真相源在网关 model-config.json；本 store 只是前端镜像 + 操作。
// =============================================================================

import { create } from 'zustand';
import * as ipc from '../utils/ipc';
import type { ModelEntry } from '../utils/ipc';

interface ModelStore {
  models: ModelEntry[];
  defaultModelId: string | null;
  current: { provider: string; model: string; maxTokens: number } | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  add: (entry: ModelEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
  apply: () => Promise<void>;
}

export const useModelStore = create<ModelStore>((set, get) => ({
  models: [],
  defaultModelId: null,
  current: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await ipc.getModels();
      set({
        models: data.models,
        defaultModelId: data.defaultModelId,
        current: data.current,
        loading: false,
      });
    } catch (e: any) {
      set({ error: String(e?.message || e), loading: false });
    }
  },

  setDefault: async (id) => {
    try {
      const data = await ipc.setDefaultModel(id);
      set({ defaultModelId: data.defaultModelId });
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      throw e;
    }
  },

  add: async (entry) => {
    try {
      const data = await ipc.addModel(entry);
      set({ models: data.models, defaultModelId: data.defaultModelId });
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      throw e;
    }
  },

  remove: async (id) => {
    try {
      const data = await ipc.removeModel(id);
      set({ models: data.models, defaultModelId: data.defaultModelId });
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      throw e;
    }
  },

  apply: async () => {
    try {
      await ipc.applyModel();
      set({ current: null });
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      throw e;
    }
  },
}));
