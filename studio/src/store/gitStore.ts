// =============================================================================
// gitStore — Git 工作区管控状态（网关 /api/git*）
// 数据源：网关经 @yxspec/tool-guard 白名单的只读 git 采集 + .dsh/git-audit/ 留痕。
// 红线：前端不执行 git —— 本 store 只做状态镜像 + 刷新 + 回滚留档（不执行）。
// 回滚成功后 push toast（调用方 UI 再补一句「不自动执行」）。
// =============================================================================

import { create } from 'zustand';
import * as ipc from '../utils/ipc';
import type { GitStatus, GitStageTrace } from '../utils/ipc';
import { useToastStore } from './toastStore';

interface GitStore {
  /** GET /api/git/status 快照；未加载/失败为 null */
  status: GitStatus | null;
  /** status 是否在加载中 */
  loading: boolean;
  /** status 加载失败（网关未起）时置 true */
  loadError: boolean;
  refreshStatus: () => Promise<void>;
  /** 当前已查询的阶段轨迹；未查询/失败为 null */
  commits: GitStageTrace[] | null;
  /** commits 是否在加载中 */
  commitsLoading: boolean;
  /** commits 加载失败（网关未起/路由未就绪）——失败与「该阶段真无留痕」必须区分，否则 UI 会误报空态 */
  commitsError: boolean;
  loadCommits: (stage: string) => Promise<void>;
  /** 记录回滚留档（POST /api/git/rollback）；成功 push toast，失败抛错由调用方处理 */
  rollback: (params: ipc.GitRollbackParams) => Promise<boolean>;
}

export const useGitStore = create<GitStore>((set) => ({
  status: null,
  loading: false,
  loadError: false,

  refreshStatus: async () => {
    set({ loading: true, loadError: false });
    try {
      const data = await ipc.getGitStatus();
      if (data) {
        set({ status: data, loading: false, loadError: false });
      } else {
        set({ status: null, loading: false, loadError: true });
      }
    } catch {
      set({ status: null, loading: false, loadError: true });
    }
  },

  commits: null,
  commitsLoading: false,
  commitsError: false,

  loadCommits: async (stage) => {
    if (!stage) {
      set({ commits: null, commitsLoading: false, commitsError: false });
      return;
    }
    set({ commitsLoading: true, commitsError: false });
    try {
      const data = await ipc.getGitCommits(stage);
      if (data) {
        set({ commits: data, commitsLoading: false, commitsError: false });
      } else {
        // 请求完成但拿不到有效数据（网关失败/null 响应）→ 与「真无留痕」区分，标记错误供 UI 给重试
        set({ commits: [], commitsLoading: false, commitsError: true });
      }
    } catch {
      set({ commits: [], commitsLoading: false, commitsError: true });
    }
  },

  rollback: async (params) => {
    try {
      const res = await ipc.recordGitRollback(params);
      // 只在后端明确 ok（含未带 ok 字段的宽松响应）时推成功；
      // ok:false（HTTP 200 但未留档）绝不能配「已记录」成功 toast，且不抛错——
      // 保持确认面板原地可重试，让用户看到的是错误提示而不是"成功却不动"。
      if (res?.ok !== false) {
        useToastStore.getState().push('success', '回滚指令已记录（不自动执行）');
        return true;
      }
      useToastStore.getState().push('error', '回滚留档未写入（网关未确认），请重试');
      return false;
    } catch (e: any) {
      useToastStore.getState().push('error', `回滚留档失败：${e?.message || e}`);
      throw e;
    }
  },
}));
