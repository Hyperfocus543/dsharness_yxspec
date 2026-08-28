// 驾驶舱单阶段卡片（从 StageGrid 拆出）
// 状态色/门控三态/悬浮派活按钮/当前徽标。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import type { StageMapping, StageStatus } from '../../data/types';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import { StageGateBar } from './StageGateBar';
import { TrajectoryPanel } from './TrajectoryPanel';

// 状态色 — Claude 暖系语义：completed/done 用 sage 暖绿（柔和），blocked/rejected 暖绯
// emerald(赤陶) 只留当前态/交互（ring、派活按钮、当前标签）
const STATUS_COLOR: Record<string, string> = {
  completed: 'border-sage-300 bg-sage-50',
  in_progress: 'border-amber-500 bg-amber-50',
  pending: 'border-zinc-300 bg-zinc-50',
  pending_review: 'border-orange-400 bg-orange-50',
  rejected: 'border-red-500 bg-red-50',
  blocked: 'border-red-600 bg-red-100',
  stale: 'border-purple-500 bg-purple-50',
};

const STATUS_ICON: Record<string, React.ElementType> = {
  completed: I.check,
  in_progress: I.clock,
  pending: I.circle,
  pending_review: I.eye,
  rejected: I.xCircle,
  blocked: I.stop,
  stale: I.refresh,
};

const STATUS_ICON_TONE: Record<string, string> = {
  completed: 'text-sage-600',
  in_progress: 'text-amber-600',
  pending: 'text-zinc-400',
  pending_review: 'text-orange-600',
  rejected: 'text-red-600',
  blocked: 'text-red-600',
  stale: 'text-purple-600',
};

interface StageNodeProps {
  token: string;
  mapping: StageMapping;
  status: StageStatus;
  isCurrent: boolean;
  /** 点击卡片时打开产物抽屉（grid 外层包了一层 onClick） */
  onSelectStage?: (token: string) => void;
  /** 点击轨迹徽标 → 跳到该阶段轨迹视图（StageCockpit 传 setTrajStage+handleView） */
  onViewTrajectory?: (token: string) => void;
  /** 轨迹内联展开（单模块轨迹在单元卡内展示；点击卡片内「轨迹」按钮切换） */
  expanded?: boolean;
  /** 轨迹展开/收起切换回调 */
  onToggleTrajectory?: (token: string) => void;
}

