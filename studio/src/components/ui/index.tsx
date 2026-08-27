// =============================================================================
// UI 基础层 — 统一设计语言（按 design-taste-frontend skill）
// 基线：
//   - 单强调色：emerald（深绿），避免 AI 蓝紫审美
//   - 中性底：zinc 系列（非蓝灰）
//   - 禁 emoji：全部图标用 Phosphor（@phosphor-icons/react）
//   - Dashboard 密度 (VISUAL_DENSITY 4-7)：少卡片多边框分组
//   - 交互：`:active` 触感（scale/translate）、加载骨架、空/错误态
// =============================================================================

// ---------- Phosphor 图标封装 ----------
import type { FC } from 'react';

/**
 * 统一图标封装：透传 Phosphor 图标组件（v2 每个图标即组件，无 Icon 聚合导出）。
 * 用法：<Ui.Icon name={I.gauge} size={16} className="..." />
 */
export const Icon: FC<{ name: React.ElementType; size?: number | string; className?: string; weight?: string }> = ({
  name: IconComp,
  size = 16,
  className = '',
  weight,
}) => {
  const Comp = IconComp as unknown as FC<{ size?: number | string; weight?: string; className?: string }>;
  return <Comp size={size} weight={weight} className={className} />;
};

// ---------- 按钮 ----------
interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  className?: string;
}

export const Button: FC<ButtonProps> = ({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  title,
  className = '',
}) => {
  const base =
    'rounded-md font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 select-none';
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-1.5 text-sm' };
  const variants = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
    secondary: 'bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50',
    ghost: 'bg-transparent text-zinc-500 hover:bg-zinc-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
};

// 状态徽章色 — Claude 暖系语义
// completed/done 用 sage 暖绿（柔和、区别于阻塞绯红）；blocked/rejected 用暖绯
// 赤陶橙(emerald)只留交互/当前态（按钮、选中），不占完成态
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

export const Badge: FC<{ status?: string; label?: string; className?: string; title?: string }> = ({
  status,
  label,
  className = '',
  title,
}) => {
  const tone = STATUS_TONE[status || ''] || 'bg-zinc-100 text-zinc-600';
  const text = label || STATUS_LABEL[status || ''] || status || '';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${tone} ${className}`} title={title}>
      {text}
    </span>
  );
};

// 状态点（连接状态 / 门控）
export const StatusDot: FC<{ tone: 'ok' | 'warn' | 'err' | 'idle' | 'active'; className?: string }> = ({
  tone,
  className = '',
}) => {
  const tones = {
    ok: 'bg-sage-500',
    warn: 'bg-amber-500',
    err: 'bg-red-500',
    idle: 'bg-zinc-400',
    active: 'bg-sage-500 animate-pulse',
  };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${tones[tone]} ${className}`} />;
};

// ---------- 空状态 ----------
export const EmptyState: FC<{ icon?: React.ElementType; title: string; hint?: string; className?: string }> = ({
  icon: IconComp,
  title,
  hint,
  className = '',
}) => (
  <div className={`flex flex-col items-center justify-center text-center py-10 ${className}`}>
    {IconComp && (
      <span className="text-zinc-300 mb-2">
        <Icon name={IconComp} size={28} />
      </span>
    )}
    <div className="text-sm text-zinc-500">{title}</div>
    {hint && <div className="text-xs text-zinc-400 mt-1 max-w-[40ch]">{hint}</div>}
  </div>
);

// ---------- 面板卡片（去边框，用分组） ----------
export const Panel: FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white rounded-lg shadow-sm border border-zinc-200 ${className}`}>{children}</div>
);

export const PanelHeader: FC<{ title: React.ReactNode; icon?: React.ElementType; actions?: React.ReactNode; className?: string }> = ({
  title,
  icon: IconComp,
  actions,
  className = '',
}) => (
  <div className={`px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between ${className}`}>
    <div className="flex items-center gap-2">
      {IconComp && <span className="text-zinc-400"><Icon name={IconComp} size={16} /></span>}
      <span className="text-sm font-semibold text-zinc-800">{title}</span>
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

// ---------- 骨架加载 ----------
export const Skeleton: FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-zinc-200 rounded ${className}`} />
);

// ---------- 小节标题 ----------
export const SectionLabel: FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`text-xs uppercase tracking-wide text-zinc-400 font-medium ${className}`}>{children}</div>
);
