// =============================================================================
// YXSpec Studio - 主应用入口（对话驱动布局）
// 布局：执行终端常驻主界面（最高优先级）；左侧功能卡（驾驶舱/看板/审查/
// Pipeline/产物图谱），点击后在终端右侧展开面板。
// =============================================================================

import React from 'react';
import { StageCockpit } from './components/cockpit/StageCockpit';
import { NextCommand } from './components/cockpit/NextCommand';
import { ResumeBanner } from './components/cockpit/ResumeBanner';
import { BatchQueue } from './components/cockpit/BatchQueue';
// ReportExport 由 FE-2 子 agent 实现（零 props，导出名 ReportExport）。
import { ReportExport } from './components/cockpit/ReportExport';
import { TaskBoard } from './components/taskboard/TaskBoard';
import { ReviewCenter } from './components/review/ReviewCenter';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
import { ArtifactDrawer } from './components/artifacts/ArtifactDrawer';
import { ModelSettings } from './components/settings/ModelSettings';
import { PluginCenter } from './components/plugin/PluginCenter';
import { useFeatureStore } from './store/featureStore';
import { LLMConsole } from './components/exec/LLMConsole';
import { ProjectSwitcher } from './components/layout/ProjectSwitcher';
import { Icon } from './components/ui';
import { I } from './components/ui/icons';
import { useProjectStore } from './store/projectStore';
import { useStageStore, findCurrentStage, STAGE_TABLE } from './store/stageStore';
import { useToastStore } from './store/toastStore';
import { useGatewayStore } from './store/gatewayStore';
import { GatewayStatusBar } from './components/layout/GatewayStatusBar';
import { useChatStore } from './store/chatStore';
import { STAGE_ORDER } from './data/stage-mapping';
import type { StageMapping, StageToken } from './data/types';

/** 功能卡 id：除执行终端外的辅助功能（产物图谱已并入驾驶舱流向视图） */
type FunctionCard =
  | 'cockpit'
  | 'tasks'
  | 'reviews'
  | 'pipeline'
  | 'plugins'
  | 'settings'
  | 'batch'
  | 'report';

const FUNCTION_CARDS: { id: FunctionCard; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'cockpit', label: '流程驾驶舱', icon: I.gauge, hint: '阶段进度 · 门控 · 流向' },
  { id: 'tasks', label: '任务看板', icon: I.listChecks, hint: '阶段任务状态机' },
  { id: 'reviews', label: '审查中心', icon: I.shield, hint: 'Review 裁决' },
  { id: 'batch', label: '批处理', icon: I.bolt, hint: '多阶段一键连跑' },
  { id: 'report', label: '周报', icon: I.fileText, hint: '进度导出' },
  { id: 'pipeline', label: 'Pipeline', icon: I.stack, hint: '编码流水线' },
  { id: 'plugins', label: '插件中心', icon: I.plugs, hint: '功能开关 · 社区插件' },
  { id: 'settings', label: '设置', icon: I.gear, hint: '模型管理 · 网关' },
];

const DEFAULT_TASKS_FILES = [
  'task_init.md',
  'task_prd.md',
  'task_sw_req.md',
  'task_sw_arch.md',
  'task_sw_arch_if.md',
  'task_sqt_strategy.md',
  'task_sqt_tr_analysis.md',
  'task_sqt_case_design.md',
  'task_sqt_script_gen.md',
  'task_sqt_defect_feedback.md',
];

