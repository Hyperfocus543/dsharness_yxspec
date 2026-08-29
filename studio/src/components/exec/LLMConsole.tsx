// =============================================================================
// S2-A: LLM 执行控制台（本地执行网关的浏览器端）
// 让用户在 Studio 里"派活"给真模型：浏览器 → 本地网关(8787) → DeepSeek
// 对话逻辑收敛到 useAgentChat hook（健康检查/模式/派活/取消），本组件只负责布局。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { useAgentChat } from '../../hooks/useAgentChat';
import { useStageStore, findCurrentStage } from '../../store/stageStore';
import { STAGE_TABLE, STAGE_ORDER } from '../../data/stage-mapping';
import { SessionList } from '../chat/SessionList';
import { ToolTraceInline } from '../chat/ToolTraceInline';
import { renderMarkdown } from '../../utils/markdown';
import { Icon, StatusDot, Button, EmptyState } from '../ui';
import { I } from '../ui/icons';
import {
  SlashCommandMenu,
  filterSlashItems,
  isBareTrigger,
  type SlashItem,
} from './SlashCommandMenu';
import { useFeatureStore } from '../../store/featureStore';
import { useToastStore } from '../../store/toastStore';

// 输入框行数 clamp 范围：[2, 10]，防止拖没 / 拖出可视区
const clampRows = (n: number) => Math.max(2, Math.min(10, Math.round(n)));

