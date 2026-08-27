// =============================================================================
// useStageDispatch — 一键派活共享逻辑（NextCommand + StageNode 卡片共用）
// 从 NextCommand.handleDispatch 抽出，行为逐字对齐：
//   POST 网关 /api/agent（复用常驻 harness session，bcm- 前缀才传）
//   → 门控检查（blocked 时列出未完成上游 / 轨迹证据打回时带 reason）
//   → 结果/进展回填全局对话流（chatStore.pushUser/pushAssistant）
//   → 新 session 建立后订阅 SSE 事件流，让驾驶舱/看板实时点亮
//   → 门控打回（trajectory-* / no-trajectory）同步 stageStore 的 gate_reason，
//     驾驶舱徽标联动展示打回原因
// 返回：'blocked' | 'completed' | 'error' | false（false=未发起：命令为空或已在派活）
// 终止：cancel() 走网关 /api/agent/abort 杀 runtime，派活中的 turn 会抛错 → 显示"已取消"
// =============================================================================

import React from 'react';
import * as ipc from '../utils/ipc';
import { useToastStore } from '../store/toastStore';
import { useStageStore } from '../store/stageStore';
import { useProjectStore } from '../store/projectStore';
import { useChatStore } from '../store/chatStore';
import { useModelStore } from '../store/modelStore';
import type { StageToken } from '../data/types';

export type DispatchResult = 'blocked' | 'completed' | 'error';

/** 门控打回 reason → 徽标提示文案（Phase 2 徽标联动：展示打回原因）。 */
const GATE_REASON_TEXT: Record<string, string> = {
  'trajectory-blocked': '轨迹证据 blocked：上次执行失败/中断，已打回',
  'no-trajectory': '无轨迹证据：该阶段从未执行过，已打回',
  'artifact-passed-no-trajectory': '产物已存在但无轨迹证据，已打回',
  'trajectory-unverified': '轨迹证据不完整（unverified），已放行',
  'upstream-blocked': '上游阶段未完成',
  'artifact-missing': '产物缺失',
};