export const StageNode: React.FC<StageNodeProps> = ({ token, mapping, status, isCurrent, onSelectStage, onViewTrajectory, expanded, onToggleTrajectory }) => {
  const color = STATUS_COLOR[status.status] || STATUS_COLOR.pending;
  const IconComp = STATUS_ICON[status.status] || STATUS_ICON.pending;
  const iconTone = STATUS_ICON_TONE[status.status] || 'text-zinc-400';
  const { dispatch, cancel, sending, dispatchingCmd, cancelling, elapsedSec } = useStageDispatch();
  // 门控三态：blocked=真阻塞（上游未完成）、pending=待补产物、ok=产物齐备可 review
  const gateState = status.gate_state;
  const gateBlocked = gateState === 'blocked';
  // 被阻塞时可跳去第一个未完成的上游（仅真阻塞时给点击）
  const gateUpstreams = gateBlocked ? mapping.upstream : [];
  const busy = sending && dispatchingCmd === mapping.command;

  // 卡片右上角悬浮"一键派活"：点击派活当前阶段，阻止冒泡避免误触卡片 onClick
  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(mapping.command);
  };

  return (
    <div
      className={`group relative rounded-lg border-2 p-3 transition-all hover:shadow-md ${color} ${
        isCurrent ? 'ring-2 ring-emerald-500 shadow-lg' : ''
      }`}
      title={`${mapping.aspice} - ${mapping.command}\n${status.message || ''}${
        status.gate_message ? `\n门控：${status.gate_message}` : ''
      }`}
    >
      {isCurrent && (
        // 「当前」徽标放左上角，与右上角悬浮派活按钮错开：
        // 同角（-top-2 -right-2）会被按钮盖住，hover/派活中"当前"标识消失。
        <span
          className="absolute -top-2 -left-2 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-medium shadow-sm inline-flex items-center gap-0.5"
          title="当前阶段"
        >
          <Icon name={I.gauge} size={10} weight="fill" />
          当前
        </span>
      )}
      {/* 悬浮"一键派活"按钮（hover 显示；派活中常驻显示可点击的取消按钮，点击终止 runtime）。
          空闲时 pointer-events-none，避免隐形按钮挡在卡片右上角拦截点击冒泡。
          固定在右上角（-top-2 -right-2），与左上角"当前"徽标互不重叠。
          a11y：真按钮（可键盘聚焦/读屏可读）；空闲态是 hover 揭示的隐藏操作 →
          不进 tab 序（tabIndex=-1）+ aria-hidden，避免键盘用户 Tabbing 到隐形按钮。 */}
      <button
        type="button"
        tabIndex={busy ? 0 : -1}
        aria-hidden={busy ? undefined : true}
        aria-label={
          busy
            ? cancelling ? `终止中：${mapping.command}` : `点击终止执行：${mapping.command}（已执行 ${elapsedSec}s）`
            : `一键派活：${mapping.command}`
        }
        className={`absolute -top-2 -right-2 px-1.5 py-1 rounded-full text-white shadow-sm inline-flex items-center gap-1 transition-all active:scale-[0.98] ${
          busy
            ? 'bg-red-500 hover:bg-red-600 opacity-100 cursor-pointer'
            : 'bg-emerald-600 opacity-0 group-hover:opacity-100 hover:bg-emerald-700 cursor-pointer pointer-events-none group-hover:pointer-events-auto'
        }`}
        title={
          busy
            ? cancelling ? `终止中：${mapping.command}` : `点击终止执行：${mapping.command}（已执行 ${elapsedSec}s）`
            : `一键派活：${mapping.command}`
        }
        onClick={busy ? (e) => { e.stopPropagation(); cancel(); } : handlePlayClick}
      >
        {busy ? (
          <>
            <Icon name={I.stop} size={12} weight="fill" />
            <span className="tabular-nums">{elapsedSec}s</span>
          </>
        ) : (
          <Icon name={I.play} size={12} weight="fill" />
        )}
      </button>
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-zinc-500">{mapping.aspice}</span>
        <span className={iconTone}>
          <Icon name={IconComp} size={16} />
        </span>
      </div>
      <div className="text-sm font-semibold mt-1 break-words text-zinc-800" title={token}>
        {token}
      </div>
      <div className="text-xs text-zinc-500 mt-1 break-words" title={mapping.command}>
        {mapping.command}
      </div>
      <div className="flex items-center justify-between mt-2 text-xs">
        <span className="text-zinc-500">
          {status.artifacts_count !== undefined
            ? `${status.artifacts_count} 产物`
            : status.artifacts?.length
              ? `${status.artifacts.length} 产物`
              : '暂无产物'}
        </span>
        <span className="flex items-center gap-1">
          {/* 轨迹入口图标：点击查看该阶段执行轨迹。
              不做三态预判（完整/缺失/异常）——执行记录与真实状态在轨迹
              面板里一目了然，卡片上预判无实际意义，统一一个入口即可。 */}
          {onViewTrajectory && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleTrajectory?.(token);
              }}
              className={`px-1.5 py-0.5 rounded border transition-all active:scale-[0.96] inline-flex items-center gap-0.5 ${
                expanded
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : 'text-zinc-400 hover:text-emerald-700 hover:bg-emerald-50 border-transparent hover:border-emerald-200'
              }`}
              title={expanded ? '收起本模块轨迹' : '在本卡片内查看该阶段执行轨迹'}
              aria-label={`${expanded ? '收起' : '查看'} ${mapping.command} 执行轨迹`}
              aria-expanded={expanded}
            >
              <Icon name={I.timer} size={13} />
              {expanded && <span className="text-[10px] font-medium">收起</span>}
            </button>
          )}
          {status.review && (
            <span
              className={`px-1 rounded text-white text-xs ${
                status.review.verdict === 'approved'
                  ? 'bg-emerald-500'
                  : status.review.verdict === 'conditional'
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
            >
              {status.review.verdict}
            </span>
          )}
        </span>
      </div>
      {/* 门控提示条（StageGateBar 独立组件） */}
      <StageGateBar
        status={status}
        gateUpstreams={gateUpstreams}
        onUpstreamClick={(t) => onSelectStage?.(t)}
      />
      {/* 单模块轨迹内联（展开时插入到卡片尾部，随卡片网格整体布局） */}
      {expanded && (
        <div className="mt-2 border-t border-zinc-200 pt-2">
          <TrajectoryPanel stage={token} limit={10} />
        </div>
      )}
    </div>
  );
};
