// 布局/面板类原子组件（从 ui/index.tsx 拆出）：空状态 / 面板卡片 / 小节标题
import type { FC } from 'react';
import { Icon } from './Icon';

// ---------- 空状态 ----------
export const EmptyState: FC<{
  icon?: React.ElementType;
  title: string;
  hint?: string;
  className?: string;
}> = ({ icon: IconComp, title, hint, className = '' }) => (
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
export const Panel: FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`bg-white rounded-lg shadow-sm border border-zinc-200 ${className}`}>{children}</div>;

export const PanelHeader: FC<{
  title: React.ReactNode;
  icon?: React.ElementType;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, icon: IconComp, actions, className = '' }) => (
  <div className={`px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between ${className}`}>
    <div className="flex items-center gap-2">
      {IconComp && (
        <span className="text-zinc-400">
          <Icon name={IconComp} size={16} />
        </span>
      )}
      <span className="text-sm font-semibold text-zinc-800">{title}</span>
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

// ---------- 小节标题 ----------
export const SectionLabel: FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`text-xs uppercase tracking-wide text-zinc-400 font-medium ${className}`}>{children}</div>
);
