// 驾驶舱单阶段卡片（从 StageGrid 拆出）
// 状态色/门控三态/悬浮派活按钮/当前徽标。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。

import React from 'react';
import type { StageMapping, StageStatus } from '../../data/types';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { renderInline } from '../../utils/markdown';
import { Icon } from '../ui';
import { I } from '../ui/icons';

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
}

export const StageNode: React.FC<StageNodeProps> = ({ token, mapping, status, isCurrent, onSelectStage }) => {
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

  // 门控拦截条可点击：跳到被阻塞的上游阶段（打开对应产物抽屉）；无上游则纯提示，点击无效果
  const handleGateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (gateUpstreams.length > 0) onSelectStage?.(gateUpstreams[0]);
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
          固定在右上角（-top-2 -right-2），与左上角"当前"徽标互不重叠。 */}
      <span
        className={`absolute -top-2 -right-2 px-1.5 py-1 rounded-full text-white shadow-sm inline-flex items-center gap-1 transition-all active:scale-[0.98] ${
          busy
            ? 'bg-red-500 hover:bg-red-600 opacity-100 cursor-pointer pointer-events-auto'
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
      </span>
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
          {/* 门控三态徽标（来自轨迹门控）：verified 绿 / unverified 黄 / blocked 红。
              Phase 2 徽标联动：派活被门控打回后，gate_reason 带打回原因，
              title 展示原因文案（'迹✗' 常驻显示打回状态）。 */}
          {status.gate_trajectory && (
            <span
              className={`px-1 rounded text-white text-xs ${
                status.gate_trajectory === 'verified'
                  ? 'bg-sage-500'
                  : status.gate_trajectory === 'unverified'
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
              title={
                status.gate_reason
                  ? `轨迹门控：${status.gate_trajectory}（派活打回：${status.gate_reason}）`
                  : `轨迹门控：${status.gate_trajectory}`
              }
            >
              {status.gate_trajectory === 'verified' ? '迹✓' : status.gate_trajectory === 'unverified' ? '迹?' : '迹✗'}
            </span>
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
      {/* 门控提示条：三态区分（blocked 红警告 / pending 琥珀待补 / ok 绿正向），
          避免把"产物已存在可进 review"这类正向提示误渲染成红色警告 */}
      {status.gate_message && gateState && (
        <div
          className={`mt-2 w-full flex items-center gap-1 min-w-0 text-xs leading-tight rounded px-1.5 py-1 ${
            gateState === 'blocked'
              ? 'text-red-700 bg-red-50 border border-red-200 cursor-pointer hover:bg-red-100 hover:border-red-300 transition-all active:scale-[0.98]'
              : gateState === 'pending'
                ? 'text-amber-700 bg-amber-50 border border-amber-200'
                : 'text-sage-700 bg-sage-50 border border-sage-200'
          }`}
          title={
            gateState === 'blocked'
              ? `点击查看上游阻塞（${gateUpstreams.join('、')}）`
              : status.gate_message
          }
          onClick={handleGateClick}
        >
          <span className="shrink-0">
            <Icon
              name={gateState === 'blocked' ? I.warn : I.check}
              size={11}
              weight="fill"
            />
          </span>
          <span className="flex-1 min-w-0 break-words">{renderInline(status.gate_message)}</span>
          {gateUpstreams.length > 0 && (
            <Icon name={I.arrowRight} size={10} weight="bold" className="shrink-0" />
          )}
        </div>
      )}
    </div>
  );
};
