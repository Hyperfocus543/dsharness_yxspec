// =============================================================================
// useAgentChat — 对话派活逻辑（全局面板 + 执行终端共用）
// 封装：连接状态检查、agent/chat 双模式、session 复用、派活、取消、错误处理。
// 让"对话驱动"成为一等公民：任意界面都能派活给真模型。
// =============================================================================

import React from 'react';
import * as ipc from '../utils/ipc';
import { useProjectStore } from '../store/projectStore';
import { useStageStore } from '../store/stageStore';
import { useChatStore } from '../store/chatStore';
import { useModelStore } from '../store/modelStore';
import type { ChatItem } from '../store/chatStore';

export type ChatMode = 'agent' | 'chat';

const GATEWAY_URL = ipc.GATEWAY_BASE;

export function useAgentChat() {
  const [prompt, setPrompt] = React.useState('');
  // 对话真相源：全局 chatStore（终端对话框 + 一键派活共享）
  const chat = useChatStore((s) => s.chat);
  const pushUser = useChatStore((s) => s.pushUser);
  const pushAssistant = useChatStore((s) => s.pushAssistant);
  const pushSystem = useChatStore((s) => s.pushSystem);
  const [loading, setLoading] = React.useState(false);
  const [connState, setConnState] = React.useState<'checking' | 'ok' | 'err'>('checking');
  const [mode, setMode] = React.useState<ChatMode>('agent');
  // 快速对话可用性：网关 501(not_implemented)=未实现 → 前端隐藏快速按钮
  const [chatUnavailable, setChatUnavailable] = React.useState(false);
  // 取消本轮标记：cancel() 置位后，send() 的 catch 不再报原始错误，改报"已取消"
  const cancelRef = React.useRef(false);

  // 健康检查：Track B 网关暴露 /health（server.mjs）
  React.useEffect(() => {
    let cancelled = false;
    fetch(`${GATEWAY_URL}/health`)
      .then((r) => {
        if (!cancelled) setConnState(r.ok ? 'ok' : 'err');
      })
      .catch(() => {
        if (!cancelled) setConnState('err');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 快速对话可用性探测：POST /api/chat 网关返回 501 → 未实现，隐藏快速按钮。
  // 网关未起/网络错误时保持 unknown（不隐藏，用户仍可用 Agent 模式）。
  React.useEffect(() => {
    let cancelled = false;
    fetch(`${GATEWAY_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then((r) => {
        if (!cancelled) setChatUnavailable(r.status === 501);
      })
      .catch(() => {
        // 网关未起：不设置，保留 unknown
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    pushUser(content);
    setPrompt('');
    setLoading(true);
    cancelRef.current = false;
    let reply = '';
    let extra = '';
    try {
      if (mode === 'agent') {
        // agent 模式：走网关 /api/agent，复用常驻 harness session，事件实时广播给驾驶舱
        // 只传真实 session（bcm- 前缀）；占位 "bcm"（SSE 默认值）会让网关复用死 session → 空回复
        const sid = useStageStore.getState().sessionId;
        const realSid = sid && sid.startsWith('bcm-') ? sid : undefined;
        const modelId = useModelStore.getState().defaultModelId || undefined;
        const data = await ipc.runAgent(content, {
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
          const projectPath = useProjectStore.getState().current?.path || '';
          await useStageStore
            .getState()
            .connectEvents(projectPath)
            .catch((e) => console.warn('[useAgentChat] connectEvents 失败:', e));
        }
        reply = data?.final_response || '(空回复)';
        extra = data?.error ? `\n\n⚠️ agent 诊断: ${JSON.stringify(data.error)}` : '';
      } else {
        // chat 模式：直连网关快速对话（网关 501 = 未实现）
        const res = await fetch(`${GATEWAY_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: content,
            system: '你是 yxspec 车载嵌入式 ASPICE 流程助理，回复简洁准确。',
            max_tokens: 512,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (res.status === 501 || data?.error === 'not_implemented') {
            setChatUnavailable(true);
            setMode('agent');
            throw new Error(data?.message || '快速对话模式未实现，请使用 Agent 模式');
          }
          throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
        }
        reply = data?.reply || '(空回复)';
      }
      pushAssistant(reply + extra);
    } catch (e: any) {
      if (cancelRef.current) {
        pushAssistant('已取消本轮执行');
      } else {
        pushAssistant(`⚠️ 网关调用失败: ${e?.message || e}`);
      }
    } finally {
      setLoading(false);
      cancelRef.current = false;
    }
  };

  const handleSend = () => send(prompt);

  /**
   * 取消本轮：置位取消标记 + 请求网关 /api/agent/abort 杀 runtime，并立刻结束 loading。
   * 当前在跑的 turn 会因 runtime 进程被杀而报错，由 send() 的 catch 显示"已取消本轮执行"。
   */
  const cancel = async () => {
    if (!loading) return;
    cancelRef.current = true;
    setLoading(false);
    const sessionId = useStageStore.getState().sessionId || undefined;
    try {
      await fetch(`${GATEWAY_URL}/api/agent/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch (e) {
      console.warn('[useAgentChat] abort 请求失败:', e);
    }
  };

  return {
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
  };
}
