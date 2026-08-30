// =============================================================================
// gitStore — Git 工作区管控状态（网关 /api/git*）
// 数据源：网关经 @yxspec/tool-guard 白名单的只读 git 采集 + .dsh/git-audit/ 留痕。
// 红线：前端不执行 git —— 本 store 只做状态镜像 + 刷新 + 回滚留档（不执行）。
// 多工作区：workspaces 为网关注册表（auto 自动透传默认根 / manual 手动登记），
// 活动工作区 activeWorkspace 决定 status/commits 按哪个 root 拉取。
// 写操作（回滚留档/operate/workspaces 增删）失败抛错，由调用方 UI 处理 toast。
// =============================================================================

import { create } from 'zustand';
import * as ipc from '../utils/ipc';
import type { GitAuditEntry, GitStatus, GitStageTrace, GitWorkspace } from '../utils/ipc';
import { useToastStore } from './toastStore';

/** clone/init 完成后要激活的工作区：优先精确匹配新 root，其次服务端 activeId（若有），
 *  兜底列表首项（至少切离旧 root，让克隆/新建的仓库立即可见）。 */
export function pickWorkspaceToActivate(
  list: ipc.GitWorkspaceList,
  targetRoot: string | null,
): ipc.GitWorkspace | null {
  if (targetRoot) {
    const byRoot = list.workspaces.find((w) => w.root === targetRoot);
    if (byRoot) return byRoot;
  }
  const byActive =
    list.activeId != null ? list.workspaces.find((w) => w.id === list.activeId) : undefined;
  return byActive ?? list.workspaces[0] ?? null;
}

interface GitStore {
  /** GET /api/git/status 快照；未加载/失败为 null */
  status: GitStatus | null;
  /** status 是否在加载中 */
  loading: boolean;
  /** status 加载失败（网关未起）时置 true */
  loadError: boolean;
  refreshStatus: () => Promise<void>;
  /** GET /api/git/workspaces 注册表快照；初始 null = 未加载（null ≠ 空数组：首帧不误闪「暂无工作区」） */
  workspaces: GitWorkspace[] | null;
  /** 当前活动工作区；缺省回落 defaultRoot（后端 activeId → 首项 → null） */
  activeWorkspace: GitWorkspace | null;
  /** workspaces 是否在加载中 */
  workspaceLoading: boolean;
  /** workspaces 加载失败（网关未响应）时置错误文案 */
  workspaceError: string | null;
  /** git 写操作（/api/git/operate）进行中（按钮 loading） */
  operating: boolean;
  refreshWorkspaces: () => Promise<void>;
  /** 切换活动工作区（PUT active → 本地更新 → 按新 root 重拉 status） */
  setActive: (id: string) => Promise<void>;
  /** 手动登记工作区根目录；失败抛错由调用方处理 */
  addWorkspace: (root: string) => Promise<void>;
  /** 移除工作区；若删的是 active，active 按后端 activeId 回落 */
  removeWorkspace: (id: string) => Promise<void>;
  /** 执行 git 写操作（clone/fetch/pull/push/checkout/branch/init）；失败抛错由调用方处理 */
  gitOperate: (opts: ipc.GitOperateParams) => Promise<ipc.GitOperateResult | null>;
  /** clone/init 完成后激活新仓库（切换 active + 按新 root 重拉 status） */
  activateAfterAdd: (result: ipc.GitOperateResult | null) => Promise<void>;
  /** 当前已查询的阶段轨迹；未查询/失败为 null */
  commits: GitStageTrace[] | null;
  /** commits 是否在加载中 */
  commitsLoading: boolean;
  /** commits 加载失败（网关未起/路由未就绪）——失败与「该阶段真无留痕」必须区分，否则 UI 会误报空态 */
  commitsError: boolean;
  loadCommits: (stage: string) => Promise<void>;
  /** 记录回滚留档（POST /api/git/rollback）；成功 push toast，失败抛错由调用方处理 */
  rollback: (params: ipc.GitRollbackParams) => Promise<boolean>;
  /** git 写操作审计留痕（GET /api/git/audit；时间倒序）。初始 null = 未加载 */
  audit: GitAuditEntry[] | null;
  /** audit 是否在加载中 */
  auditLoading: boolean;
  /** audit 加载失败（老网关无端点/网关未起）时置 true */
  auditError: boolean;
  /** 拉取写操作审计留痕（写操作完成后联动刷新，让新留痕立即可见） */
  loadAudit: () => Promise<void>;
}

