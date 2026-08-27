// =============================================================================
// EmptyState — 未打开项目时的首屏引导（从 App.tsx 拆出）
// =============================================================================

import React from 'react';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import { ProjectSwitcher } from './ProjectSwitcher';

export const EmptyState: React.FC<{ loading: boolean }> = ({ loading }) => (
  <div className="flex items-center justify-center h-full">
    <div className="text-center max-w-lg p-8">
      <div className="mb-4 flex justify-center text-emerald-600"><Icon name={I.cube} size={56} weight="fill" /></div>
      <h2 className="text-2xl font-bold mb-2 text-zinc-800">YXSpec Studio</h2>
      <p className="text-sm text-zinc-500 mb-5">
        选择或输入 yxspec 项目路径打开
      </p>
      <div className="flex justify-center">
        <ProjectSwitcher currentPath={null} loading={loading} />
      </div>
    </div>
  </div>
);