export const LLMConsole: React.FC = () => {
  const {
    prompt,
    setPrompt,
    chat,
    loading,
    connState,
    mode,
    setMode,
    send,
    handleSend,
    cancel,
    chatUnavailable,
    GATEWAY_URL,
  } = useAgentChat();

  // 目标阶段上下文条（P0-②）：订阅当前阶段 + 门控状态
  const stages = useStageStore((s) => s.stages);
  const dshState = useStageStore((s) => s.dshState);
  // 事件级流式：agent 正在做的工具动作（tool/call + tool/result）
  const toolStatus = useStageStore((s) => s.toolStatus);
  const currentStage = React.useMemo(
    () => findCurrentStage(stages, dshState?.current),
    [stages, dshState],
  );
  const stageGate = React.useMemo(() => {
    if (!currentStage) return null;
    const st = stages[currentStage];
    // 优先 dsh_state 的 gate，其次 StageStatus.gate_message
    const gate = dshState?.stages?.[currentStage]?.gate ?? null;
    // blocked 从 upstream 推导：任一上游未完成即拦截
    const upstreamOk = gate
      ? Object.values(gate.upstream || {}).every((v) => v === true)
      : null;
    const blocked = upstreamOk === null
      ? Boolean(st?.gate_message)
      : !upstreamOk;
    return {
      gateMessage: gate?.message || st?.gate_message || null,
      blocked,
    };
  }, [currentStage, stages, dshState]);

  const handleTemplate = (text: string) => setPrompt(text);

  // ---- Slash 命令补全：输入 / 弹 /yxspec: 命令列表 + 功能商店开关 ----
  const features = useFeatureStore((s) => s.features);
  const loadFeatures = useFeatureStore((s) => s.load);
  const toggleFeature = useFeatureStore((s) => s.toggle);
  const pushToast = useToastStore((s) => s.push);
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashHighlight, setSlashHighlight] = React.useState(0);
  // 首次打开时若功能列表未加载则拉取（开关状态需要实时）
  React.useEffect(() => {
    if (slashOpen && features.length === 0) {
      loadFeatures().catch(() => {});
    }
  }, [slashOpen, features.length, loadFeatures]);
  const slashItems = React.useMemo(
    () => (slashOpen ? filterSlashItems(prompt, features) : []),
    [slashOpen, prompt, features],
  );
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  // 输入框高度（行数）—— 默认 3 行，记住上次拖的行数（localStorage 持久化）
  const [inputRows, setInputRows] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem('yxspec-studio.console-input-rows');
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n >= 2) return clampRows(n);
    } catch {
      /* ignore */
    }
    return 3;
  });
  const inputDragRef = React.useRef<{ startY: number; startRows: number } | null>(null);

  const closeSlash = () => setSlashOpen(false);

  const onSlashSelect = (item: SlashItem) => {
    setSlashOpen(false);
    if (item.kind === 'command') {
      if (item.token === 'self-iterate') {
        // 自迭代命令必须带阶段才建 run（网关 parseSelfIterate 裸命令不建）→ 注入当前阶段
        if (!currentStage) {
          pushToast('warn', '当前阶段未知，无法快捷启动自迭代，请先在自迭代卡内选择阶段');
          return;
        }
        const cmd = item.command + currentStage; // '/yxspec:self-iterate <当前阶段 token>'
        setPrompt(cmd);
        send(cmd);
      } else {
        // 现有逻辑不变
        setPrompt(item.command);
        // 选中后立即触发（对标 Claude Code 回车触发命令）
        send(item.command);
      }
    } else {
      // 功能开关：选中即切换。always（审计账本）不可关，锁定项提示不可用。
      if (item.always) {
        pushToast('info', `「${item.name}」为始终启用，无需开关`);
      } else if (item.locked) {
        pushToast('warn', `「${item.name}」未可用（依赖 harness 链路确认）`);
      } else {
        const next = !item.enabled;
        toggleFeature(item.id, next)
          .then(() => pushToast('success', `${item.name} 已${next ? '开启' : '关闭'}`))
          .catch((e: any) => pushToast('error', `切换失败: ${e?.message || e}`));
      }
    }
    textareaRef.current?.focus();
  };

  const onSlashFill = (item: SlashItem) => {
    setSlashOpen(false);
    if (item.kind === 'command') setPrompt(item.command);
    else setPrompt(item.name);
    textareaRef.current?.focus();
  };

  const onPromptChange = (v: string) => {
    setPrompt(v);
    // 输入以 / 开头且是合法命令前缀 → 弹补全；否则关闭
    const t = v.trimStart();
    if (t.startsWith('/')) {
      setSlashOpen(true);
      setSlashHighlight(0);
    } else {
      setSlashOpen(false);
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashHighlight((h) => (h + 1) % slashItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashHighlight((h) => (h - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // 只有 "/" 或 "/yxspec:" 裸触发时不自动发送（避免误触发）
        if (!isBareTrigger(prompt)) {
          e.preventDefault();
          onSlashSelect(slashItems[slashHighlight]);
        }
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        onSlashFill(slashItems[slashHighlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlash();
        return;
      }
    }
    // 常规回车发送
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 对话区自动滚动到底：chat 内容变化（新消息/加载态切换）时，滚到最下方
  const chatScrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, loading]);

  // 输入区拖拽调整高度：向上拖 → 行数变多（每 24px ≈ 1 行），实时写 localStorage
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = inputDragRef.current;
      if (!d) return;
      const next = clampRows(d.startRows + (d.startY - e.clientY) / 24);
      setInputRows(next);
      try {
        localStorage.setItem('yxspec-studio.console-input-rows', String(next));
      } catch {
        /* ignore */
      }
    };
    const onUp = () => {
      inputDragRef.current = null;
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

  const connTone = connState === 'ok' ? 'ok' : connState === 'err' ? 'err' : 'idle';
  const connLabel = connState === 'ok' ? '已连接执行网关' : connState === 'err' ? '网关未连接' : '检查连接…';

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏：会话选择在左；模式切换 + 连接状态靠右 */}
      <div className="flex items-center gap-3 mb-1.5 whitespace-nowrap">
        <SessionList />
        <span className="flex-1" />
        {/* 模式切换（紧凑分段控件） */}
        <div className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-200 rounded p-0.5 shrink-0">
          <button
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all active:scale-[0.98] ${
              mode === 'agent'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-zinc-500 hover:bg-white/50'
            }`}
            onClick={() => setMode('agent')}
            title="经 harness runtime 跑完整 agent 编排（工具/多步）"
          >
            Agent
          </button>
          {!chatUnavailable && (
            <button
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all active:scale-[0.98] ${
                mode === 'chat'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-zinc-500 hover:bg-white/50'
              }`}
              onClick={() => setMode('chat')}
              title="直连网关快速对话"
            >
              对话
            </button>
          )}
        </div>
        {/* 连接状态：右端常驻 */}
        <div className="flex items-center gap-1.5 text-xs shrink-0">
          <StatusDot tone={connTone} />
          <span className="text-zinc-500">{connLabel}</span>
        </div>
      </div>

      {/* 目标阶段 + 工具流式（合并一行，省竖高）：阶段/门控在左，agent 实时工具动作在右。
          工具参数过长截断（flex-1 min-w-0 truncate），不折行；窗口过窄才兜底 wrap。 */}
      {(currentStage || toolStatus) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1 bg-zinc-50 border border-zinc-200 rounded text-xs min-w-0">
          {currentStage && (
            <>
              <span className="text-zinc-600 shrink-0">
                目标阶段：
                <strong className="font-mono text-zinc-900 ml-1">{currentStage}</strong>
                <span className="text-zinc-400 ml-1.5">({STAGE_TABLE[currentStage]?.command})</span>
              </span>
              {stageGate ? (
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
                    stageGate.blocked
                      ? 'bg-red-100 text-red-700'
                      : 'bg-sage-100 text-sage-700'
                  }`}
                  title={stageGate.gateMessage || ''}
                >
                  <Icon name={stageGate.blocked ? I.close : I.check} size={12} weight="bold" />
                  {stageGate.blocked ? `门控拦截：${stageGate.gateMessage || ''}` : '门控放行'}
                </span>
              ) : (
                <span className="text-zinc-400 shrink-0">门控状态未知</span>
              )}
            </>
          )}
          {toolStatus && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 min-w-0 flex-1 animate-fade-in-up"
            >
              <span className="shrink-0 inline-flex items-center gap-1.5">
                {toolStatus.kind === 'call' ? (
                  <>
                    <Icon name={I.clock} size={12} weight="bold" className="animate-spin text-emerald-700" />
                    <span className="text-emerald-700">正在调用</span>
                  </>
                ) : (
                  <Icon name={I.check} size={12} weight="bold" className="text-zinc-400" />
                )}
              </span>
              <span className="font-mono font-semibold shrink-0 text-zinc-700">{toolStatus.name || '工具'}</span>
              {toolStatus.args && (
                <span className="flex-1 min-w-0 truncate font-mono text-zinc-500" title={toolStatus.args}>
                  {toolStatus.args}
                </span>
              )}
              {toolStatus.error ? (
                <span className="text-red-600 shrink-0">error: {toolStatus.error}</span>
              ) : toolStatus.kind === 'result' ? (
                <span className="text-sage-600 shrink-0">完成</span>
              ) : (
                <span className="text-amber-500 shrink-0 animate-pulse">…</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* 对话区 */}
      <div ref={chatScrollRef} className="flex-1 overflow-y-auto border border-zinc-200 rounded-md bg-white p-3 space-y-2 min-h-[200px]">
        {chat.length === 0 ? (
          <EmptyState
            icon={I.terminal}
            title="在此派活给真模型"
            hint="让模型分析当前阶段、生成产物草稿、或解释门控规则"
          />
        ) : (
          chat.map((m, i) => (
            <div
              // 稳定 key：chatStore 消息无 id，用 index 兜底（追加式流式，列表只增不改序）
              key={`${m.role}-${i}`}
              className={`max-w-[85%] min-w-0 p-2.5 rounded-md text-sm break-words ${
                m.role === 'user'
                  ? 'bg-emerald-600 text-white ml-auto whitespace-pre-wrap shadow-sm'
                  : m.role === 'assistant'
                    ? 'bg-white border border-zinc-200 text-zinc-800'
                    : 'bg-zinc-100 text-zinc-500 whitespace-pre-wrap'
              }`}
            >
              {m.role === 'assistant' ? (
                <>
                  {renderMarkdown(m.content)}
                  {/* 执行轨迹内联（参照 DSH 官方 ChatView turn 尾）：折叠展开工具链 */}
                  {m.role === 'assistant' && m.tools && m.tools.length > 0 && (
                    <ToolTraceInline tools={m.tools} />
                  )}
                </>
              ) : (
                m.content
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            模型思考中…
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="mt-2">
        {/* 快捷对话模板：点击填入输入框（贴近派活动作，不占顶部、不折行、隐藏横滚条） */}
        <div className="mb-1.5 flex items-center gap-1 overflow-x-auto scrollbar-hide">
          <span className="text-zinc-400 shrink-0" title="点击填入输入框，回车发送">
            <Icon name={I.bolt} size={12} />
          </span>
          <Chip onClick={() => handleTemplate('请分析当前仓库的 25 个 ASPICE 阶段进度，看看现在卡在哪')}>阶段进度分析</Chip>
          {currentStage && (
            <>
              <Chip onClick={() => handleTemplate(`请解释 ${currentStage} 阶段的审查要点与产物要求`)}>
                阶段解读
              </Chip>
            </>
          )}
          {STAGE_ORDER.length > 0 && (
            <Chip onClick={() => handleTemplate('请生成 SQT 测试用例设计的任务骨架（Markdown）')}>生成任务骨架</Chip>
          )}
        </div>
        <div className="flex gap-2 relative">
          {slashOpen && slashItems.length > 0 && (
            <SlashCommandMenu
              items={slashItems}
              highlight={slashHighlight}
              onSelect={onSlashSelect}
              onHover={setSlashHighlight}
            />
          )}
          <div className="flex flex-col flex-1 min-w-0 gap-1">
            {/* 输入区拖拽手柄：对话区与输入区之间，可单独拉高/压低输入框 */}
            <div
              className="h-1.5 cursor-row-resize group relative -mx-1"
              onMouseDown={(e) => {
                inputDragRef.current = { startY: e.clientY, startRows: inputRows };
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
                e.preventDefault();
              }}
              title="拖动调整输入框高度"
            >
              <div className="h-0.5 w-full bg-transparent group-hover:bg-emerald-300/70 group-active:bg-emerald-500 transition-colors" />
            </div>
            <textarea
              ref={textareaRef}
              className="flex-1 border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              rows={inputRows}
              placeholder="输入要派给模型的活，或输入 / 选择 yxspec 命令，回车发送 / Ctrl+Enter 换行"
              aria-label="派活指令输入框"
              aria-expanded={slashOpen}
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={onInputKeyDown}
            />
          </div>
          {loading && (
            <Button
              variant="danger"
              onClick={cancel}
              title="取消本轮 agent 执行（中断 harness runtime）"
            >
              <Icon name={I.stop} size={14} weight="fill" />
              取消
            </Button>
          )}
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={loading || !prompt.trim()}
            title="发送命令。若网关不可达，会给出明确提示（不再静默禁用）。"
          >
            <Icon name={I.send} size={14} />
            {loading ? '执行中' : '派活'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const Chip: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    className="text-xs px-2 py-1 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-700 border border-zinc-200 rounded-md transition-colors active:scale-[0.98]"
    onClick={onClick}
  >
    {children}
  </button>
);
