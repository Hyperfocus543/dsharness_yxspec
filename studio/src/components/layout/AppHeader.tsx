// =============================================================================
// AppHeader — 顶栏（从 App.tsx 拆出）
// 品牌标识 + 网关连接指示 + 当前项目信息 + 全局项目切换器。
// =============================================================================

import React from 'react';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import { GatewayStatusBar } from './GatewayStatusBar';
import { ProjectSwitcher } from './ProjectSwitcher';

interface AppHeaderProps {
  project: { path: string; meta: { spec_id?: string; product?: string } } | null;
  loading: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ project, loading }) => (
  <header className="bg-white border-b border-zinc-200 px-4 py-2.5 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-3">
      <div className="text-xl font-bold text-zinc-900 flex items-center gap-2">
        <span className="text-emerald-600"><Icon name={I.cube} size={22} weight="fill" /></span>
        YXSpec Studio
      </div>
    </div>
    <div className="flex items-center gap-2">
      {/* 网关连接状态指示条（全局探活，点击重探测） */}
      <GatewayStatusBar />
      {project && (
        <span className="text-xs text-zinc-600 hidden sm:inline">
          <span className="font-mono">{project.meta.spec_id || '—'}</span>
          {' · '}
          {project.meta.product || '—'}
        </span>
      )}
      {/* 全局项目切换器：无论是否打开项目都在 */}
      <ProjectSwitcher currentPath={project?.path ?? null} loading={loading} />
    </div>
  </header>
);
