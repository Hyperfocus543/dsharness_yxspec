// =============================================================================
// D1 审批队列 - ReviewQueue（D1 审批队列）
// 数据源：useStageStore 的 dshState.stages —— 找 review === 'pending' 或
// state === 'pending_review' 的阶段。每个待审阶段卡片提供「批准」「打回」，
// 均走 useStageDispatch().dispatch('/yxspec:review <stage>') 发起 AI 预审
// （简化版：让 AI 审完给 verdict），dispatch 内部已处理轮询 + 回填对话流。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import type { StageToken } from '../../data/types';
import { STAGE_TABLE } from '../../data/stage-mapping';
import { useStageStore } from '../../store/stageStore';
import { useToastStore } from '../../store/toastStore';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { renderInline } from '../../utils/markdown';
import { Button, EmptyState, Icon, Panel } from '../ui';
import { I } from '../ui/icons';

/** 收集待审阶段：review === 'pending' 或 state === 'pending_review'，按 STAGE_TABLE order 排序 */
export function collectPendingReviewTokens(): StageToken[] {
  const dshStages = useStageStore.getState().dshState?.stages;
  if (!dshStages) return [];
  const tokens: StageToken[] = [];
  for (const [token, entry] of Object.entries(dshStages)) {
    // 待审判定：review === 'pending'（契约字段），或 state 宽松判定为
    // 'pending_review'（驾驶舱扩展状态，后端可能下发，类型未覆盖故按 string 判）
    const rawState = entry.state as string;
    if (entry.review === 'pending' || rawState === 'pending_review') {
      // 只保留 STAGE_TABLE 里存在的阶段，保证 order/aspice/command 有值
      if (STAGE_TABLE[token as StageToken]) {
        tokens.push(token as StageToken);
      }
    }
  }
  return tokens.sort((a, b) => (STAGE_TABLE[a].order || 0) - (STAGE_TABLE[b].order || 0));
}

/** 单个待审阶段卡片 */
const ReviewCard: React.FC<{ token: StageToken }> = ({ token }) => {
  const dshState = useStageStore((s) => s.dshState);
  const stages = useStageStore((s) => s.stages);
  const pushToast = useToastStore((s) => s.push);
  const { dispatch, sending } = useStageDispatch();

  const mapping = STAGE_TABLE[token];
  const entry = dshState?.stages?.[token];
  const gateMsg = entry?.gate?.message || stages[token]?.gate_message || '';
  const artifactCount = Array.isArray(entry?.artifacts) ? entry.artifacts.length : (stages[token]?.artifacts_count ?? stages[token]?.artifacts?.length ?? 0);
  const reviewState = entry?.state || stages[token]?.status || 'pending';

  const handleReview = async () => {
    if (sending) return;
    const command = `/yxspec:review ${token}`;
    await dispatch(command);
    pushToast('info', `已发起 ${token} 审查`);
  };

  return (
    <Panel className="p-3 border-l-4 border-l-orange-400">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-500">{mapping.aspice}</span>
            <span className="text-sm font-semibold text-zinc-800">{token}</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500 font-mono truncate" title={mapping.command}>
            {mapping.command}
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Icon name={I.fileText} size={12} className="text-zinc-400" />
              {artifactCount} 产物
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name={I.eye} size={12} className="text-zinc-400" />
              {reviewState}
            </span>
          </div>
          {gateMsg && (
            <div className="mt-2 inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
              <Icon name={I.warn} size={11} weight="fill" className="shrink-0" />
              <span className="truncate max-w-[260px]" title={gateMsg}>
                {renderInline(gateMsg)}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleReview} disabled={sending}>
          <Icon name={I.check} size={13} weight="bold" />
          批准
        </Button>
        <Button variant="danger" size="sm" onClick={handleReview} disabled={sending}>
          <Icon name={I.xCircle} size={13} weight="bold" />
          打回
        </Button>
        {sending && <span className="text-xs text-zinc-400">派活中…</span>}
      </div>
    </Panel>
  );
};

export const ReviewQueue: React.FC = () => {
  const dshState = useStageStore((s) => s.dshState);
  const tokens = React.useMemo(() => collectPendingReviewTokens(), [dshState]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold text-zinc-700 inline-flex items-center gap-1.5">
          <span className="text-orange-500">
            <Icon name={I.eye} size={14} />
          </span>
          待审批
          <span className="text-xs text-zinc-400">（{tokens.length}）</span>
        </div>
      </div>

      {tokens.length === 0 ? (
        <EmptyState
          icon={I.checkCircle}
          title="当前无待审阶段"
          hint="dsh_state 中 review 或状态进入待审的阶段会出现在这里"
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {tokens.map((token) => (
            <ReviewCard key={token} token={token} />
          ))}
        </div>
      )}
    </div>
  );
};
