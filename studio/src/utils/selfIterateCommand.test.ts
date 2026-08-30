// @vitest-environment node
// =============================================================================
// selfIterateCommand.ts 纯逻辑单测（/yxspec:self-iterate 派活命令拼装）
// 只测无 DOM 的导出函数 buildSelfIterateCommand。不渲染组件。
// =============================================================================

import { describe, it, expect } from 'vitest';
import { buildSelfIterateCommand, buildSelfIteratePreview, clampMaxIterInput } from './selfIterateCommand';
import type { SelfIterateFormState, SelfIterateOptions } from './selfIterateCommand';

describe('buildSelfIterateCommand（/yxspec:self-iterate 派活命令拼装）', () => {
  it('stage 为空 → 返回 \'\'（调用方据此提示不派发）', () => {
    expect(buildSelfIterateCommand({ stage: '' })).toBe('');
  });

  it('stage 为纯空白 → 返回 \'\'', () => {
    expect(buildSelfIterateCommand({ stage: '   ' })).toBe('');
    expect(buildSelfIterateCommand({ stage: '\t\n ' })).toBe('');
  });

  it('仅 stage（下划线 token）→ `/yxspec:self-iterate <stage>`', () => {
    expect(buildSelfIterateCommand({ stage: 'sqt_script_gen' })).toBe('/yxspec:self-iterate sqt_script_gen');
  });

  it('仅 stage（连字符命令名也原样拼接，网关 resolveStageToken 会归一）', () => {
    expect(buildSelfIterateCommand({ stage: 'sqt-script-gen' })).toBe('/yxspec:self-iterate sqt-script-gen');
  });

  describe('maxIter', () => {
    it('缺省 → 不拼 --max-iter（网关默认 3）', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen' })).toBe('/yxspec:self-iterate sqt_script_gen');
    });

    it('=5 → 拼 ` --max-iter=5`', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', maxIter: 5 })).toBe(
        '/yxspec:self-iterate sqt_script_gen --max-iter=5',
      );
    });

    it('=0 → 钳到下限 1', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', maxIter: 0 })).toBe(
        '/yxspec:self-iterate sqt_script_gen --max-iter=1',
      );
    });

    it('=2.5 → floor 后拼 ` --max-iter=2`（对齐网关只认整数）', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', maxIter: 2.5 })).toBe(
        '/yxspec:self-iterate sqt_script_gen --max-iter=2',
      );
    });

    it('=99 → 钳到上限 10', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', maxIter: 99 })).toBe(
        '/yxspec:self-iterate sqt_script_gen --max-iter=10',
      );
    });

    it('NaN → 不拼（非有效数字）', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', maxIter: NaN })).toBe(
        '/yxspec:self-iterate sqt_script_gen',
      );
    });

    it('负数 → 钳到下限 1', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', maxIter: -3 })).toBe(
        '/yxspec:self-iterate sqt_script_gen --max-iter=1',
      );
    });
  });

  describe('goal', () => {
    it('含空格 → 拼 ` --goal="<goal>"`（保留空格，网关 flagVal 支持引号包裹多词值）', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', goal: 'Total>=80 且门禁全绿' })).toBe(
        '/yxspec:self-iterate sqt_script_gen --goal="Total>=80 且门禁全绿"',
      );
    });

    it('含 `"` → 转义为 `\\"`', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', goal: 'Total>=80 "全绿"' })).toBe(
        '/yxspec:self-iterate sqt_script_gen --goal="Total>=80 \\"全绿\\""',
      );
    });

    it('空 goal → 不拼', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', goal: '' })).toBe(
        '/yxspec:self-iterate sqt_script_gen',
      );
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', goal: '   ' })).toBe(
        '/yxspec:self-iterate sqt_script_gen',
      );
    });
  });

  describe('mode', () => {
    it('framework → 拼 ` --mode=framework`', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', mode: 'framework' })).toBe(
        '/yxspec:self-iterate sqt_script_gen --mode=framework',
      );
    });

    it('product → 不拼（网关默认评阶段产物）', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', mode: 'product' })).toBe(
        '/yxspec:self-iterate sqt_script_gen',
      );
    });

    it('undefined → 不拼', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen' })).toBe('/yxspec:self-iterate sqt_script_gen');
    });

    it('与 maxIter/goal/resume 组合 → 顺序为 max-iter → goal → mode → resume', () => {
      expect(
        buildSelfIterateCommand({
          stage: 'sqt_script_gen',
          maxIter: 5,
          goal: 'Total>=80 且门禁全绿',
          mode: 'framework',
          resume: true,
        }),
      ).toBe('/yxspec:self-iterate sqt_script_gen --max-iter=5 --goal="Total>=80 且门禁全绿" --mode=framework --resume');
    });
  });

  describe('resume', () => {
    it('true → 拼尾随 ` --resume`', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', resume: true })).toBe(
        '/yxspec:self-iterate sqt_script_gen --resume',
      );
    });

    it('false → 不拼', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen', resume: false })).toBe(
        '/yxspec:self-iterate sqt_script_gen',
      );
    });

    it('undefined → 不拼', () => {
      expect(buildSelfIterateCommand({ stage: 'sqt_script_gen' })).toBe('/yxspec:self-iterate sqt_script_gen');
    });
  });

  it('组合全参（stage+maxIter+goal+resume）→ 完整命令串', () => {
    const opts: SelfIterateOptions = {
      stage: 'sqt_script_gen',
      maxIter: 5,
      goal: 'Total>=80 且门禁全绿',
      resume: true,
    };
    expect(buildSelfIterateCommand(opts)).toBe(
      '/yxspec:self-iterate sqt_script_gen --max-iter=5 --goal="Total>=80 且门禁全绿" --resume',
    );
  });

  it('组合全参 + maxIter 钳制与 goal 转义 → 完整命令串', () => {
    expect(
      buildSelfIterateCommand({ stage: 'sqt-script-gen', maxIter: 99, goal: 'Total>=80 "全绿"', resume: true }),
    ).toBe('/yxspec:self-iterate sqt-script-gen --max-iter=10 --goal="Total>=80 \\"全绿\\"" --resume');
  });
});