export function useStageDispatch() {
  const pushToast = useToastStore((s) => s.push);
  const [sending, setSending] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [dispatchingCmd, setDispatchingCmd] = React.useState<string | null>(null);
  // 已执行秒数（轮询期间递增，UI 显示"已执行 N 秒"）
  const [elapsedSec, setElapsedSec] = React.useState(0);
  // 同步锁：防止同实例连续点击触发并发派活（state 更新是异步的，ref 立即可见）
  const sendingRef = React.useRef(false);
  // 取消标记：cancel() 置位后，轮询循环提前退出并显示"已取消"
  const cancelRequestedRef = React.useRef(false);
  // 轮询计时器句柄（finish 清理）
  const tickRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const startTicker = React.useCallback(() => {
    stopTicker();
    setElapsedSec(0);
    tickRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
  }, []);
  const stopTicker = React.useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // 终止本轮派活：走网关 /api/agent/abort 杀 runtime。
  // 后端 abort 会把关联任务置 done(aborted)，轮询因此能拿到 aborted 终态。
  // abort 请求加短超时：若网关无响应（挂了），也立即结束轮询，不空转到 20 分钟。
  const cancel = React.useCallback(async () => {
    if (!sendingRef.current) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    const sessionId = useStageStore.getState().sessionId || undefined;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      await fetch(`${ipc.GATEWAY_BASE}/api/agent/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
        signal: ctrl.signal,
      });
    } catch (e) {
      // 网关无响应：轮询也会失败，标记取消后 dispatch 的 finally 会清理
      console.warn('[useStageDispatch] abort 请求失败:', e);
    } finally {
      clearTimeout(t);
    }
    // 派活中的 turn 因 runtime 被杀报错 → runAndEmit 置 blocked/aborted，轮询拿到终态
  }, []);

  const dispatch = React.useCallback(
    async (command: string): Promise<DispatchResult | false> => {
      if (!command || sendingRef.current) return false;
      sendingRef.current = true;
      cancelRequestedRef.current = false;
      setSending(true);
      setCancelling(false);
      setDispatchingCmd(command);
      const pushUser = useChatStore.getState().pushUser;
      const pushAssistant = useChatStore.getState().pushAssistant;
      pushToast('info', `派活：${command}`);
      // 回填到对话区：用户命令
      pushUser(command);
      try {
        // 回填到对话区：进展中
        pushAssistant(`正在推进阶段 agent（${command}），生成产物需 3-5 分钟…`);
        const sid = useStageStore.getState().sessionId;
        const realSid = sid && sid.startsWith('bcm-') ? sid : undefined; // 避免传占位 "bcm"
        const modelId = useModelStore.getState().defaultModelId || undefined;
        const data = await ipc.runAgent(command, {
          system: ipc.YXSPEC_SYSTEM_PROMPT,
          sessionId: realSid,
          model: modelId,
        });
        if (data?.error && data.final_response === undefined) {
          throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
        }
        // 后端 202 后台任务 → 轮询到终态；否则是门控拦截等即时结果
        const sessionId: string | null = data?.session_id || null;
        if (data?.task_id) {
          // 后台任务：拿到 session 后先订阅，再轮询等终态（期间可 cancel）
          const projectPath = useProjectStore.getState().current?.path;
          if (sessionId) {
            useStageStore.setState({ sessionId });
            // 持久化 sessionId（按项目隔离，刷新后恢复）
            ipc.setStoredSessionId(projectPath || '', sessionId);
          }
          startTicker(); // 已执行秒数开始计时
          if (projectPath) {
            await useStageStore
              .getState()
              .connectEvents(projectPath)
              .catch((e) => console.warn('[useStageDispatch] connectEvents 失败:', e));
          }
          const task = await ipc.pollTask(data.task_id as string, {
            timeoutMs: 20 * 60 * 1000, // 长阶段最多 20 分钟
            shouldStop: () => cancelRequestedRef.current, // 取消 → 立即停止轮询
            onPoll: () => {}, // elapsedSec 已由 startTicker 独立计时，无需在此刷新
          });
          if (cancelRequestedRef.current) {
            const msg = '已取消本轮派活';
            pushToast('info', msg);
            pushAssistant(msg);
            return 'error';
          }
          if (!task) {
            const msg = '派活失败：任务超时或网关已重启（任务丢失），请重试';
            pushToast('error', msg);
            pushAssistant(msg);
            return 'error';
          }
          if (data?.warning) {
            pushToast('warn', data.warning);
            pushAssistant(data.warning);
          }
          return await handleTaskResult(task, pushToast, pushAssistant);
        }
        // 门控拦截等即时结果：直接处理
        return await handleTaskResult(
          { status: 'done', task_id: '', session_id: null, result: data, error: null, created_at: '' },
          pushToast,
          pushAssistant,
        );
      } catch (e: any) {
        if (cancelRequestedRef.current) {
          const msg = '已取消本轮派活';
          pushToast('info', msg);
          pushAssistant(msg);
        } else {
          const msg = `派活失败：${e?.message || e}`;
          pushToast('error', msg);
          pushAssistant(msg);
        }
        return 'error';
      } finally {
        stopTicker();
        sendingRef.current = false;
        cancelRequestedRef.current = false;
        setSending(false);
        setCancelling(false);
        setDispatchingCmd(null);
      }
    },
    [pushToast],
  );

  // 卸载时清理计时器
  React.useEffect(() => () => stopTicker(), []);

  return { dispatch, cancel, sending, cancelling, dispatchingCmd, elapsedSec };
}

/** 把任务终态（或即时结果）转成对话区反馈 + toast。返回 DispatchResult。 */
async function handleTaskResult(
  t: { status: string; result: any; [k: string]: any },
  pushToast: (lvl: 'info' | 'success' | 'warn' | 'error', text: string) => void,
  pushAssistant: (content: string) => void,
): Promise<DispatchResult> {
  const data = t?.result;
  if (!data) {
    const msg = '派活失败：网关未返回有效结果';
    pushToast('error', msg);
    pushAssistant(msg);
    return 'error';
  }
  // 门控拦截（上游阻塞 / 轨迹证据打回）：
  // reason 字段区分两类——upstream-blocked 是传统上游未完成；
  // trajectory-blocked / no-trajectory / artifact-passed-no-trajectory 是
  // Phase 2 派活前门控打回（驾驶舱徽标联动展示 reason）。
  if (data.finish_reason === 'blocked') {
    const reason: string | undefined =
      typeof data.reason === 'string' ? data.reason : undefined;
    const isTrajectoryReject =
      reason === 'trajectory-blocked' ||
      reason === 'no-trajectory' ||
      reason === 'artifact-passed-no-trajectory';
    // 徽标联动：把打回原因写进 stageStore（StageNode 徽标 title/文案读取）
    if (isTrajectoryReject && typeof data?.stage === 'string') {
      useStageStore.setState((s) => ({
        stages: {
          ...s.stages,
          [data.stage as StageToken]: {
            ...(s.stages[data.stage as StageToken] ?? {
              token: data.stage,
              status: 'pending' as const,
              artifacts: [],
              review: null,
              last_update: '',
              message: '',
            }),
            gate_reason: reason,
          },
        },
      }));
    }
    const reasonText = reason ? GATE_REASON_TEXT[reason] || `门控拦截：${reason}` : '';
    const upstream =
      data?.gate?.upstream && typeof data.gate.upstream === 'object'
        ? Object.entries(data.gate.upstream)
            .filter(([, v]) => !v)
            .map(([k]) => k)
            .join('、')
        : '';
    const msg = reasonText || `门控拦截：${data?.gate?.message || '上游未完成'}` + (upstream ? `，先完成上游：${upstream}` : '');
    pushToast(isTrajectoryReject ? 'error' : 'warn', msg);
    pushAssistant(msg);
    return 'blocked';
  }
  // 用户取消
  if (data.finish_reason === 'aborted') {
    const msg = '已取消本轮派活';
    pushToast('info', msg);
    pushAssistant(msg);
    return 'error';
  }
  // 正常完成（completed / error）
  const msg = `派活完成（${data?.finish_reason || 'completed'}）`;
  pushToast('success', msg);
  pushAssistant(msg + (data?.final_response ? `\n\n${data.final_response}` : ''));
  return 'completed';
}
