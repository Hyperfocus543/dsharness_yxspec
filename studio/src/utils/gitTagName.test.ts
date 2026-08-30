// @vitest-environment node
// =============================================================================
// gitTagName.ts 纯逻辑单测（yxspec 阶段收尾 tag 可读化派生）
// 只测无 DOM 的导出函数 parseYxspecTag / stageTagLabel / stageAspiceName /
// stageTagSummary / yxspecTagOf。不渲染组件、不连网关。
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  parseYxspecTag,
  stageTagLabel,
  stageAspiceName,
  stageTagSummary,
  yxspecTagOf,
} from './gitTagName';

describe('parseYxspecTag（解析 yxspec/<stage>/<seq>）', () => {
  it('标准留痕 tag → 结构化信息', () => {
    expect(parseYxspecTag('yxspec/swe_arch/7')).toEqual({
      stage: 'swe_arch',
      seq: 7,
      full: 'yxspec/swe_arch/7',
      commit: null,
    });
  });

  it('变体阶段 token 完整保留（swe_coding_verify_pc ≠ swe_coding_verify）', () => {
    const info = parseYxspecTag('yxspec/swe_coding_verify_pc/3');
    expect(info?.stage).toBe('swe_coding_verify_pc');
    expect(info?.seq).toBe(3);
  });

  it('非 yxspec 留痕 tag（v1.0 / 用户自定义）→ null（不误读）', () => {
    expect(parseYxspecTag('v1.0')).toBeNull();
    expect(parseYxspecTag('release/2026')).toBeNull();
    expect(parseYxspecTag('yxspec/')).toBeNull();
  });

  it('宽容：空 / 非字符串 / seq 非法 → null', () => {
    expect(parseYxspecTag(null)).toBeNull();
    expect(parseYxspecTag(undefined)).toBeNull();
    expect(parseYxspecTag('')).toBeNull();
    expect(parseYxspecTag('  ')).toBeNull();
    expect(parseYxspecTag('yxspec/swe_arch/')).toBeNull();
    expect(parseYxspecTag('yxspec/swe_arch/abc')).toBeNull();
    expect(parseYxspecTag('yxspec//3')).toBeNull();
  });
});

describe('stageTagLabel（短标签）', () => {
  it('留痕 tag → 剥 yxspec/ 前缀 + 版本化 seq', () => {
    expect(stageTagLabel('yxspec/swe_arch/7')).toBe('swe_arch/7');
  });

  it('非留痕 tag → 原样返回（不误读）', () => {
    expect(stageTagLabel('v1.0')).toBe('v1.0');
    expect(stageTagLabel('yxspec/')).toBe('yxspec/');
  });

  it('空 / 缺省 → 空串', () => {
    expect(stageTagLabel(null)).toBe('');
    expect(stageTagLabel(undefined)).toBe('');
    expect(stageTagLabel('')).toBe('');
  });
});

describe('stageAspiceName（阶段显示名）', () => {
  it('STAGE_TABLE 已知 token → ASPICE 编号', () => {
    expect(stageAspiceName('swe_arch')).toBe('SWE.2');
    expect(stageAspiceName('swe_coding_verify_pc')).toBe('SWE.4');
    expect(stageAspiceName('sqt_auto_test')).toBe('SYS.5/SUP.8');
  });

  it('未知 token（老/扩展阶段）→ 原始 stage 兜底', () => {
    expect(stageAspiceName('future_stage')).toBe('future_stage');
  });
});

describe('stageTagSummary（人类可读摘要）', () => {
  it('已知阶段 → ASPICE + token + 序号', () => {
    const info = parseYxspecTag('yxspec/swe_coding_verify_pc/3');
    expect(info).not.toBeNull();
    expect(stageTagSummary(info!)).toBe('SWE.4 swe_coding_verify_pc #3 · 阶段收尾 tag');
  });

  it('未知阶段 → 原始 token 兜底', () => {
    const info = parseYxspecTag('yxspec/legacy_stage/2');
    expect(info).not.toBeNull();
    expect(stageTagSummary(info!)).toBe('legacy_stage legacy_stage #2 · 阶段收尾 tag');
  });
});

describe('yxspecTagOf（记录/留痕级摘要）', () => {
  it('轨迹行带 tag + tagCommit → 短标签 + 摘要 + 指向 commit', () => {
    const out = yxspecTagOf({
      tag: 'yxspec/swe_arch/7',
      tagCommit: 'c3ef981c13968500843d78982364f5544765245f',
      commit: 'c3ef981',
    });
    expect(out?.short).toBe('swe_arch/7');
    expect(out?.summary).toBe('SWE.2 swe_arch #7 · 阶段收尾 tag');
    expect(out?.commit).toBe('c3ef981c13968500843d78982364f5544765245f');
  });

  it('留痕（无 tagCommit）→ commit 回落短 hash', () => {
    const out = yxspecTagOf({ tag: 'yxspec/sqt_tr/4', commit: 'abc1234' });
    expect(out?.short).toBe('sqt_tr/4');
    expect(out?.commit).toBe('abc1234');
  });

  it('非留痕 tag / 无 tag → null（调用方不渲染增强行）', () => {
    expect(yxspecTagOf({ tag: 'v1.0' })).toBeNull();
    expect(yxspecTagOf({ tag: null })).toBeNull();
    expect(yxspecTagOf(null)).toBeNull();
    expect(yxspecTagOf(undefined)).toBeNull();
  });
});
