// M1 配套 - 建议下一步组件
// 受限链式调用：默认仅填充到命令框；可选"一键派活"直接 POST 网关 /api/agent

import React from 'react';
import { useToastStore } from '../../store/toastStore';
import { STAGE_TABLE } from '../../data/stage-mapping';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { Button, Icon } from '../ui';
import { I } from '../ui/icons';
import type { StageMapping, StageStatus } from '../../data/types';

interface Props {
  stage: string;
  mapping: StageMapping;
  stages: Record<string, StageStatus>;
  onSuggest?: (cmd: string) => Promise<string | null>;
}

export const NextCommand: React.FC<Props> = ({ stage, mapping, stages, onSuggest }) => {
  const [nextCmd, setNextCmd] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false);
  const { dispatch, cancel, sending, cancelling, elapsedSec } = useStageDispatch();
  const pushToast = useToastStore((s) => s.push);

  // 真实可执行命令均以 /yxspec: 开头；「无下游，建议收口或人工决断」等占位提示
  // 不是命令 —— 禁止复制/派活（否则会把占位文案 POST 给网关）
  const hasCommand = nextCmd.startsWith('/yxspec:');

  // 建议命令计算：先看当前阶段自身状态，
  // pending_review → 建议审查裁决（产物已齐备，重跑会覆盖待审产物）；
  // 未完成 → 推进自己；已完成 → 才考虑下游 / review。
  React.useEffect(() => {
    if (!onSuggest) return;
    setLoading(true);
    const status = stages[stage]?.status;
    if (status === 'pending_review') {
      // 产物已存在、等待 review：下一步是审查裁决，不是重跑本阶段
      const reviewCmd = `/yxspec:review ${stage}`;
      setNextCmd(reviewCmd);
      setLoading(false);
      return;
    }
    if (status && status !== 'completed') {
      // 当前阶段还没完成：建议直接推进本阶段（review 是完成后才做的事）
      const ownCmd = STAGE_TABLE[stage as keyof typeof STAGE_TABLE]?.command;
      setNextCmd(ownCmd && ownCmd.startsWith('/yxspec:') ? ownCmd : '（无下游，建议收口或人工决断）');
      setLoading(false);
      return;
    }
    onSuggest(stage)
      .then((cmd) => setNextCmd(cmd || '（无下游，建议收口或人工决断）'))
      .finally(() => setLoading(false));
  }, [stage, onSuggest, stages]);

  const handleFill = () => {
    if (!hasCommand) return;
    pushToast(
      'info',
      `已推荐命令：${nextCmd}（受受限链式调用约束，需手动确认执行）`,
    );
    // 复制到剪贴板（浏览器模式兜底方案）
    if (navigator.clipboard) {
      navigator.clipboard.writeText(nextCmd).catch(() => {});
    }
  };

  // 一键派活：把建议命令 POST 到网关 /api/agent，走完整 agent 编排。
  // 逻辑已抽到共享 hook useStageDispatch（门控检查 + 回填对话流 + session 订阅），
  // NextCommand 与 StageNode 卡片共用同一份派活实现。
  const handleDispatch = async () => {
    if (!hasCommand || sending) return;
    await dispatch(nextCmd);
  };

  return (
    <div className="px-3 py-2.5 bg-white rounded-lg border border-zinc-200 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-sm text-zinc-700 min-w-0">
        <span className="text-zinc-400 shrink-0" aria-hidden="true"><Icon name={I.arrowRight} size={13} /></span>
        <span className="shrink-0" id="next-command-label">建议下一步</span>
        {loading ? (
          <span className="text-xs text-zinc-400" role="status">计算中…</span>
        ) : hasCommand ? (
          <strong className="font-mono text-emerald-800 truncate" title={nextCmd} aria-live="polite">{nextCmd}</strong>
        ) : (
          <span className="text-xs text-zinc-400" title={nextCmd}>{nextCmd}</span>
        )}
        <span className="text-xs text-zinc-400">（当前 {stage}）</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleFill}
          disabled={!hasCommand || loading}
          title="复制命令到剪贴板"
        >
          <Icon name={I.clipboard} size={13} />
          复制
        </Button>
        {sending ? (
          <>
            <Button
              variant="danger"
              size="sm"
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
            onClick={handleDispatch}
            disabled={!hasCommand || loading}
            title="直接经网关驱动当前阶段 agent 执行（门控通过才放行）"
          >
            <Icon name={I.play} size={13} weight="fill" />
            一键派活
          </Button>
        )}
      </div>
    </div>
  );
};