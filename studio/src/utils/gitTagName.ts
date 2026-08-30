// =============================================================================
// gitTagName — yxspec 阶段收尾 tag（`yxspec/<stage>/<seq>`）可读化纯逻辑
// 数据源 = 网关 /api/trajectory-all 的 tag（轨迹 × git）、/api/git/commits 的 tag
//   （阶段留痕）——tag 全名由 @yxspec/git-workspace 在阶段收尾打上：
//   `git tag yxspec/<stage>/<seq> <commit>`（stage = 权威 token，seq = 阶段执行序号）。
// 目的：这些「内部留痕 tag」在轨迹流/留痕/自迭代/工作区 tag 清单里一直裸显示全名
//   （`yxspec/swe_arch/7`），占行宽且 hover 不解读「哪个阶段、第几次」。本模块把
//   tag 名解析成短标签 + 人类可读摘要，让 git 检查点一眼可辨；变体阶段
//   （swe_coding_verify_pc）尤其受益——不再与基础阶段（swe_coding_verify）混淆。
// 本模块只做无 DOM 的派生计算，可单测；调用方（tag 徽标/tooltip）决定样式。
// 展示口径：
//   · 非 yxspec 留痕 tag（v1.0 / 用户自定义）→ 原样返回，不误读。
//   · stage 段未知 token（老/扩展阶段）→ 用原始 stage 段兜底展示。
// UI 基线：design-taste skill — 纯数据，色/文案由调用方组件负责。
// =============================================================================

import type { StageToken } from '../data/types';
import { STAGE_TABLE } from '../data/stage-mapping';

/** 阶段收尾 tag 名 = `yxspec/<stage>/<seq>`（git-workspace 权威格式；seq 为正整数）。 */
const YXSPEC_TAG_RE = /^yxspec\/([^/]+)\/(\d+)$/;

/** 解析后的阶段收尾 tag 信息（非 yxspec 留痕 tag → null，调用方原样展示）。 */
export interface YxspecTagInfo {
  /** 阶段权威 token（如 `swe_arch` / `swe_coding_verify_pc`） */
  stage: string;
  /** 该阶段第几次执行（正整数） */
  seq: number;
  /** tag 全名（`yxspec/<stage>/<seq>`；解析/回拼用） */
  full: string;
  /** 指向该 tag 的 commit 完整 hash（工具提示「检查点」定位；无 → null） */
  commit: string | null;
}

/** 单条记录/留痕的弱形态（只取本模块需要的字段；结构等价 TrajectoryAllEntry / GitStageTrace）。 */
export interface YxspecTagLike {
  /** 该次执行时刻最新 commit 上挂的 tag（无 → null） */
  tag?: string | null;
  /** 该 tag 指向的 commit 完整 hash（无 → null；tooltip「检查点」行用） */
  tagCommit?: string | null;
  /** 该次执行的最新 commit（7 位短 hash；无 → null） */
  commit?: string | null;
}

/**
 * 解析 yxspec 阶段收尾 tag 全名 → 结构化信息；非留痕 tag / 形态不符 → null。
 * 宽容：tag 为空 / 非字符串 → null；seq 非正整数 → null；stage 段空 → null。
 */
export function parseYxspecTag(tag: string | null | undefined): YxspecTagInfo | null {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  const m = YXSPEC_TAG_RE.exec(tag.trim());
  if (!m) return null;
  const seq = Number(m[2]);
  if (!Number.isInteger(seq) || seq < 1) return null;
  return {
    stage: m[1],
    seq,
    full: tag.trim(),
    commit: null,
  };
}

/**
 * 短标签：`swe_arch/7`（剥 `yxspec/` 前缀 + 版本化 seq）——tag 徽标主体展示，
 * 把「哪阶段第几次」塞进一屏标签，替代裸全名。非留痕 tag → 原样返回（不误读）。
 * @param tag  tag 全名（`yxspec/<stage>/<seq>` 或用户自定义）
 */
export function stageTagLabel(tag: string | null | undefined): string {
  const info = parseYxspecTag(tag);
  if (!info) return typeof tag === 'string' && tag.trim() ? tag.trim() : '';
  return `${info.stage}/${info.seq}`;
}

/**
 * 阶段收尾 tag 的「阶段显示名」：优先 STAGE_TABLE 的 ASPICE 编号（如 `SWE.4`），
 * 未知 token → 原始 stage 段兜底。供摘要行的「SWE.4 · swe_coding_verify_pc」。
 * 注意变体阶段保留完整 token（swe_coding_verify_pc ≠ swe_coding_verify，不截断）。
 */
export function stageAspiceName(stage: string): string {
  const m = STAGE_TABLE[stage as StageToken];
  if (m?.aspice) return m.aspice;
  return stage;
}

/**
 * 人类可读摘要行：`SWE.4 swe_coding_verify_pc #3 · 阶段收尾 tag` ——
 * tooltip / 详情首行，替代「tag: yxspec/swe_coding_verify_pc/3」的裸格式。
 * @param info  parseYxspecTag 的解析结果（非留痕 tag 由调用方用原值兜底）
 */
export function stageTagSummary(info: YxspecTagInfo): string {
  const aspice = stageAspiceName(info.stage);
  return `${aspice} ${info.stage} #${info.seq} · 阶段收尾 tag`;
}

/**
 * 一条记录/留痕的 yxspec tag 摘要（工具提示首行 + 检查点定位）。
 * 返回 { short, summary, commit }；记录无留痕 tag → null（调用方不渲染增强行）。
 * @param rec 轨迹行 / 留痕记录（tag / tagCommit / commit 均可缺省）
 */
export function yxspecTagOf(rec: YxspecTagLike | null | undefined): {
  short: string;
  summary: string;
  commit: string | null;
} | null {
  const info = parseYxspecTag(rec?.tag);
  if (!info) return null;
  info.commit = rec?.tagCommit || rec?.commit || null; // 指向 commit 完整 hash 优先
  return {
    short: stageTagLabel(rec?.tag),
    summary: stageTagSummary(info),
    commit: info.commit,
  };
}
