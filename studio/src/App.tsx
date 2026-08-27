// =============================================================================
// YXSpec Studio - 主应用入口（对话驱动布局）
// 拆分后：导航→navigation.ts，卡片渲染→functionCards.tsx，
// hash 路由→utils/hashRoute.ts，布局件→components/layout/，错误隔离→ui/ErrorBoundary

import React from 'react';
import { useProjectStore } from './store/projectStore';
import { useStageStore, findCurrentStage, STAGE_TABLE } from './store/stageStore';
import { useToastStore } from './store/toastStore';
import { useGatewayStore } from './store/gatewayStore';
import { useChatStore } from './store/chatStore';
import { useFeatureStore } from './store/featureStore';
import { STAGE_ORDER } from './data/stage-mapping';
import { ArtifactDrawer } from './components/artifacts/ArtifactDrawer';
import { AppHeader } from './components/layout/AppHeader';
import { SideNav } from './components/layout/SideNav';
import { FunctionPanel } from './components/layout/FunctionPanel';
import { TerminalSection } from './components/layout/TerminalSection';
import { EmptyState } from './components/layout/EmptyState';
import type { StageMapping, StageToken } from './data/types';
import { useCardFromHash } from './utils/hashRoute';

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

  // hash 路由：`#/cockpit` 直达 + 刷新保留当前卡；null=收起面板
  const [activeCard, setActiveCard] = useCardFromHash();
  const [selectedTaskFile, setSelectedTaskFile] = React.useState<string>(
    'task_sqt_case_design.md',
  );
  // 周报插件被关闭时，若当前正停在周报页 → 自动切回驾驶舱（避免面板悬在已隐藏的功能上）
  React.useEffect(() => {
    if (!reportEnabled && activeCard === 'report') {
      setActiveCard('cockpit');
    }
  }, [reportEnabled, activeCard, setActiveCard]);
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
  const currentMapping: StageMapping | null = currentStage ? STAGE_TABLE[currentStage] : null;

  return (
    <div className="h-[100dvh] flex flex-col bg-zinc-50 overflow-hidden">
      {/* Header */}
      <AppHeader project={project} loading={loadingStages} />

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
            {/* 左侧：功能卡栏（<768px 折叠为顶部横向滚动条） */}
            <SideNav activeCard={activeCard} reportEnabled={reportEnabled} onSelect={setActiveCard} />

            {/* 中央：执行终端（工作台，占满剩余宽度） */}
            <TerminalSection activeCard={activeCard !== null} onCollapse={() => setActiveCard(null)} />

            {/* 右侧：功能面板（与对话并排，可拖拽调宽） */}
            {activeCard && (
              <FunctionPanel
                card={activeCard}
                ctx={{
                  projectPath: project.path,
                  stages,
                  currentStage,
                  currentMapping,
                  loading: loadingStages,
                  suggestNext,
                  selectedTaskFile,
                  onTaskFileChange: setSelectedTaskFile,
                  onSelectStage: (token) => {
                    const st = token as StageToken;
                    const mapping = STAGE_TABLE[st];
                    setDrawerStage({ token: st, label: mapping?.command || token });
                  },
                }}
              />
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

export default App;
