// =============================================================================
// selfIterateCommand — /yxspec:self-iterate 派活命令拼装纯函数
// 消费方 = 自迭代插件「启动」入口（stage/轮数/收敛目标/断点恢复 → 派发文本）。
// 网关解析 = gateway/runtime-js/vendor/@yxspec/self-iteration/index.js 的
//   parseSelfIterate（命令独立成词 + flag 边界，--goal 支持引号包裹多词值；
//   DEFAULT_MAX_ITER=3，resolveStageToken 把连字符命令名/下划线 token 归一）。
// 本模块只做命令串拼装（无 DOM/后端依赖），可单测；语义对齐 parseSelfIterate，
//   但不做阶段合法性校验——stage 空/空白返回 ''，由调用方据此提示不派发。
// UI 基线：design-taste skill — 纯数据，提示/落盘由调用方组件负责。
// =============================================================================

/** /yxspec:self-iterate 派活命令参数（全可选，缺省不拼对应 flag）。 */
export interface SelfIterateOptions {
  /** 阶段 token（STAGE_ORDER 项，如 sqt_script_gen；也可传命令名 sqt-script-gen） */
  stage: string;
  /** 轮数，默认 3；缺省/等于默认值时不拼参数 */
  maxIter?: number;
  /** 收敛目标，空串/undefined 不拼 */
  goal?: string;
  /** 断点恢复，true 拼 --resume */
  resume?: boolean;
  /** 评估模式：'framework' 拼 --mode=framework（评框架效率，复用 --eval-framework 对比）；
   *  'product'（默认）/ undefined 不拼（网关默认评阶段产物） */
  mode?: 'product' | 'framework';
}

/** 网关默认最大轮数（与 @yxspec/self-iteration DEFAULT_MAX_ITER 对齐）。 */
const DEFAULT_MAX_ITER = 3;

/** maxIter 有效值域 [1,10]：<1 取 1，>10 取 10。 */
const MAX_ITER_MIN = 1;
const MAX_ITER_MAX = 10;

/**
 * 轮数输入归一（与 buildSelfIterateCommand 派活钳制同口径，表单 onChange 消费）：
 * 原生 number 输入允许 0 / 999 / 3.5 这类越界或小数值，而派活时只做
 * Math.floor + [1,10] 钳制——不在这里归一，UI 显示「999」实际跑 --max-iter=10，
 * 所见 ≠ 所跑且无任何反馈。本函数把输入就地钳进 [1,10]：
 *  · 空串 / 无数字 → ''（保持可清空重输，不强制回填）
 *  · 小数取整（3.5 → 3，与派活 Math.floor 同口径；负号/指数前缀一并剥离）
 *  · >10 → '10'（立即落回最大值，避免输入 999 后需连删两次）
 *  · 0 / 负数 → '1'（轮数 0 无意义，派活时同样会被钳到 1）
 */
export function clampMaxIterInput(raw: string): string {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  const m = s.match(/^[+-]?\d*\.?\d+/);
  if (!m) return '';
  const n = Math.floor(Number(m[0]));
  if (!Number.isFinite(n) || n <= 0) return '1';
  return String(Math.min(MAX_ITER_MAX, n));
}

/**
 * 拼装 /yxspec:self-iterate 派活命令（网关 @yxspec/self-iteration 插件解析）。
 * stage 为空/空白 → 返回 ''（调用方据此做校验提示，不派发）。
 * 拼装规则与 parseSelfIterate 对齐：
 *   · maxIter 先 Math.floor 取整（网关 /^\d+$/ 只认整数，2.5 不 floor 会被忽略回落默认 3），
 *     再钳制到 [1,10]；仅当有效数字才拼 ` --max-iter=N`（NaN/undefined 不拼，
 *     等于默认 3 也不拼——网关 DEFAULT_MAX_ITER=3）
 *   · goal trim 后非空才拼 ` --goal="<goal>"`，内部 `"` 转义为 `\"`，保留空格
 *   · mode === 'framework' 拼 ` --mode=framework`（评框架效率）；product/undefined 不拼
 *     （网关默认评阶段产物，与 maxIter 缺省不拼同口径）
 *   · resume === true 拼尾随 ` --resume`
 */
export function buildSelfIterateCommand(opts: SelfIterateOptions): string {
  const stage = String(opts.stage ?? '').trim();
  if (!stage) return '';

  let cmd = `/yxspec:self-iterate ${stage}`;

  if (typeof opts.maxIter === 'number' && Number.isFinite(opts.maxIter)) {
    const n = Math.min(MAX_ITER_MAX, Math.max(MAX_ITER_MIN, Math.floor(opts.maxIter)));
    if (n !== DEFAULT_MAX_ITER) cmd += ` --max-iter=${n}`;
  }

  const goal = String(opts.goal ?? '').trim();
  if (goal) cmd += ` --goal="${goal.replace(/"/g, '\\"')}"`;

  if (opts.mode === 'framework') cmd += ' --mode=framework';

  if (opts.resume === true) cmd += ' --resume';

  return cmd;
}
