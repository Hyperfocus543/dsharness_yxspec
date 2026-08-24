// M1 配套 - 建议下一步组件
// 受限链式调用：默认仅填充到命令框；可选"一键派活"直接 POST 网关 /api/agent

import React from 'react';
import { useToastStore } from '../../store/toastStore';
import { useStageStore } from '../../store/stageStore';
import { useProjectStore } from '../../store/projectStore';
import { useChatStore } from '../../store/chatStore';
import { useModelStore } from '../../store/modelStore';
import { STAGE_TABLE } from '../../data/stage-mapping';
import * as ipc from '../../utils/ipc';
import type { StageMapping, StageStatus } from '../../data/types';

interface Props {
  stage: string;
  mapping: StageMapping;
  stages: Record<string, StageStatus>;
  onSuggest?: (cmd: string) => Promise<string | null>;
}

export const NextCommand: React.FC<Props> = ({ stage, mapping, stages, onSuggest }) => {
  const [nextCmd, setNextCmd] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const pushToast = useToastStore((s) => s.push);

  // 建议命令计算：先看当前阶段自身是否完成，
  // 未完成 → 推进自己；已完成 → 才考虑下游 / review。
  React.useEffect(() => {
    if (!onSuggest) return;
    setLoading(true);
    const status = stages[stage]?.status;
    if (status && status !== 'completed') {
      // 当前阶段还没完成：建议直接推进本阶段（review 是完成后才做的事）
      const ownCmd = STAGE_TABLE[stage as keyof typeof STAGE_TABLE]?.command;
      setNextCmd(ownCmd && ownCmd.startsWith('/yxspec:') ? ownCmd : '（无下游，建议收口或人工决断）');
      setLoading(false);
      return;
    }
    onSuggest(stage)
      .then((cmd) => setNextCmd(cmd || '（无下游，建议收口或人工决断）'))
      .finally(() => setLoading(false));
  }, [stage, onSuggest, stages]);

  const handleFill = () => {
    if (!nextCmd) return;
    pushToast(
      'info',
      `已推荐命令：${nextCmd}（受受限链式调用约束，需手动确认执行）`,
    );
    // 复制到剪贴板（浏览器模式兜底方案）
    if (navigator.clipboard) {
      navigator.clipboard.writeText(nextCmd).catch(() => {});
    }
  };

  // 一键派活：把建议命令 POST 到网关 /api/agent，走完整 agent 编排。
  // 网关 resolveStage 按 stage.command 精确命中 → 门控检查 → 驱动 agent 生成产物。
  // 派活过程/结果回填到全局对话流（终端对话框实时可见）。
  const handleDispatch = async () => {
    if (!nextCmd || sending) return;
    const pushUser = useChatStore.getState().pushUser;
    const pushAssistant = useChatStore.getState().pushAssistant;
    setSending(true);
    pushToast('info', `🚀 派活：${nextCmd}`);
    // 回填到对话区：用户命令
    pushUser(nextCmd);
    try {
      // 回填到对话区：进展中
      pushAssistant(`🚀 正在推进阶段 agent（${nextCmd}），生成产物需 3-5 分钟…`);
      const sid = useStageStore.getState().sessionId;
      const realSid = sid && sid.startsWith('bcm-') ? sid : undefined; // 避免传占位 "bcm"
      const modelId = useModelStore.getState().defaultModelId || undefined;
      const data = await ipc.runAgent(nextCmd, {
        system: '你是 yxspec 车载嵌入式 ASPICE 流程助理，回复简洁准确。',
        sessionId: realSid,
        model: modelId,
      });
      if (data?.error && data.final_response === undefined) {
        throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      }
      const sessionId: string | null = data?.session_id || null;
      if (sessionId) {
        useStageStore.setState({ sessionId });
        // 订阅刚创建的 session 事件流，让驾驶舱/看板实时点亮
        const projectPath = useProjectStore.getState().current?.path;
        if (projectPath) {
          await useStageStore
            .getState()
            .connectEvents(projectPath)
            .catch((e) => console.warn('[NextCommand] connectEvents 失败:', e));
        }
      }
      const blocked = data?.finish_reason === 'blocked';
      if (blocked) {
        // 门控拦截：列出未完成的上游阶段
        const upstream = (data?.gate?.upstream && typeof data.gate.upstream === 'object')
          ? Object.entries(data.gate.upstream)
              .filter(([, v]) => !v)
              .map(([k]) => k)
              .join('、')
          : '';
        const msg = `⛔ 门控拦截：${data?.gate?.message || '上游未完成'}` + (upstream ? `，先完成上游：${upstream}` : '');
        pushToast('warn', msg);
        pushAssistant(msg);
      } else {
        const msg = `✅ 派活完成（${data?.finish_reason || 'completed'}）`;
        pushToast('success', msg);
        pushAssistant(msg + (data?.final_response ? `\n\n${data.final_response}` : ''));
      }
    } catch (e: any) {
      const msg = `⚠️ 派活失败：${e?.message || e}`;
      pushToast('error', msg);
      pushAssistant(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-300">
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <span>📍 当前阶段：</span>
        <strong className="font-mono">{stage}</strong>
        <span className="text-xs text-gray-500 ml-2">({mapping.aspice})</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-700 mt-2">
        <span>💡 建议下一步：</span>
        {loading ? (
          <span className="text-gray-400">计算中…</span>
        ) : (
          <strong className="font-mono text-blue-700">{nextCmd}</strong>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors disabled:opacity-50"
          onClick={handleFill}
          disabled={!nextCmd || loading}
        >
          复制到剪贴板
        </button>
        <button
          className="px-3 py-1 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
          onClick={handleDispatch}
          disabled={!nextCmd || loading || sending}
          title="直接经网关驱动当前阶段 agent 执行（门控通过才放行）"
        >
          {sending ? '🚀 执行中…' : '🚀 一键派活'}
        </button>
        <span className="text-xs text-gray-500">
          ⚠️ 受限链式调用：推荐命令，需确认后执行
        </span>
      </div>
    </div>
  );
};