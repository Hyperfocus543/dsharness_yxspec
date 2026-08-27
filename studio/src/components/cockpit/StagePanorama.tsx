// =============================================================================
// StagePanorama — 驾驶舱「全景」视图：网格 + 流向 + V 模型三合一
// 左列开发链（ACQ→SYS→HWE/SWE，顶→底）、右列验证链（SWE→SQT→SUP→REL，底→顶）。
//   · 网格信息密度：节点直接复用 StageNode 富卡片（状态色/派活/轨迹/门控/审查全保留）
//   · 流向顺序：链内顺序 = 执行顺序，链头方向箭头标注
//   · V 模型语义：左右镜像 + 中轴竖线 + 底部「编码↔验证」连接点（V 底）
//   · 镜像追溯：hover 某卡 → 同行对面卡高亮（开发↔验证对应），原三视图都没有的能力
// 顶部 StageHeader 整体进度统计条（从网格继承）。
// 取代 StageGrid / StageFlow(FlowView) / StageVModel 三个视图（删除）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import type { StageStatus, StageToken } from '../../data/types';
import { STAGE_TABLE } from '../../data/stage-mapping';
import { Skeleton } from '../ui';
import { StageHeader } from './StageHeader';
import { StageNode } from './StageNode';
import { Icon } from '../ui';
import { I } from '../ui/icons';

/** 左列开发链（顶→底，11 行；同索引行与右链镜像对应） */
const LEFT_CHAIN: StageToken[] = [
  'init',            // ACQ.4  SOR 解析
  'sys_elicitation', // SYS.1  PRD
  'sys_analysis',    // SYS.2  系统需求
  'sys_arch',        // SYS.3  系统架构
  'hwe_analysis',    // HWE.1  硬件需求
  'swe_analysis',    // SWE.1  软件需求
  'swe_arch',        // SWE.2  软件架构
  'swe_arch_if',     // SWE.3  架构接口
  'swe_detail',      // SWE.3  详细设计
  'swe_coding_plan', // SWE.4  编码计划
  'swe_coding_do',   // SWE.4  编码（开发链底部，V 底）
];

/** 右列验证链（底→顶，11 行；与左列逐行镜像对应） */
const RIGHT_CHAIN: StageToken[] = [
  'swe_static_verify',   // SWE.4 静态验证（V 底，与编码对应）
  'swe_integration_verify', // SWE.5 集成验证
  'sqt_strategy',        // SYS.5 测试策略
  'sqt_tr',              // SYS.5 测试需求
  'sqt_case_design',     // SYS.5 用例设计
  'sqt_script_gen',      // SYS.5 脚本生成
  'sqt_auto_test',       // SYS.5 系统测试
  'sqt_defect_feedback', // SUP.8 缺陷反馈
  'comp',                // SUP.1 配置管理
  'swe_release',         // SPL.2 发布
  'swe_release_promote', // SPL.2 发布提升（V 顶，与 init 对应）
];

const LEGEND: { c: string; l: string }[] = [
  { c: 'bg-sage-500', l: '已完成' },
  { c: 'bg-amber-500', l: '进行中' },
  { c: 'bg-orange-400', l: '待审查' },
  { c: 'bg-red-500', l: '被拒/阻塞' },
  { c: 'bg-zinc-300', l: '未开始' },
];

interface StagePanoramaProps {
  stages: Record<string, StageStatus>;
  currentStage: string | null;
  /** 阶段状态是否仍在加载（首次拉取/网关慢）：不渲染虚假的"全 pending"，改为骨架屏 */
  loading?: boolean;
  /** 点击卡片 → 打开产物抽屉（StageCockpit 传入） */
  onSelectStage?: (token: string) => void;
  /** 点击轨迹图标 → 跳到该阶段轨迹视图 */
  onViewTrajectory?: (token: string) => void;
}

