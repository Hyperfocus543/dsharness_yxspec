// =============================================================================
// StageVModel — 驾驶舱「V 模型」视图（ASPICE V+ 体系全景）
// 左列：开发链（ACQ→SYS→SWE 需求/设计/编码，顶→底）
// 右列：验证链（SWE.4 单测→SWE.5 集成→SQT 系统测试→SUP/发布，底→顶）
// 中轴：SVG V 折线（开发向下、验证向上、底部编码↔单测连接）
// 左右逐行镜像对应（同一行 = 开发↔验证的追溯关系，title 提示）
// 数据：STAGE_TABLE 现成（token/aspice/状态/产物数），零后端依赖。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { STAGE_TABLE } from '../../data/stage-mapping';
import type { StageStatus, StageToken } from '../../data/types';
import { Icon } from '../ui';
import { I } from '../ui/icons';

/** 左列开发链（顶→底，11 行） */
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
  'swe_coding_do',   // SWE.4  编码（开发链底部）
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

/** 节点状态色点（与 StageNode 同语义：completed sage / in_progress amber / 其余 zinc） */
function nodeTone(status: StageStatus | undefined): string {
  if (!status) return 'bg-zinc-300';
  switch (status.status) {
    case 'completed':
      return 'bg-sage-500';
    case 'in_progress':
      return 'bg-amber-500';
    case 'pending_review':
      return 'bg-orange-400';
    case 'rejected':
    case 'blocked':
      return 'bg-red-500';
    case 'stale':
      return 'bg-purple-500';
    default:
      return 'bg-zinc-300';
  }
}

interface VNodeProps {
  token: StageToken;
  status: StageStatus | undefined;
  onSelectStage?: (token: string) => void;
}

/** V 节点：小卡片（状态点 + token + aspice + 产物数），点击开产物抽屉 */
const VNode: React.FC<VNodeProps> = ({ token, status, onSelectStage }) => {
  const m = STAGE_TABLE[token];
  const n = status?.artifacts_count ?? status?.artifacts?.length ?? 0;
  return (
    <button
      type="button"
      onClick={() => onSelectStage?.(token)}
      className="group w-full text-left bg-white border border-zinc-200 hover:border-emerald-300 hover:bg-emerald-50/40 rounded-md px-2 py-1 transition-all active:scale-[0.98] flex items-center gap-1.5"
      title={`${m?.aspice} · ${m?.command ?? token} · ${n} 产物`}
    >
      <span className={`shrink-0 size-2 rounded-full ${nodeTone(status)}`} />
      <span className="text-[11px] font-mono font-semibold text-zinc-700 truncate">{token}</span>
      <span className="text-[10px] text-zinc-400 shrink-0">{m?.aspice}</span>
      <span className="ml-auto text-[10px] text-zinc-400 shrink-0 tabular-nums">{n}</span>
    </button>
  );
};

interface StageVModelProps {
  stages: Record<string, StageStatus>;
  currentStage: string | null;
  onSelectStage?: (token: string) => void;
}

/** V 模型视图：左开发右验证 + SVG V 折线中轴 + 底部连接标注 */
export const StageVModel: React.FC<StageVModelProps> = ({ stages, currentStage, onSelectStage }) => {
  void currentStage;
  const doneCount = LEFT_CHAIN.filter((t) => stages[t]?.status === 'completed').length +
    RIGHT_CHAIN.filter((t) => stages[t]?.status === 'completed').length;
  const total = LEFT_CHAIN.length + RIGHT_CHAIN.length;
  const pct = Math.round((doneCount / total) * 100);

  return (
    <div className="space-y-3">
      {/* 顶栏：标题 + 开发/验证进度 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-zinc-800 flex items-center gap-2">
          <span className="text-emerald-600"><Icon name={I.branch} size={16} /></span>
          V 模型全景
          <span className="text-xs font-normal text-zinc-400">ASPICE V+ · 左开发右验证 · 逐行镜像</span>
        </span>
        <span className="text-xs text-zinc-500">
          完成 <span className="font-mono text-zinc-700 tabular-nums">{doneCount}/{total}</span>
          <span className="text-zinc-400">（{pct}%）</span>
        </span>
      </div>

      <div className="relative grid grid-cols-[1fr_56px_1fr] gap-2">
        {/* SVG V 折线（中轴）：左(2%)→底(50,92)→右(98%) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polyline
            points="3,3 50,88 97,3"
            fill="none"
            stroke="#d4d4d8"
            strokeWidth="0.8"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="2 1.5"
          />
          {/* 底部连接点（编码↔单测） */}
          <circle cx="50" cy="88" r="1.4" fill="#10b981" />
        </svg>

        {/* 左列：开发链（顶→底） */}
        <div className="flex flex-col gap-1.5">
          {LEFT_CHAIN.map((t) => (
            <VNode
              key={t}
              token={t}
              status={stages[t]}
              onSelectStage={onSelectStage}
            />
          ))}
        </div>

        {/* 中轴标注（底部连接说明） */}
        <div className="flex flex-col items-center justify-end pb-0.5">
          <span className="text-[10px] text-emerald-600 font-semibold whitespace-nowrap">
            编码 ↔ 验证
          </span>
        </div>

        {/* 右列：验证链（底→顶；数组已按 V 顺序排，渲染时反转显示方向） */}
        <div className="flex flex-col gap-1.5 justify-end">
          {[...RIGHT_CHAIN].reverse().map((t) => (
            <VNode
              key={t}
              token={t}
              status={stages[t]}
              onSelectStage={onSelectStage}
            />
          ))}
        </div>
      </div>

      {/* 图例 */}
      <div className="flex items-center gap-3 text-[10px] text-zinc-400 flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-sage-500" />已完成</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" />进行中</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-zinc-300" />未开始</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-red-500" />阻塞/打回</span>
        <span className="ml-auto text-zinc-300">点击节点查看产物 · 虚线 = 开发/验证镜像对应</span>
      </div>
    </div>
  );
};