describe('clampMaxIterInput（轮数输入归一，与派活钳制同口径）', () => {
  it('合法值原样返回', () => {
    expect(clampMaxIterInput('1')).toBe('1');
    expect(clampMaxIterInput('3')).toBe('3');
    expect(clampMaxIterInput('10')).toBe('10');
  });

  it('超上限 10 → 立即落回 10（避免输入 999 后需连删两次）', () => {
    expect(clampMaxIterInput('11')).toBe('10');
    expect(clampMaxIterInput('999')).toBe('10');
  });

  it('0 / 负数 → 1（轮数 0 无意义，派活时同样钳到 1）', () => {
    expect(clampMaxIterInput('0')).toBe('1');
    expect(clampMaxIterInput('-3')).toBe('1');
  });

  it('小数取整（与派活 Math.floor 同口径，3.5 不再被替换成 35）', () => {
    expect(clampMaxIterInput('3.5')).toBe('3');
    expect(clampMaxIterInput('2.9')).toBe('2');
  });

  it('空串 / 无数字 → 保持空（可清空重输，不强制回填）', () => {
    expect(clampMaxIterInput('')).toBe('');
    expect(clampMaxIterInput('abc')).toBe('');
    expect(clampMaxIterInput('   ')).toBe('');
  });

  it('数字前缀截取（e / 中文等混入时仍取前导数字）', () => {
    expect(clampMaxIterInput('5轮')).toBe('5');
    expect(clampMaxIterInput('3e2')).toBe('3');
  });
});

describe('buildSelfIteratePreview（启动表单实况 → 派活命令预览）', () => {
  const base: SelfIterateFormState = { stage: 'sqt_script_gen', maxIter: '3', goal: '', mode: 'product', resume: false };

  it('表单默认实况 → 基础命令（无 flag）', () => {
    expect(buildSelfIteratePreview(base)).toBe('/yxspec:self-iterate sqt_script_gen');
  });

  it('阶段为空 → 空串（预览降级提示，与启动按钮禁用态一致）', () => {
    expect(buildSelfIteratePreview({ ...base, stage: '' })).toBe('');
    expect(buildSelfIteratePreview({ ...base, stage: '   ' })).toBe('');
  });

  it('轮数串与 buildSelfIterateCommand 直接传数字同构（maxIter 5 → 拼 --max-iter=5）', () => {
    expect(buildSelfIteratePreview({ ...base, maxIter: '5' })).toBe('/yxspec:self-iterate sqt_script_gen --max-iter=5');
  });

  it('轮数空串 → 不拼（与表单未填走网关默认 3 同构）', () => {
    expect(buildSelfIteratePreview({ ...base, maxIter: '' })).toBe('/yxspec:self-iterate sqt_script_gen');
  });

  it('轮数超界串（999）→ 与派活同钳制（--max-iter=10）', () => {
    expect(buildSelfIteratePreview({ ...base, maxIter: '999' })).toBe('/yxspec:self-iterate sqt_script_gen --max-iter=10');
  });

  it('目标 → 拼 ` --goal="<goal>"`（保留空格）', () => {
    expect(buildSelfIteratePreview({ ...base, goal: 'Total>=80 且门禁全绿' })).toBe(
      '/yxspec:self-iterate sqt_script_gen --goal="Total>=80 且门禁全绿"',
    );
  });

  it('目标空白串 → 不拼', () => {
    expect(buildSelfIteratePreview({ ...base, goal: '   ' })).toBe('/yxspec:self-iterate sqt_script_gen');
  });

  it('framework 模式 → 拼 ` --mode=framework`', () => {
    expect(buildSelfIteratePreview({ ...base, mode: 'framework' })).toBe('/yxspec:self-iterate sqt_script_gen --mode=framework');
  });

  it('断点恢复 → 拼尾随 ` --resume`', () => {
    expect(buildSelfIteratePreview({ ...base, resume: true })).toBe('/yxspec:self-iterate sqt_script_gen --resume');
  });

  it('全参实况 → 顺序 max-iter → goal → mode → resume（与 buildSelfIterateCommand 组合一致）', () => {
    expect(
      buildSelfIteratePreview({
        stage: 'swe_arch',
        maxIter: '8',
        goal: 'Total>=85 且门禁全绿',
        mode: 'framework',
        resume: true,
      }),
    ).toBe('/yxspec:self-iterate swe_arch --max-iter=8 --goal="Total>=85 且门禁全绿" --mode=framework --resume');
  });
});