const App: React.FC = () => {
  const project = useProjectStore((s) => s.current);
  const stages = useStageStore((s) => s.stages);
  const dshState = useStageStore((s) => s.dshState);
  const refreshStages = useStageStore((s) => s.refresh);
  const loadDshState = useStageStore((s) => s.loadDshState);
  const loadResume = useStageStore((s) => s.loadResume);
  const suggestNext = useStageStore((s) => s.suggestNext);
  const loadingStages = useStageStore((s) => s.loading);
  const toasts = useToastStore((s) => s.toasts);
  // 功能商店订阅：ui-report（周报）是纯 UI 插件，启用才显示左侧「周报」功能卡
  const features = useFeatureStore((s) => s.features);
  const loadFeatures = useFeatureStore((s) => s.load);
  // 首次挂载加载功能列表（决定周报卡是否显示）
  React.useEffect(() => {
    loadFeatures().catch(() => {});
  }, [loadFeatures]);
  // 网关连接指示条：挂载即启动全局探活（8s 周期），卸载停止
  const startGatewayCheck = useGatewayStore((s) => s.start);
  React.useEffect(() => startGatewayCheck(), [startGatewayCheck]);
  // ui-report 是否启用（feature 未加载/未找到 → 关）
  const reportEnabled = React.useMemo(
    () => features.some((f) => f.id === 'ui-report' && f.enabled),
    [features],
  );
  // 可显示的左侧功能卡：周报仅当 ui-report 启用时出现
  const visibleCards = React.useMemo(
    () => FUNCTION_CARDS.filter((c) => c.id !== 'report' || reportEnabled),
    [reportEnabled],
  );

  const [activeCard, setActiveCard] = React.useState<FunctionCard | null>('cockpit');
  const [selectedTaskFile, setSelectedTaskFile] = React.useState<string>(
    'task_sqt_case_design.md',
  );
  // 周报插件被关闭时，若当前正停在周报页 → 自动切回驾驶舱（避免面板悬在已隐藏的功能上）
  React.useEffect(() => {
    if (!reportEnabled && activeCard === 'report') {
      setActiveCard('cockpit');
    }
  }, [reportEnabled, activeCard]);
  // 可拖拽面板宽度（功能面板，右侧并排）—— 记住上次拖的大小（localStorage 持久化）
  const [panelWidth, setPanelWidth] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem('yxspec-studio.panel-width');
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n > 0 ? n : 820;
    } catch {
      return 820;
    }
  });
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<{ startX: number; startW: number } | null>(null);

  // 拖拽调整面板宽度：mousedown 记录起点，mousemove 计算差值更新宽度
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragStateRef.current;
      if (!d) return;
      // 向左拖 → 面板变宽（宽度 = 起点宽 + 起点x - 当前x），不限最小/最大
      const next = Math.max(0, d.startW + (d.startX - e.clientX));
      setPanelWidth(next);
      // 实时持久化到 localStorage
      try {
        localStorage.setItem('yxspec-studio.panel-width', String(next));
      } catch {
        /* ignore */
      }
    };
    const onUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);
  // 产物详情抽屉（需求 3）：点击阶段节点打开
  const [drawerStage, setDrawerStage] = React.useState<{ token: StageToken; label: string } | null>(
    null,
  );

  // 默认从 URL 读 project 参数
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('project');
    if (fromUrl) {
      useProjectStore.getState().load(fromUrl);
    }
  }, []);

  // 项目加载后：先读 dsh_state.json（SQT 演示真相文件）→ 静态刷一次阶段 → 订阅网关实时事件
  // loadDshState 内部会恢复 localStorage 里的 sessionId 并 connectEvents（幂等），
  // 因此无需在 App 里重复订阅。
  // 同时初始化对话会话（按项目隔离）；并拉取 /api/resume 断点恢复信息（网关重启/休眠后提示续跑）。
  React.useEffect(() => {
    // 项目切换时先清空旧项目的断点恢复信息（避免 A 项目提示条闪现在 B 项目上）
    useStageStore.setState({ resumeInfo: null });
    if (!project) return;
    useChatStore.getState().setProject(project.path);
    let cancelled = false;
    (async () => {
      await refreshStages(project.path);
      await loadDshState(project.path);
      await loadResume(project.path); // 幂等；项目切换时重新拉（resumeInfo 随项目走）
      await useStageStore.getState().loadCost();
      if (!cancelled) {
        // loadDshState 已负责订阅；此处保留 connectEvents 为幂等兜底（重复调用会先 disconnect 再重连，安全）
        await useStageStore
          .getState()
          .connectEvents(project.path)
          .catch((e) => console.warn('connectEvents 失败:', e));
      }
    })();
    return () => {
      cancelled = true;
      useStageStore.getState().disconnectEvents();
    };
  }, [project?.path]);

  const currentStage = React.useMemo(
    () => findCurrentStage(stages, dshState?.current),
    [stages, dshState],
  );
  const currentMapping = currentStage ? STAGE_TABLE[currentStage] : null;

  return (
    <div className="h-[100dvh] flex flex-col bg-zinc-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="text-xl font-bold text-zinc-900 flex items-center gap-2">
            <span className="text-emerald-600"><Icon name={I.cube} size={22} weight="fill" /></span>
            YXSpec Studio
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 网关连接状态指示条（全局探活，点击重探测） */}
          <GatewayStatusBar />
          {project && (
            <span className="text-xs text-zinc-600 hidden sm:inline">
              <span className="font-mono">{project.meta.spec_id || '—'}</span>
              {' · '}
              {project.meta.product || '—'}
            </span>
          )}
          {/* 全局项目切换器：无论是否打开项目都在 */}
          <ProjectSwitcher currentPath={project?.path ?? null} loading={loadingStages} />
        </div>
      </header>

      {/* 项目状态条 — 已删除：分支/工期数据源（PROGRESS.md 元信息）恒空、阶段计算仅为刷新时间戳，
          无信息量；spec_id+product 已在 header 右上显示，路径在 ProjectSwitcher。 */}

      {/* 主区域：左侧功能卡栏 + 对话终端(工作台占满) + 功能面板(右侧抽屉覆盖) */}
      <main className="flex-1 min-w-0 flex overflow-hidden relative">
        {!project ? (
          <div className="flex-1 overflow-y-auto">
            <EmptyState loading={loadingStages} />
          </div>
        ) : (
          <>
            {/* 左侧：功能卡栏 */}
            <aside className="w-52 shrink-0 border-r bg-white flex flex-col p-2 gap-1.5 overflow-y-auto">
              {visibleCards.map((card) => {
                const active = activeCard === card.id;
                return (
                  <button
                    key={card.id}
                    className={`rounded-lg border p-2.5 text-left transition-all active:scale-[0.98] ${
                      active
                        ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200'
                        : 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
                    }`}
                    onClick={() => setActiveCard(active ? null : card.id)}
                    title={active ? '收起面板' : card.hint}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 ${active ? 'text-emerald-600' : 'text-zinc-400'}`}>
                        <Icon name={card.icon} size={18} />
                      </span>
                      <div>
                        <div className={`text-sm font-semibold ${active ? 'text-emerald-800' : 'text-zinc-700'}`}>{card.label}</div>
                        <div className="text-xs text-zinc-400">{card.hint}</div>
                      </div>
                      {active && <span className="ml-auto text-emerald-500 text-xs">◂</span>}
                    </div>
                  </button>
                );
              })}
            </aside>

            {/* 中央：执行终端（工作台，占满剩余宽度） */}
            <section className="flex-1 min-w-0 bg-zinc-50 flex flex-col">
              <div className="px-3 py-2 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600"><Icon name={I.terminal} size={16} /></span>
                  <span className="text-sm font-bold text-zinc-800">执行终端</span>
                </div>
                {activeCard && (
                  <button
                    className="text-xs px-2 py-1 bg-zinc-100 hover:bg-zinc-200 rounded text-zinc-600 flex items-center gap-1"
                    onClick={() => setActiveCard(null)}
                  >
                    <Icon name={I.doubleLeft} size={14} />
                    收右面板
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-hidden p-2">
                <LLMConsole />
              </div>
            </section>

            {/* 右侧：功能面板（与对话并排，可拖拽调宽） */}
            {activeCard && (
              <div className="relative shrink-0 flex" style={{ width: panelWidth }}>
                {/* 拖拽手柄：左边缘 */}
                <div
                  className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 group"
                  onMouseDown={(e) => {
                    dragStateRef.current = { startX: e.clientX, startW: panelWidth };
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                    e.preventDefault();
                  }}
                  title="拖动调整面板宽度"
                >
                  <div className="w-1 h-full mx-auto bg-transparent group-hover:bg-emerald-300 group-active:bg-emerald-500 transition-colors" />
                </div>
                <section
                  ref={panelRef}
                  className="flex-1 border-l border-zinc-200 bg-zinc-50 overflow-y-auto"
                >
                  {renderFunctionCard(activeCard, {
                    projectPath: project.path,
                    stages,
                    currentStage,
                    currentMapping,
                    suggestNext,
                    selectedTaskFile,
                    onTaskFileChange: setSelectedTaskFile,
                    onSelectStage: (token) => {
                      const st = token as StageToken;
                      const mapping = STAGE_TABLE[st];
                      setDrawerStage({ token: st, label: mapping?.command || token });
                    },
                  })}
                </section>
              </div>
            )}
          </>
        )}
      </main>

      {/* 产物详情抽屉（需求 3）*/}
      <ArtifactDrawer
        open={drawerStage !== null}
        token={drawerStage?.token ?? null}
        label={drawerStage?.label ?? ''}
        artifacts={
          drawerStage
            ? (dshState?.stages?.[drawerStage.token]?.artifacts as any[]) ??
              stages[drawerStage.token]?.artifacts ??
              []
            : []
        }
        onClose={() => setDrawerStage(null)}
      />

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded shadow-lg text-white text-sm ${
              t.level === 'error'
                ? 'bg-red-500'
                : t.level === 'warn'
                  ? 'bg-amber-500'
                  : t.level === 'success'
                    ? 'bg-sage-500'
                    : 'bg-blue-500'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 flex items-center justify-between shrink-0">
        <span>YXSpec Studio</span>
        <span>共 {STAGE_ORDER.length} 阶段</span>
      </footer>
    </div>
  );
};

/** 功能卡面板渲染：按卡 id 返回对应组件 */
function renderFunctionCard(
  card: FunctionCard,
  ctx: {
    projectPath: string;
    stages: ReturnType<typeof useStageStore.getState>['stages'];
    currentStage: string | null;
    currentMapping: StageMapping | null;
    suggestNext: (s: StageToken) => Promise<string | null>;
    selectedTaskFile: string;
    onTaskFileChange: (f: string) => void;
    onSelectStage: (token: string) => void;
  },
) {
  switch (card) {
    case 'cockpit':
      return (
        <div className="p-3 space-y-2.5">
          {/* 断点续跑（驾驶舱顶部，建议下一步之前）：网关重启/休眠后提示「已恢复到 X 阶段」+ 一键续跑 */}
          <ResumeBanner />
          {/* 建议下一步（驾驶舱顶端，整体进度/当前阶段之后） */}
          {ctx.currentStage && ctx.currentMapping && (
            <NextCommand
              stage={ctx.currentStage}
              mapping={ctx.currentMapping}
              stages={ctx.stages}
              onSuggest={(cmd) => ctx.suggestNext(cmd as StageToken)}
            />
          )}
          <StageCockpit
            stages={ctx.stages}
            currentStage={ctx.currentStage}
            onSelectStage={ctx.onSelectStage}
          />
        </div>
      );
    case 'tasks':
      return (
        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-zinc-600">任务文件：</span>
            <select
              className="text-xs border rounded px-2 py-1 font-mono"
              value={ctx.selectedTaskFile}
              onChange={(e) => ctx.onTaskFileChange(e.target.value)}
            >
              {DEFAULT_TASKS_FILES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <TaskBoard
            projectPath={ctx.projectPath}
            taskFile={ctx.selectedTaskFile}
            title={`任务状态机看板 - ${ctx.selectedTaskFile}`}
          />
        </div>
      );
    case 'reviews':
      return <ReviewCenter projectPath={ctx.projectPath} />;
    case 'batch':
      return <BatchQueue />;
    case 'report':
      return <ReportExport />;
    case 'pipeline':
      return <PipelinePanel projectPath={ctx.projectPath} />;
    case 'plugins':
      return <PluginCenter />;
    case 'settings':
      return <ModelSettings />;
    default:
      return null;
  }
}

const EmptyState: React.FC<{ loading: boolean }> = ({ loading }) => (  <div className="flex items-center justify-center h-full">
    <div className="text-center max-w-lg p-8">
      <div className="mb-4 flex justify-center text-emerald-600"><Icon name={I.cube} size={56} weight="fill" /></div>
      <h2 className="text-2xl font-bold mb-2 text-zinc-800">YXSpec Studio</h2>
      <p className="text-sm text-zinc-500 mb-5">
        选择或输入 yxspec 项目路径打开
      </p>
      <div className="flex justify-center">
        <ProjectSwitcher currentPath={null} loading={loading} />
      </div>
    </div>
  </div>
);

export default App;
