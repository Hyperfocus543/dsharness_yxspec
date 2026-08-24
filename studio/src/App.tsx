// =============================================================================
// YXSpec Studio - 主应用入口（对话驱动布局）
// 布局：执行终端常驻主界面（最高优先级）；左侧功能卡（驾驶舱/看板/审查/
// Pipeline/产物图谱），点击后在终端右侧展开面板。
// =============================================================================

import React from 'react';
import { StageCockpit } from './components/cockpit/StageCockpit';
import { NextCommand } from './components/cockpit/NextCommand';
import { TaskBoard } from './components/taskboard/TaskBoard';
import { ReviewCenter } from './components/review/ReviewCenter';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
import { ArtifactDrawer } from './components/artifacts/ArtifactDrawer';
import { ModelSettings } from './components/settings/ModelSettings';
import { LLMConsole } from './components/exec/LLMConsole';
import { ProjectSwitcher } from './components/layout/ProjectSwitcher';
import { useProjectStore } from './store/projectStore';
import { useStageStore, findCurrentStage, STAGE_TABLE } from './store/stageStore';
import { useToastStore } from './store/toastStore';
import { useChatStore } from './store/chatStore';
import { STAGE_ORDER } from './data/stage-mapping';
import type { StageMapping, StageToken } from './data/types';

/** 功能卡 id：除执行终端外的辅助功能（产物图谱已并入驾驶舱流向视图） */
type FunctionCard = 'cockpit' | 'tasks' | 'reviews' | 'pipeline' | 'settings';

const FUNCTION_CARDS: { id: FunctionCard; label: string; icon: string; hint: string }[] = [
  { id: 'cockpit', label: '流程驾驶舱', icon: '🎛️', hint: '阶段进度 · 门控 · 流向' },
  { id: 'tasks', label: '任务看板', icon: '📋', hint: '阶段任务状态机' },
  { id: 'reviews', label: '审查中心', icon: '✅', hint: 'Review 裁决' },
  { id: 'pipeline', label: 'Pipeline', icon: '📊', hint: '编码流水线' },
  { id: 'settings', label: '设置', icon: '⚙️', hint: '模型管理 · 网关' },
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
  const suggestNext = useStageStore((s) => s.suggestNext);
  const loadingStages = useStageStore((s) => s.loading);
  const lastUpdate = useStageStore((s) => s.lastUpdate);
  const toasts = useToastStore((s) => s.toasts);

  const [activeCard, setActiveCard] = React.useState<FunctionCard | null>('cockpit');
  const [selectedTaskFile, setSelectedTaskFile] = React.useState<string>(
    'task_sqt_case_design.md',
  );
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
  // 同时初始化对话会话（按项目隔离）
  React.useEffect(() => {
    if (!project) return;
    useChatStore.getState().setProject(project.path);
    let cancelled = false;
    (async () => {
      await refreshStages(project.path);
      await loadDshState(project.path);
      if (!cancelled) {
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
    <div className="h-[100dvh] flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="text-xl font-bold text-blue-700">🛰️ YXSpec Studio</div>
          <span className="text-xs text-gray-500">对话驱动驾驶舱</span>
        </div>
        <div className="flex items-center gap-2">
          {project && (
            <span className="text-xs text-gray-600 hidden sm:inline">
              <span className="font-mono">{project.meta.spec_id || '—'}</span>
              {' · '}
              {project.meta.product || '—'}
            </span>
          )}
          {/* 全局项目切换器：无论是否打开项目都在 */}
          <ProjectSwitcher currentPath={project?.path ?? null} loading={loadingStages} />
        </div>
      </header>

      {/* 项目状态条 */}
      {project && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-1.5 text-xs shrink-0">
          <div className="flex flex-wrap gap-x-6 gap-y-0.5">
            <span>
              <strong>路径：</strong>
              <code className="bg-white px-1 rounded">{project.path}</code>
            </span>
            <span>
              <strong>分支：</strong>
              <code className="bg-white px-1 rounded">{project.meta.git_branch || '—'}</code>
            </span>
            <span>
              <strong>工期：</strong>
              {project.meta.target_schedule || '—'}
            </span>
            <span>
              <strong>阶段计算：</strong>
              {lastUpdate || '—'}
            </span>
          </div>
        </div>
      )}

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
              <div className="px-1 py-1 text-[11px] text-gray-400 uppercase tracking-wide">
                功能面板
              </div>
              {FUNCTION_CARDS.map((card) => {
                const active = activeCard === card.id;
                return (
                  <button
                    key={card.id}
                    className={`rounded-lg border p-2.5 text-left transition-all ${
                      active
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                        : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'
                    }`}
                    onClick={() => setActiveCard(active ? null : card.id)}
                    title={active ? '收起面板' : card.hint}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{card.icon}</span>
                      <div>
                        <div className="text-sm font-semibold text-gray-700">{card.label}</div>
                        <div className="text-[11px] text-gray-400">{card.hint}</div>
                      </div>
                      {active && <span className="ml-auto text-blue-500 text-xs">◂</span>}
                    </div>
                  </button>
                );
              })}
              <div className="mt-auto px-1 py-1 text-[11px] text-gray-400">
                💬 对话在中央常驻，随时派活
              </div>
            </aside>

            {/* 中央：执行终端（工作台，占满剩余宽度） */}
            <section className="flex-1 min-w-0 bg-gray-50 flex flex-col">
              <div className="px-3 py-2 border-b bg-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-base">⚡</span>
                  <span className="text-sm font-bold text-gray-700">执行终端</span>
                  <span className="text-[11px] text-gray-400">对话驱动 · 主入口</span>
                </div>
                {activeCard && (
                  <button
                    className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600"
                    onClick={() => setActiveCard(null)}
                  >
                    ⇤ 收右面板
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
                  <div className="w-1 h-full mx-auto bg-transparent group-hover:bg-blue-300 group-active:bg-blue-500 transition-colors" />
                </div>
                <section
                  ref={panelRef}
                  className="flex-1 border-l bg-gray-50 overflow-y-auto"
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
                    ? 'bg-emerald-500'
                    : 'bg-blue-500'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t px-4 py-1.5 text-xs text-gray-500 flex items-center justify-between shrink-0">
        <span>
          YXSpec Studio · 对话驱动 · 功能面板辅助 · 受限链式调用（仅推荐不自动执行）
        </span>
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
        <div className="p-4 space-y-4">
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
            <span className="text-xs text-gray-600">任务文件：</span>
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
    case 'pipeline':
      return <PipelinePanel projectPath={ctx.projectPath} />;
    case 'settings':
      return <ModelSettings />;
    default:
      return null;
  }
}

const EmptyState: React.FC<{ loading: boolean }> = ({ loading }) => (
  <div className="flex items-center justify-center h-full">
    <div className="text-center max-w-lg p-8">
      <div className="text-6xl mb-4">🛰️</div>
      <h2 className="text-2xl font-bold mb-2 text-gray-700">YXSpec Studio</h2>
      <p className="text-sm text-gray-500 mb-5">
        把 yxspec V3 流程驾驶舱化的桌面工具。在下方选择或输入 yxspec 项目路径打开。
      </p>
      <div className="flex justify-center">
        <ProjectSwitcher currentPath={null} loading={loading} />
      </div>
      <p className="text-xs text-gray-400 mt-4">
        也可通过 URL 参数 <code className="bg-gray-100 px-1 rounded">?project=&ltpath&gt;</code> 注入
      </p>
    </div>
  </div>
);

export default App;
