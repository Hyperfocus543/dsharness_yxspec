// 骨架屏（从 ui/index.tsx 拆出）
import type { FC } from 'react';

export const Skeleton: FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-zinc-200 rounded ${className}`} />
);
