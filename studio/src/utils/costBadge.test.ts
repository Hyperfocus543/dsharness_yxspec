// @vitest-environment node
// =============================================================================
// costBadge.ts 纯逻辑单测（驾驶舱「本周成本」角标聚合）
// 只测无 DOM 的导出函数：日口径 / 7 天合计 / 趋势方向 / 文案。
// 不渲染组件（vitest 默认 node 环境，无 jsdom）。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  dayMetric,
  weekTotal,
  weekTrend,
  badgeLabel,
  weekSummary,
  trendSuffix,
  weekEstCost,
  estCostLabel,
} from './costBadge';
import type { CostTrendDay } from './ipc';

function day(partial: Partial<CostTrendDay>): CostTrendDay {
  return {
    date: '2026-08-29',
    runs: 0,
    elapsedMs: 0,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    ...partial,
  };
}

describe('dayMetric（单日口径：token 可用 → token，否则 → 执行次数）', () => {
  it('token 口径 = prompt + completion', () => {
    const d = day({ promptTokens: 1200, completionTokens: 300, runs: 7 });
    expect(dayMetric(d, true)).toBe(1500);
  });

  it('无 token 数据 → 用执行次数', () => {
    const d = day({ promptTokens: 1200, completionTokens: 300, runs: 7 });
    expect(dayMetric(d, false)).toBe(7);
  });
});

describe('weekTotal（近 7 天合计）', () => {
  it('token 口径累加 prompt+completion', () => {
    const trend = [
      day({ promptTokens: 100, completionTokens: 50 }),
      day({ promptTokens: 200, completionTokens: 50 }),
    ];
    expect(weekTotal(trend, true)).toBe(400);
  });

  it('无 token 数据 → 累加执行次数', () => {
    const trend = [day({ runs: 3 }), day({ runs: 4 })];
    expect(weekTotal(trend, false)).toBe(7);
  });

  it('空数组 → 0（角标不渲染分支）', () => {
    expect(weekTotal([], true)).toBe(0);
    expect(weekTotal([], false)).toBe(0);
  });
});

describe('weekTrend（近 3 天 vs 前 3 天，±5% 内持平）', () => {
  it('无趋势数据 → flat（不误报涨跌）', () => {
    expect(weekTrend([], true)).toBe('flat');
    // 只有一侧（不足 3 天）→ flat
    expect(weekTrend([day({ runs: 1 }), day({ runs: 2 })], false)).toBe('flat');
  });

  it('近段走高 → up', () => {
    const trend = [
      day({ runs: 10 }), day({ runs: 12 }), day({ runs: 11 }), // 近 3 天（倒序 0-2）
      day({ runs: 2 }), day({ runs: 3 }), day({ runs: 3 }), // 前 3 天（3-5）
    ];
    expect(weekTrend(trend, false)).toBe('up');
  });

  it('近段回落 → down', () => {
    const trend = [
      day({ runs: 1 }), day({ runs: 2 }), day({ runs: 1 }),
      day({ runs: 10 }), day({ runs: 11 }), day({ runs: 12 }),
    ];
    expect(weekTrend(trend, false)).toBe('down');
  });

  it('±5% 内 → flat（避免微小波动渲染成涨跌）', () => {
    const trend = [
      day({ runs: 10 }), day({ runs: 10 }), day({ runs: 10 }),
      day({ runs: 10 }), day({ runs: 10 }), day({ runs: 10 }),
    ];
    expect(weekTrend(trend, false)).toBe('flat');
  });

  it('任一/两侧全 0 → flat（0 除保护）', () => {
    const trend = [
      day({ runs: 0 }), day({ runs: 0 }), day({ runs: 0 }),
      day({ runs: 0 }), day({ runs: 0 }), day({ runs: 0 }),
    ];
    expect(weekTrend(trend, false)).toBe('flat');
  });

  it('token 口径同规则', () => {
    const trend = [
      day({ promptTokens: 900 }), day({ promptTokens: 1000 }), day({ promptTokens: 1100 }),
      day({ promptTokens: 300 }), day({ promptTokens: 400 }), day({ promptTokens: 500 }),
    ];
    expect(weekTrend(trend, true)).toBe('up');
  });
});

describe('badgeLabel / weekSummary（角标文案）', () => {
  it('千分位格式化', () => {
    expect(badgeLabel(1234567, true)).toBe('1,234,567');
    expect(badgeLabel(0, true)).toBe('0');
  });

  it('weekSummary 带口径单位', () => {
    expect(weekSummary(1200, true)).toBe('近 7 天 token：1,200 tok');
    expect(weekSummary(12, false)).toBe('近 7 天执行次数：12 次');
  });

  it('trendSuffix 给中文说明', () => {
    expect(trendSuffix('up')).toBe('↑ 较前段走高');
    expect(trendSuffix('down')).toBe('↓ 较前段回落');
    expect(trendSuffix('flat')).toBe('＝ 与前段持平');
  });
});

describe('weekEstCost / estCostLabel（近 7 天费用估算）', () => {
  const PRICE = { input: 10, output: 30 }; // ¥/百万 token（与 CostDashboard 口径一致）

  it('按 prompt/completion 各自单价折算求和', () => {
    const trend = [
      day({ promptTokens: 1_000_000, completionTokens: 500_000 }),
      day({ promptTokens: 0, completionTokens: 500_000 }),
    ];
    // 输入：1M → ¥10；输出：1M → ¥30；合计 ¥40
    expect(weekEstCost(trend, PRICE)).toBe(40);
  });

  it('空 trend / 空单价 → null（不估算）', () => {
    expect(weekEstCost([], PRICE)).toBe(0); // 无记录日 → 0 元（非 null：单价已配置）
    expect(weekEstCost(undefined, PRICE)).toBe(0);
    expect(weekEstCost([day({ promptTokens: 1 }), day({ completionTokens: 1 })], null)).toBeNull();
    expect(weekEstCost([day({ promptTokens: 1 })], undefined)).toBeNull();
    expect(weekEstCost([day({ promptTokens: 1 })], { input: 0, output: 0 })).toBeNull();
  });

  it('无 token 数据（账本无 usage）→ 0 元（token 列恒 0，与 CostDashboard 同口径）', () => {
    const trend = [day({ runs: 5 }), day({ runs: 3 })];
    expect(weekEstCost(trend, PRICE)).toBe(0);
  });

  it('金额文案：¥ + toFixed(4)；null → —', () => {
    expect(estCostLabel(40)).toBe('¥40.0000');
    expect(estCostLabel(0)).toBe('¥0.0000');
    expect(estCostLabel(null)).toBe('—');
    expect(estCostLabel(undefined)).toBe('—');
  });
});
