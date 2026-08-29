// @vitest-environment node
// =============================================================================
// stageStore.ts 纯逻辑单测（成本静默刷新 loadCostSilent 语义）
// 只测无 DOM 的派生逻辑：loadCostSilent 拿到新数据才更新、失败保持现有数据。
// 通过 mock 全局 fetch 验证 set 行为，不渲染组件、不连真实网关。
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStageStore } from './stageStore';
import type { CostData } from '../utils/ipc';

function cost(runs: number): CostData {
  return {
    perStage: [],
    totals: { runs, elapsedMs: 0, promptTokens: 0, completionTokens: 0, toolCalls: 0 },
    pricePerMillion: { input: 0, output: 0 },
    hasTokenData: false,
    trend: [],
    note: 'test',
  };
}

describe('loadCostSilent（成本静默刷新：拿到才更新，失败保持）', () => {
  // 每个用例前重置 store + fetch mock，隔离测试
  beforeEach(() => {
    useStageStore.setState({ costData: null });
    vi.restoreAllMocks();
  });

  it('成功 → 更新 costData（turn/end 结算后角标数字刷新）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => cost(7) }),
    );
    await useStageStore.getState().loadCostSilent();
    expect(useStageStore.getState().costData?.totals.runs).toBe(7);
  });

  it('失败（fetch 抛错/网络抖动）→ 保持现有 costData，不置 null（UI 不闪空态）', async () => {
    // 预置一份已加载的成本数据（模拟项目打开时 loadCost 的旧数字）
    useStageStore.setState({ costData: cost(3) });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await useStageStore.getState().loadCostSilent();
    expect(useStageStore.getState().costData?.totals.runs).toBe(3);
  });

  it('失败（HTTP 非 2xx）→ 同样保持现有 costData', async () => {
    useStageStore.setState({ costData: cost(5) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await useStageStore.getState().loadCostSilent();
    expect(useStageStore.getState().costData?.totals.runs).toBe(5);
  });

  it('响应 null（网关未起返回 null）→ 保持现有 costData', async () => {
    useStageStore.setState({ costData: cost(9) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
    await useStageStore.getState().loadCostSilent();
    expect(useStageStore.getState().costData?.totals.runs).toBe(9);
  });
});
