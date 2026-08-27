// 断点续跑 - 恢复提示条
// 网关重启/电脑休眠后，前端 loadResume 拉取 GET /api/resume 恢复信息，
// 在驾驶舱顶部渲染「已恢复到 X 阶段（剩 N 个待完成）」+「一键续跑」。
// 设计：不自动派活，只提示 + 按钮；点击复用 useStageDispatch（与 NextCommand/StageNode 同一套派活实现）。
// 不渲染条件：resumeInfo 为空（未加载/加载失败）或 resumable === false（全部完成）。

import React from 'react';
import { useStageStore } from '../../store/stageStore';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { Button, Icon } from '../ui';
import { I } from '../ui/icons';

export const ResumeBanner: React.FC = () => {
  const resumeInfo = useStageStore((s) => s.resumeInfo);
  const { dispatch, cancel, sending, cancelling, elapsedSec } = useStageDispatch();

  // 无恢复信息 / 全部完成 → 完全不显示
  if (!resumeInfo || resumeInfo.resumable === false) return null;

  const current = resumeInfo.current;
  const next = resumeInfo.suggestedNext;
  const stageDisplay = current || next?.command_name || '';
  const stageAspice = next?.aspice || '';
  const stageLabel = next?.label || '';

  const handleResume = async () => {
    if (!next?.command || sending) return;
    await dispatch(next.command);
  };

  return (
    <div className="px-3 py-2.5 bg-zinc-50 rounded-lg border border-zinc-200 flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 text-sm text-zinc-700 min-w-0">
        <span className="text-emerald-600 shrink-0">
          <Icon name={I.clock} size={15} />
        </span>
        <span className="shrink-0">已恢复到</span>
        <strong className="font-mono">{stageDisplay}</strong>
        {stageAspice && <span className="text-xs text-zinc-500">({stageAspice})</span>}
        <span className="text-xs text-zinc-500">
          {stageLabel ? `${stageLabel} · ` : ''}剩 {resumeInfo.pendingCount} 个待完成
          {resumeInfo.blockedStages.length > 0 && (
            <span> · {resumeInfo.blockedStages.length} 个阻塞</span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {sending ? (
          <>
            <Button
              variant="danger"
              onClick={cancel}
              disabled={cancelling}
              title="中断当前阶段 agent 执行（杀 runtime）"
            >
              <Icon name={I.stop} size={13} weight="fill" />
              {cancelling ? '终止中…' : '终止'}
            </Button>
            <span className="text-xs text-zinc-500 font-mono tabular-nums">
              {elapsedSec}s
            </span>
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={handleResume}
            disabled={!next?.command || sending}
            title={next?.command ? `续跑：${next.command}` : '当前阶段无可用命令'}
          >
            <Icon name={I.play} size={13} weight="fill" />
            一键续跑
          </Button>
        )}
      </div>
    </div>
  );
};
