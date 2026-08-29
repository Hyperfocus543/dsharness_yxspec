// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// M3 审查中心 - review-*.md 聚合 + verdict + 签字追踪

import React from 'react';
import type { ReviewEntry, ReviewVerdict } from '../../data/types';
import { countByVerdict, useReviewStore } from '../../store/reviewStore';
import { STAGE_TABLE } from '../../data/stage-mapping';
import { I } from '../ui/icons';
import { Button, EmptyState, Icon, Panel } from '../ui';
import { ReviewQueue } from './ReviewQueue';

const VERDICT_COLORS: Record<ReviewVerdict, string> = {
  approved: 'border-l-sage-500',
  conditional: 'border-l-amber-500',
  rejected: 'border-l-red-500',
};

const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  approved: 'approved',
  conditional: 'conditional',
  rejected: 'rejected',
};

const VERDICT_ACCENT: Record<ReviewVerdict, { icon: React.ElementType; text: string }> = {
  approved: { icon: I.check, text: 'text-sage-600' },
  conditional: { icon: I.warn, text: 'text-amber-600' },
  rejected: { icon: I.xCircle, text: 'text-red-600' },
};

interface ReviewCardProps {
  entry: ReviewEntry;
}

const ReviewCard: React.FC<ReviewCardProps> = ({ entry }) => {
  const mapping = STAGE_TABLE[entry.stage as keyof typeof STAGE_TABLE];

  if (!entry.review) {
    return (
      <Panel className="border-l-4 border-l-zinc-300 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-xs text-zinc-500">{mapping?.aspice || '—'}</span>
          <span className="text-sm font-semibold text-zinc-800">{entry.stage}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-zinc-500">
          <Icon name={I.clock} size={14} className="text-zinc-400" />
          无审查报告（pending）
        </div>
      </Panel>
    );
  }

  const color = VERDICT_COLORS[entry.review.verdict];
  const accent = VERDICT_ACCENT[entry.review.verdict];

  return (
    <Panel className={`border-l-4 ${color} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-500">{mapping?.aspice || '—'}</span>
          <span className="text-sm font-semibold text-zinc-800">{entry.stage}</span>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${accent.text}`}>
          <Icon name={accent.icon} size={14} />
          {VERDICT_LABELS[entry.review.verdict]}
        </span>
      </div>

      <div className="space-y-1 text-xs text-zinc-600">
        {entry.review.tech_lead && (
          <div>
            <span className="font-semibold text-zinc-700">技术负责人：</span>
            {entry.review.tech_lead}
          </div>
        )}
        {entry.review.quality_lead && (
          <div>
            <span className="font-semibold text-zinc-700">质量负责人：</span>
            {entry.review.quality_lead}
          </div>
        )}
        {entry.review.date && (
          <div>
            <span className="font-semibold text-zinc-700">审查日期：</span>
            {entry.review.date}
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="font-semibold text-zinc-700">人工签字：</span>
          {entry.review.signoff ? (
            <span className="inline-flex items-center gap-1 text-sage-600">
              <Icon name={I.check} size={14} />
              已签署
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Icon name={I.warn} size={14} />
              待签
            </span>
          )}
        </div>
        {entry.signoff_file && (
          <div className="flex items-center gap-1 text-zinc-400 truncate" title={entry.signoff_file}>
            <Icon name={I.link} size={14} />
            {entry.signoff_file.split('/').pop()}
          </div>
        )}
        {entry.review.file && (
          <div className="flex items-center gap-1 text-zinc-400 truncate" title={entry.review.file}>
            <Icon name={I.fileText} size={14} />
            {entry.review.file.split('/').pop()}
          </div>
        )}
      </div>
    </Panel>
  );
};

interface ReviewCenterProps {
  projectPath: string;
}

export const ReviewCenter: React.FC<ReviewCenterProps> = ({ projectPath }) => {
  const load = useReviewStore((s) => s.load);
  const entries = useReviewStore((s) => s.entries);
  const loading = useReviewStore((s) => s.loading);
  const loadError = useReviewStore((s) => s.loadError);

  React.useEffect(() => {
    load(projectPath);
  }, [projectPath, load]);

  const counts = React.useMemo(() => countByVerdict(entries), [entries]);
  const total = entries.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
          <span className="text-emerald-600">
            <Icon name={I.shield} size={16} />
          </span>
          审查中心
        </h3>
        <Button variant="secondary" size="sm" onClick={() => load(projectPath)} disabled={loading}>
          <Icon name={I.refresh} size={14} />
          刷新
        </Button>
      </div>

      {/* 首次加载骨架（复用驾驶舱同款骨架：不闪「无审查报告」空态） */}
      {loading && total === 0 && (
        <div className="border border-zinc-200 rounded-lg bg-white p-3 space-y-2" role="status" aria-busy="true" aria-label="正在加载审查报告">
          <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/3" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 bg-zinc-100 rounded animate-pulse" />
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 bg-zinc-100 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* 加载失败 ≠ 无审查报告：给专属错误态 + 重试（与轨迹/工作区卡同款，网关未起时原地重拉） */}
      {loadError && (
        <div className="space-y-3">
          <div className="border border-zinc-200 rounded-lg bg-white">
            <EmptyState icon={I.shield} title="审查报告加载失败" hint="网关未响应或读取中断（/api/reviews 拿不到清单）。确认网关运行中，再点下方重试。" />
          </div>
          <div className="flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => load(projectPath)}>
              <Icon name={I.refresh} size={14} />
              重试
            </Button>
          </div>
        </div>
      )}

      {/* 数据就绪（或已加载为空）：统计 + 卡片列表 */}
      {!loadError && !(loading && total === 0) && (
        <>
          {/* D1 审批队列：顶部待审批区块（读 dshState.stages 找 review pending / pending_review） */}
          <div className="mb-4">
            <ReviewQueue />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 md:grid-cols-4">
            <Stat label="approved" value={counts.approved} color="sage" />
            <Stat label="conditional" value={counts.conditional} color="amber" />
            <Stat label="rejected" value={counts.rejected} color="red" />
            <Stat label="无审查报告" value={counts.none} color="gray" />
          </div>

          {entries.length === 0 ? (
            <div className="text-xs text-zinc-400 py-6 text-center border border-dashed border-zinc-200 rounded-lg">
              还没有审查报告（project/specs/*/review-*.md 或 task_review_*.md 未产生）
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {entries.map((entry) => (
                <ReviewCard key={entry.stage} entry={entry} />
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex items-start gap-1 text-xs text-zinc-500">
        <Icon name={I.info} size={14} className="mt-0.5 shrink-0 text-zinc-400" />
        <span>
          审查裁决 verdict 合法值：approved / conditional / rejected。
          conditional 在 build-spec §5.2 中视为 completed（ASPICE 留痕）。
        </span>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; color: string }> = ({
  label,
  value,
  color,
}) => {
  const bg = {
    sage: 'bg-sage-50 text-sage-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    gray: 'bg-zinc-100 text-zinc-600',
  }[color];
  return (
    <div className={`rounded-lg border border-zinc-200 p-3 ${bg}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
};
