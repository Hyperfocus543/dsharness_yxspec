// 时间格式化工具
// YXSpec 约定的 YYYY-MM-DD HH:mm:ss 格式 + duration 计算（build-spec §1.3 规则：省略高位零）

import dayjs from 'dayjs';

export const FMT = 'YYYY-MM-DD HH:mm:ss';

export function now(): string {
  return dayjs().format(FMT);
}

export function fmtDuration(start: string, end: string): string {
  const s = dayjs(start, FMT);
  const e = dayjs(end, FMT);
  if (!s.isValid() || !e.isValid()) return '—';
  const ms = e.valueOf() - s.valueOf();
  if (ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s2 = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${s2}s`);
  return parts.join(' ');
}

export function relTime(ts: string): string {
  const now = dayjs();
  const t = dayjs(ts, FMT);
  if (!t.isValid()) return ts;
  const diff = now.diff(t, 'minute');
  if (diff < 1) return '刚刚';
  if (diff < 60) return `${diff} 分钟前`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)} 小时前`;
  return `${Math.floor(diff / (60 * 24))} 天前`;
}