export const useGitStore = create<GitStore>((set, get) => ({
  status: null,
  loading: false,
  loadError: false,

  refreshStatus: async () => {
    set({ loading: true, loadError: false });
    try {
      // 多工作区：status 永远按当前活动工作区 root 拉取；缺省（无 root）由网关回退默认根。
      const data = await ipc.getGitStatus(get().activeWorkspace?.root);
      if (data) {
        set({ status: data, loading: false, loadError: false });
      } else {
        set({ status: null, loading: false, loadError: true });
      }
    } catch {
      set({ status: null, loading: false, loadError: true });
    }
  },

  // 初始 null = 未加载（refreshWorkspaces 成功才落数组；null 与「确认为空」区分，
  // 供卡片首帧不误闪「暂无工作区」空态——与 commits/audit 的 null 口径一致）
  workspaces: null,
  activeWorkspace: null,
  workspaceLoading: false,
  workspaceError: null,
  operating: false,

  refreshWorkspaces: async () => {
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const data = await ipc.fetchGitWorkspaces();
      if (!data) {
        // 网关未起/路由未就绪 → 降级为可感知的错误态，不误报「无工作区」
        set({ workspaceLoading: false, workspaceError: '网关未响应' });
        return;
      }
      const active =
        data.workspaces.find((w) => w.id === data.activeId) ??
        data.workspaces[0] ??
        null;
      set({
        workspaces: data.workspaces,
        activeWorkspace: active,
        workspaceLoading: false,
        workspaceError: null,
      });
    } catch {
      set({ workspaceLoading: false, workspaceError: '网关未响应' });
    }
  },

  setActive: async (id) => {
    // 复用 operating 锁：切换活动工作区也是写操作（PUT active），期间行内按钮
    // 「设为当前」/「移除」/添加表单提交键一并禁用 + 显示「执行中…」，防连点重复切换。
    set({ operating: true });
    try {
      const list = await ipc.setActiveGitWorkspace(id);
      const active = list.workspaces.find((w) => w.id === id) ?? list.workspaces[0] ?? null;
      set({ workspaces: list.workspaces, activeWorkspace: active });
      // 切到新 root 后立即按该 root 重拉 status（其他只读采集后续按需刷新）
      await get().refreshStatus();
    } finally {
      set({ operating: false });
    }
  },

  addWorkspace: async (root) => {
    // 本地路径登记同样占 operating 锁：提交键借此显示「执行中…」并禁用（与 clone/init 对齐），
    // 失败由 addGitWorkspace 抛错，调用方 UI 推 error toast；这里只做成功后同步列表。
    set({ operating: true });
    try {
      const list = await ipc.addGitWorkspace(root);
      set({ workspaces: list.workspaces });
    } finally {
      set({ operating: false });
    }
  },

  removeWorkspace: async (id) => {
    // 移除登记同样占 operating 锁：行内「移除」按钮在请求期间禁用，防连点重复移除。
    set({ operating: true });
    try {
      const list = await ipc.removeGitWorkspace(id);
      const active =
        list.workspaces.find((w) => w.id === list.activeId) ??
        list.workspaces[0] ??
        null;
      set({ workspaces: list.workspaces, activeWorkspace: active });
      // 若删的是活动工作区，active 已回落 → 让 status 跟着新 root 走
      await get().refreshStatus();
    } finally {
      set({ operating: false });
    }
  },

  gitOperate: async (opts) => {
    set({ operating: true });
    try {
      return await ipc.gitOperate(opts);
    } finally {
      set({ operating: false });
    }
  },

  /**
   * clone/init 完成后激活新仓库：网关只登记不动 activeId，这里同步本地注册表并
   * 切换 active → 按新 root 重拉 status（克隆完立刻能看到新仓库的脏文件/分支/HEAD）。
   * @param result gitOperate 的 clone/init 结果
   */
  activateAfterAdd: async (result: ipc.GitOperateResult | null) => {
    const dir = result?.cloneDir || result?.initDir || result?.root || null;
    if (!dir || result?.ok !== true) return;
    const list = await ipc.fetchGitWorkspaces();
    if (!list) return; // 网关未响应：保持现状，下次手动刷新
    const active = pickWorkspaceToActivate(list, dir);
    set({ workspaces: list.workspaces, activeWorkspace: active });
    await get().refreshStatus();
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
      // 多工作区：留痕按活动工作区 root 拉（缺省 activeWorkspace 为 null 时网关回退默认根）。
      const data = await ipc.getGitCommits(stage, get().activeWorkspace?.root);
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

  audit: null,
  auditLoading: false,
  auditError: false,

  loadAudit: async () => {
    // 静默刷新（写操作后联动/挂载拉取）：已有内容时保持展示，不闪骨架；
    // 网关瞬时失败不把已加载的留痕清空，仅标记 error（区块显示「加载失败 + 重试」）。
    set({ auditLoading: true, auditError: false });
    try {
      const data = await ipc.fetchGitAudit(20);
      if (data) {
        set({ audit: data.entries, auditLoading: false, auditError: false });
      } else {
        set({ auditLoading: false, auditError: true });
      }
    } catch {
      set({ auditLoading: false, auditError: true });
    }
  },
}));
