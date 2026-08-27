// Phosphor 图标封装（从 ui/index.tsx 拆出）
import type { FC } from 'react';

/**
 * 统一图标封装：透传 Phosphor 图标组件（v2 每个图标即组件，无 Icon 聚合导出）。
 * 用法：<Icon name={I.gauge} size={16} className="..." />
 */
export const Icon: FC<{
  name: React.ElementType;
  size?: number | string;
  className?: string;
  weight?: string;
}> = ({ name: IconComp, size = 16, className = '', weight }) => {
  const Comp = IconComp as unknown as FC<{
    size?: number | string;
    weight?: string;
    className?: string;
  }>;
  return <Comp size={size} weight={weight} className={className} />;
};
