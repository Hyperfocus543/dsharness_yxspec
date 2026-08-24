// M3 审查中心 - review-*.md 聚合 + verdict + 签字追踪

import React from 'react';
import type { ReviewEntry, ReviewVerdict } from '../../data/types';
import { countByVerdict, useReviewStore } from '../../store/reviewStore';
import { STAGE_TABLE } from '../../data/stage-mapping';

const VERDICT_COLORS: Record<ReviewVerdict, string> = {
  approved: 'border-emerald-500 bg-emerald-50',
  conditional: 'border-amber-500 bg-amber-50',
  rejected: 'border-red-500 bg-red-50',
};

const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  approved: '✅ approved',
  conditional: '⚠️ conditional',
  rejected: '❌ rejected',
};

interface ReviewCardProps {
  entry: ReviewEntry;
}

const ReviewCard: React.FC<ReviewCardProps> = ({ entry }) => {
  const mapping = STAGE_TABLE[entry.stage as keyof typeof STAGE_TABLE];

  if (!entry.review) {
    return (
      <div className="rounded border-2 border-gray-300 bg-gray-50 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-xs text-gray-500">{mapping?.aspice || '—'}</span>
          <span className="text-sm font-semibold">{entry.stage}</span>
        </div>
        <div className="text-xs text-gray-500">⏳ 无审查报告（pending）</div>
      </div>
    );
  }

  const color = VERDICT_COLORS[entry.review.verdict];

  return (
    <div className={`rounded border-2 ${color} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-gray-500">{mapping?.aspice || '—'}</span>
          <span className="text-sm font-semibold">{entry.stage}</span>
        </div>
        <span className="text-xs font-bold">{VERDICT_LABELS[entry.review.verdict]}</span>
      </div>

      <div className="space-y-1 text-xs text-gray-600">
        {entry.review.tech_lead && (
          <div>
            <span className="font-semibold">技术负责人：</span>
            {entry.review.tech_lead}
          </div>
        )}
        {entry.review.quality_lead && (
          <div>
            <span className="font-semibold">质量负责人：</span>
            {entry.review.quality_lead}
          </div>
        )}
        {entry.review.date && (
          <div>
            <span className="font-semibold">审查日期：</span>
            {entry.review.date}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="font-semibold">人工签字：</span>
          {entry.review.signoff ? (
            <span className="text-emerald-600">✓ 已签署</span>
          ) : (
            <span className="text-amber-600">⚠ 待签</span>
          )}
        </div>
        {entry.signoff_file && (
          <div className="text-gray-400 truncate" title={entry.signoff_file}>
            📎 {entry.signoff_file.split('/').pop()}
          </div>
        )}
        {entry.review.file && (
          <div className="text-gray-400 truncate" title={entry.review.file}>
            📄 {entry.review.file.split('/').pop()}
          </div>
        )}
      </div>
    </div>
  );
};

interface ReviewCenterProps {
  projectPath: string;
}

export const ReviewCenter: React.FC<ReviewCenterProps> = ({ projectPath }) => {
  const load = useReviewStore((s) => s.load);
  const entries = useReviewStore((s) => s.entries);
  const loading = useReviewStore((s) => s.loading);

  React.useEffect(() => {
    load(projectPath);
  }, [projectPath]);

  const counts = React.useMemo(() => countByVerdict(entries), [entries]);
  const total = entries.length;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-lg">审查中心</h3>
        <button
          className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
          onClick={() => load(projectPath)}
        >
          🔄 刷新
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="approved" value={counts.approved} color="emerald" />
        <Stat label="conditional" value={counts.conditional} color="amber" />
        <Stat label="rejected" value={counts.rejected} color="red" />
        <Stat label="无审查报告" value={counts.none} color="gray" />
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-8">加载中…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {entries.map((entry) => (
            <ReviewCard key={entry.stage} entry={entry} />
          ))}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500">
        ℹ️ 审查裁决 verdict 合法值：approved / conditional / rejected。
        conditional 在 build-spec §5.2 中视为 completed（ASPICE 留痕）。
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
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-gray-100 text-gray-800',
  }[color];
  return (
    <div className={`rounded p-3 ${bg}`}>
      <div className="text-xs">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
};