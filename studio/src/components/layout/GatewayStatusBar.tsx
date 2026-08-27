// =============================================================================
// GatewayStatusBar — 网关连接状态指示条（header 常驻）
// 三态：checking（探测中，灰）/ ok（在线，绿）/ err（掉线，红）。
// 点击整条立即重探测（网关重启/换绑后无需等下一个定时周期）。
// 数据源：gatewayStore（全局唯一探活源，LLMConsole 终端状态同源）。
// a11y：role="status" aria-live="polite" —— 连接状态变化读屏自动播报。
// =============================================================================

import React from 'react';
import { useGatewayStore } from '../../store/gatewayStore';
import { Icon, StatusDot } from '../ui';
import { I } from '../ui/icons';
import { GATEWAY_BASE } from '../../utils/ipc';

export const GatewayStatusBar: React.FC = () => {
  const connState = useGatewayStore((s) => s.connState);
  const lastOkAt = useGatewayStore((s) => s.lastOkAt);
  const check = useGatewayStore((s) => s.check);

  const tone = connState === 'ok' ? 'ok' : connState === 'err' ? 'err' : 'idle';
  const label =
    connState === 'ok' ? '网关在线' : connState === 'err' ? '网关未连接' : '检查网关…';
  // tooltip：失败态提示启动方式；成功态显示最近连通时间（本地时间）
  const tip =
    connState === 'err'
      ? `执行网关不可达（${GATEWAY_BASE}）。请确认 gateway 已启动：cd gateway && node server.mjs`
      : connState === 'ok'
        ? `执行网关在线（${GATEWAY_BASE}）· 最近连通 ${lastOkAt ? new Date(lastOkAt).toLocaleTimeString() : '—'}`
        : `正在探测执行网关（${GATEWAY_BASE}）…`;

  return (
    <button
      type="button"
      role="status"
      aria-live="polite"
      className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-all active:scale-[0.98] ${
        connState === 'err'
          ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
          : connState === 'ok'
            ? 'bg-white border-zinc-200 text-zinc-600 hover:border-emerald-300 hover:bg-emerald-50/40'
            : 'bg-zinc-50 border-zinc-200 text-zinc-500'
      }`}
      onClick={() => check()}
      title={tip}
    >
      <StatusDot tone={tone} />
      <span className="hidden sm:inline">{label}</span>
      {/* 手动重探测（点击整条同效）：掉线时明确给出重试入口 */}
      {connState === 'err' && (
        <Icon name={I.refresh} size={12} weight="bold" className="shrink-0" />
      )}
    </button>
  );
};
