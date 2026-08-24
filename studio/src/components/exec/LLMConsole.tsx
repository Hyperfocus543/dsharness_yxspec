// =============================================================================
// S2-A: LLM 执行控制台（本地执行网关的浏览器端）
// 让用户在 Studio 里"派活"给真模型：浏览器 → 本地网关(8787) → DeepSeek
// 这是从"只读看板"迈向"能动"的第一个交互面板。
// 对话逻辑收敛到 useAgentChat hook（健康检查/模式/派活/取消），本组件只负责布局。
// 网关地址统一来自 ipc.GATEWAY_BASE（默认 127.0.0.1:8787，可 VITE_EXEC_GATEWAY 覆盖）。
// =============================================================================

import React from 'react';
import { useAgentChat } from '../../hooks/useAgentChat';
import { useStageStore, findCurrentStage } from '../../store/stageStore';
import { STAGE_TABLE, STAGE_ORDER } from '../../data/stage-mapping';
import { SessionList } from '../chat/SessionList';
import { renderMarkdown } from '../../utils/markdown';

export const LLMConsole: React.FC = () => {
  const {
    prompt,
    setPrompt,
    chat,
    loading,
    connState,
    mode,
    setMode,
    handleSend,
    cancel,
    chatUnavailable,
    GATEWAY_URL,
  } = useAgentChat();

  // 目标阶段上下文条（P0-②）：订阅当前阶段 + 门控状态
  const stages = useStageStore((s) => s.stages);
  const dshState = useStageStore((s) => s.dshState);
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

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：会话管理 + 连接状态 + 快捷指令 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        {/* 会话列表（对话管理系统） */}
        <SessionList />
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
              connState === 'ok' ? 'bg-green-500' : connState === 'err' ? 'bg-red-500' : 'bg-gray-400'
            }`}
          />
          <span className="text-gray-600">
            {connState === 'ok'
              ? '已连接执行网关'
              : connState === 'err'
                ? '网关未连接'
                : '检查连接…'}
          </span>
          <span className="text-xs text-gray-400 font-mono truncate">{GATEWAY_URL}</span>
        </div>
        <div className="text-xs text-gray-400">
          受限链式调用 · 仅手动触发，AI 不主动执行
        </div>
      </div>

      {/* 目标阶段上下文条（P0-②） */}
      {currentStage && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs">
          <span className="text-gray-600">
            目标阶段：
            <strong className="font-mono text-blue-700 ml-1">{currentStage}</strong>
            <span className="text-gray-400 ml-1.5">({STAGE_TABLE[currentStage]?.command})</span>
          </span>
          {stageGate ? (
            <span
              className={`px-1.5 py-0.5 rounded ${
                stageGate.blocked
                  ? 'bg-red-100 text-red-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
              title={stageGate.gateMessage || ''}
            >
              {stageGate.blocked ? `⛔ 门控拦截：${stageGate.gateMessage || ''}` : '✓ 门控放行'}
            </span>
          ) : (
            <span className="text-gray-400">门控状态未知</span>
          )}
        </div>
      )}

      {/* 模式切换：Agent 完整闭环 vs 快速对话 */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500 shrink-0">执行引擎：</span>
        <button
          className={`px-3 py-1 rounded border text-xs font-medium transition-colors ${
            mode === 'agent'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
          onClick={() => setMode('agent')}
          title="经 harness runtime 跑完整 agent 编排（工具/多步）"
        >
          Agent 完整闭环
        </button>
        {chatUnavailable ? (
          <button
            className="px-3 py-1 rounded border text-xs font-medium bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
            disabled
            title="网关未实现快速对话（/api/chat 501），请使用 Agent 模式"
          >
            快速对话（未实现）
          </button>
        ) : (
          <button
            className={`px-3 py-1 rounded border text-xs font-medium transition-colors ${
              mode === 'chat'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
            onClick={() => setMode('chat')}
            title="直连网关快速对话"
          >
            快速对话
          </button>
        )}
        <span className="text-xs text-gray-400">
          {mode === 'agent' ? 'Agent 完整编排' : '直连快速'}
        </span>
      </div>

      {/* 快捷指令模板：按当前阶段动态生成 */}
      <div className="mb-2 flex flex-wrap gap-1">
        <Chip onClick={() => handleTemplate('请分析当前仓库的 25 个 ASPICE 阶段进度，看看现在卡在哪')}>阶段进度分析</Chip>
        {currentStage && (
          <>
            <Chip onClick={() => handleTemplate(`请推进当前阶段 ${currentStage}，按门控要求生成产物`)}>
              推进 {currentStage}
            </Chip>
            <Chip onClick={() => handleTemplate(`请解释 ${currentStage} 阶段的审查要点与产物要求`)}>
              阶段解读
            </Chip>
          </>
        )}
        {STAGE_ORDER.length > 0 && (
          <Chip onClick={() => handleTemplate('请生成 SQT 测试用例设计的任务骨架（Markdown）')}>生成任务骨架</Chip>
        )}
      </div>

      {/* 对话区 */}
      <div className="flex-1 overflow-y-auto border rounded bg-gray-50 p-3 space-y-2 min-h-[200px]">
        {chat.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-10">
            在此派活给真模型。示例：让模型分析当前阶段、生成产物草稿、或解释门控规则。
          </div>
        ) : (
          chat.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] min-w-0 p-2 rounded text-sm break-words ${
                m.role === 'user'
                  ? 'bg-blue-100 text-blue-900 ml-auto whitespace-pre-wrap'
                  : m.role === 'assistant'
                    ? 'bg-white border text-gray-800'
                    : 'bg-gray-100 text-gray-500 whitespace-pre-wrap'
              }`}
            >
              {m.role === 'assistant' ? renderMarkdown(m.content) : m.content}
            </div>
          ))
        )}
        {loading && (
          <div className="text-sm text-blue-500 animate-pulse">模型思考中…</div>
        )}
      </div>

      {/* 输入区 */}
      <div className="mt-2 flex gap-2">
        <textarea
          className="flex-1 border rounded px-3 py-2 text-sm font-mono resize-none"
          rows={2}
          placeholder="输入要派给模型的活，回车发送 / Ctrl+Enter 换行"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        {loading && (
          <button
            className="px-3 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 shrink-0"
            onClick={cancel}
            title="取消本轮 agent 执行（中断 harness runtime）"
          >
            ✕ 取消
          </button>
        )}
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          onClick={handleSend}
          disabled={loading || !prompt.trim() || connState !== 'ok'}
        >
          {loading ? '执行中' : '派活'}
        </button>
      </div>
    </div>
  );
};

const Chip: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    className="text-xs px-2 py-1 bg-gray-100 hover:bg-blue-50 border rounded transition-colors"
    onClick={onClick}
  >
    {children}
  </button>
);
