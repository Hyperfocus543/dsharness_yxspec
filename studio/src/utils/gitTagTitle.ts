// =============================================================================
// gitTagTitle — 工作区 tag 徽标 tooltip 纯逻辑（Git 工作区管控卡 tag 清单）
// 数据源 = /api/git/status 富格式 tag 清单（GitTagInfo：name + 指向 commit + subject
//   + 提交时间）。旧网关/兼容形态只给字符串名 → 统一归一为 GitTagInfo（name 兜底）。
// 目的：tag 列表从「只显示名字」升级为「hover 即知该 tag 指向哪个检查点」——
//   阶段里程碑 tag 一眼可辨（v1.0 指向哪次提交、是什么改动、什么时候打的），
//   不必再切去 git log 猜。指向 HEAD 的 tag 由调用方另标「HEAD」角标。
// 本模块只做无 DOM 的派生计算，可单测。
// =============================================================================

import type { GitTagInfo } from './ipc';

/**
 * 归一 tag 条目为 GitTagInfo：字符串（旧网关/兼容形态）→ name 兜底对象；
 * 已归一对象原样返回（宽容字段缺失，不抛）。
 */
export function toGitTagInfo(t: GitTagInfo | string | null | undefined): GitTagInfo | null {
  if (t == null) return null;
  if (typeof t === 'string') {
    const name = t.trim();
    return name
      ? { name, commit: null, commitShort: null, subject: null, commitAt: null }
      : null;
  }
  if (typeof t !== 'object' || typeof t.name !== 'string' || !t.name.trim()) return null;
  return t;
}

/** ISO 时间 → 相对时间文案（刚刚 / N 分钟前 / N 小时前 / N 天前；缺失/非法 → null）。 */
function relTimeOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  return `${Math.floor(diffH / 24)} 天前`;
}

/**
 * tag 徽标 tooltip（多行文本）：指向 commit + 提交说明 + 相对时间。
 * 只列「有信息量」的行：对象形态无 commit → 「轻量 tag（无 commit 信息）」；
 * 字符串形态（旧网关）→ 降级提示。返回 null = 无内容（调用方保持中性 tooltip）。
 */
export function gitTagTitle(t: GitTagInfo | string | null | undefined): string | null {
  const tag = toGitTagInfo(t);
  if (!tag) return null;
  if (typeof t === 'string') return '轻量 tag（旧网关：无 commit/时间信息）';
  const lines = [
    tag.commit ? `commit：${tag.commit}` : null,
    tag.subject ? `提交说明：${tag.subject}` : null,
    tag.commitAt ? `提交时间：${new Date(tag.commitAt).toLocaleString('zh-CN', { hour12: false })}（${relTimeOf(tag.commitAt)}）` : null,
  ].filter((l): l is string => Boolean(l));
  if (lines.length === 0) return '轻量 tag（无 commit/时间信息）';
  return lines.join('\n');
}
