// 状态徽章 + 状态点（从 ui/index.tsx 拆出）
// 状态徽章色 — Claude 暖系语义
// completed/done 用 sage 暖绿（柔和、区别于阻塞绯红）；blocked/rejected 用暖绯
// 赤陶橙(emerald)只留交互/当前态（按钮、选中），不占完成态
import type { FC } from 'react';

export const STATUS_TONE: Record<string, string> = {
  completed: 'bg-sage-100 text-sage-700',
  in_progress: 'bg-amber-100 text-amber-700',
  pending: 'bg-zinc-100 text-zinc-500',
  pending_review: 'bg-orange-100 text-orange-700',
  rejected: 'bg-red-100 text-red-700',
  blocked: 'bg-red-100 text-red-700',
  stale: 'bg-purple-100 text-purple-700',
  done: 'bg-sage-100 text-sage-700',
};

export const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  in_progress: '进行中',
  pending: '未开始',
  pending_review: '待审查',
  rejected: '已驳回',
  blocked: '阻塞',
  stale: '过时',
  done: '已完成',
};

export const Badge: FC<{
  status?: string;
  label?: string;
  className?: string;
  title?: string;
}> = ({ status, label, className = '', title }) => {
  const tone = STATUS_TONE[status || ''] || 'bg-zinc-100 text-zinc-600';
  const text = label || STATUS_LABEL[status || ''] || status || '';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${tone} ${className}`}
      title={title}
    >
      {text}
    </span>
  );
};

// 状态点（连接状态 / 门控）
export const StatusDot: FC<{
  tone: 'ok' | 'warn' | 'err' | 'idle' | 'active';
  className?: string;
}> = ({ tone, className = '' }) => {
  const tones = {
    ok: 'bg-sage-500',
    warn: 'bg-amber-500',
    err: 'bg-red-500',
    idle: 'bg-zinc-400',
    active: 'bg-sage-500 animate-pulse',
  };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${tones[tone]} ${className}`} />;
};
