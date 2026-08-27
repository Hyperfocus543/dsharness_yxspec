// =============================================================================
// gatewayStore — 网关连接状态（全局唯一探活源）
// 网关探活原埋在 useAgentChat 内部，只在执行终端可见；驾驶舱/成本/周报/插件
// 页全依赖网关却无任何可见状态，网关掉线时 SSE 静默断连、界面毫无提示。
// 本 store 把探活提升为全局：header 常驻指示条 + 执行终端共用同一状态源。
// 契约：GET <GATEWAY_BASE>/health（server.mjs）；CORS 已放行。
// 设计：
//   - 定时探活（默认 8s，与 useAgentChat 旧行为一致；可传 intervalMs 覆盖）
//   - 三态：checking（首次探测中）/ ok / err
//   - 只保留上一次成功时间，供指示条 tooltip 展示「最近连通」；失败不保留
// =============================================================================

import { create } from 'zustand';
import { GATEWAY_BASE } from '../utils/ipc';

export type GatewayConnState = 'checking' | 'ok' | 'err';

interface GatewayStore {
  connState: GatewayConnState;
  /** 最近一次探测成功的时间（ISO）；从未连通过为 null */
  lastOkAt: string | null;
  /** 立即探活一次并更新状态（幂等，可随时调用） */
  check: () => Promise<boolean>;
  /** 启动定时探活；返回停止函数（组件卸载时调用）。重复调用会先停旧的。 */
  start: (intervalMs?: number) => () => void;
}

let timer: ReturnType<typeof setInterval> | null = null;

async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${GATEWAY_BASE}/health`, {
      signal: AbortSignal.timeout(4000),
      // 探活不带缓存：避免浏览器缓存 /health 的 200，让状态实时反映网关存活
      cache: 'no-store',
    });
    return r.ok;
  } catch {
    return false;
  }
}

export const useGatewayStore = create<GatewayStore>((set, get) => ({
  connState: 'checking',
  lastOkAt: null,
  check: async () => {
    const ok = await ping();
    set((s) =>
      ok
        ? { connState: 'ok', lastOkAt: new Date().toISOString() }
        : { ...s, connState: 'err' },
    );
    return ok;
  },
  start: (intervalMs = 8000) => {
    if (timer) clearInterval(timer);
    // 启动即探测一次（不等首个间隔）
    get().check();
    timer = setInterval(() => {
      get().check();
    }, intervalMs);
    return () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  },
}));