/** 全景视图：左开发右验证，V 形底部相连，同行镜像可悬停追溯 */
export const StagePanorama: React.FC<StagePanoramaProps> = ({
  stages,
  currentStage,
  loading,
  onSelectStage,
  onViewTrajectory,
}) => {
  // 镜像行悬停联动：hover 行号（LEFT_CHAIN[i] 与 RIGHT_CHAIN[i] 同行）
  const [hoverRow, setHoverRow] = React.useState<number | null>(null);

  /** 渲染链上单节点（复用 StageNode 富卡片；hover 时镜像行对面卡同步高亮） */
  const renderNode = (token: StageToken, row: number) => {
    if (loading) {
      return (
        <div key={token} className="rounded-lg border-2 border-zinc-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="w-10 h-3" />
            <Skeleton className="w-4 h-4" />
          </div>
          <Skeleton className="w-24 h-4" />
          <Skeleton className="w-32 h-3" />
          <div className="flex items-center justify-between pt-1">
            <Skeleton className="w-10 h-3" />
            <Skeleton className="w-12 h-3" />
          </div>
        </div>
      );
    }
    const mapping = STAGE_TABLE[token];
    const status = stages[token] || {
      token,
      status: 'pending' as const,
      artifacts: [],
      review: null,
      last_update: '',
      message: '',
      artifacts_count: 0,
    };
    const mirrored = hoverRow === row;
    return (
      <div
        key={token}
        onMouseEnter={() => setHoverRow(row)}
        onMouseLeave={() => setHoverRow(null)}
        className={`rounded-lg transition-all ${
          mirrored ? 'ring-2 ring-emerald-400/60' : 'ring-0 ring-transparent'
        }`}
      >
        <StageNode
          token={token}
          mapping={mapping}
          status={status}
          isCurrent={currentStage === token}
          onSelectStage={onSelectStage}
          onViewTrajectory={onViewTrajectory}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* 整体进度统计条（StageHeader 从网格继承） */}
      <StageHeader stages={stages} currentStage={currentStage} loading={loading} />

      {/* V 形主体：左开发链 | 中轴 | 右验证链 */}
      <div className="relative grid grid-cols-[1fr_44px_1fr] gap-2">
        {/* 左列：开发链（顶→底） */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs font-bold text-zinc-700 inline-flex items-center gap-1">
              <Icon name={I.caretDown} size={12} className="text-emerald-600" weight="fill" />
              开发链
            </span>
            <span className="text-[10px] text-zinc-400">ACQ.4 → SWE.4 · 11 阶段</span>
          </div>
          {LEFT_CHAIN.map((t, i) => renderNode(t, i))}
        </div>

        {/* 中轴：竖线（V 底连接语义）+ 底部「编码↔验证」标注 */}
        <div className="relative flex flex-col items-center min-w-0">
          {/* 中轴竖线：上起链头，下至连接点 */}
          <div className="absolute top-7 bottom-10 w-px bg-zinc-300 border-l border-dashed border-zinc-300" aria-hidden />
          {/* 底部连接点（V 底：编码 ↔ 验证） */}
          <div className="mt-auto mb-0.5 flex flex-col items-center gap-1" title="V 底连接：编码 ↔ 单元/静态验证">
            <span className="size-2 rounded-full bg-emerald-500 shadow-sm" />
            <Icon name={I.swap} size={13} className="text-emerald-600" />
            <span className="text-[10px] text-emerald-700 font-medium whitespace-nowrap">
              编码↔验证
            </span>
          </div>
        </div>

        {/* 右列：验证链（底→顶：数组已按 V 顺序排，反转渲染；行号用原始索引保证镜像正确） */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs font-bold text-zinc-700 inline-flex items-center gap-1">
              <Icon name={I.arrowRight} size={12} className="text-emerald-600 -rotate-90" weight="fill" />
              验证链
            </span>
            <span className="text-[10px] text-zinc-400">SWE.4 → SPL.2 · 11 阶段</span>
          </div>
          {[...RIGHT_CHAIN].reverse().map((t) => renderNode(t, RIGHT_CHAIN.length - 1 - RIGHT_CHAIN.indexOf(t)))}
        </div>
      </div>

      {/* 图例 + 镜像追溯说明 */}
      <div className="flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
        {LEGEND.map((l) => (
          <span key={l.l} className="inline-flex items-center gap-1">
            <span className={`size-2 rounded-full ${l.c}`} />
            {l.l}
          </span>
        ))}
        <span className="ml-auto text-zinc-400">
          悬停卡片高亮镜像对应 · 点击卡片查看产物 · 轨迹图标查看执行轨迹
        </span>
      </div>
    </div>
  );
};
