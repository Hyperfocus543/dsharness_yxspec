// =============================================================================
// BatchQueue — 驾驶舱「批处理队列」卡（A1）
// 把 STAGE_ORDER 全部阶段列成可勾选队列，串行派活：for...await
// useStageDispatch().dispatch(command)，一次只派一个（网关串行闸门）。
//    · 每阶段完成后自动推进下一个
//    · 遇到返回 'blocked' 停下，用 toast 提示未完成上游
//    · 选中但已 done 的阶段自动跳过
//    · 运行中显示「中止」（走 cancel 杀当前 runtime）
// 进度条「3/8」+ 当前阶段 + 已执行秒数（useStageDispatch.elapsedSec）。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { STAGE_GROUPS, STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import type { StageToken } from '../../data/types';
import { useStageStore } from '../../store/stageStore';
import { useToastStore } from '../../store/toastStore';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { renderInline } from '../../utils/markdown';
import { Badge, Button, Icon } from '../ui';
import { I } from '../ui/icons';

const GROUP_LABEL: Record<string, string> = {
  ACQ: 'ACQ.4',
  SYS: 'SYS.1-3',
  HWE: 'HWE.1',
  SWE: 'SWE.1-5',
  SQT: 'SYS.5/SUP.8',
  COMP: 'SUP.1-2',
  REL: 'SPL.2',
};

export const BatchQueue: React.FC = () => {
  const stages = useStageStore((s) => s.stages);
  const pushToast = useToastStore((s) => s.push);
  const { dispatch, cancel, sending, cancelling, elapsedSec } = useStageDispatch();

  const [selected, setSelected] = React.useState<Set<StageToken>>(new Set());
  const [running, setRunning] = React.useState(false);
  const [current, setCurrent] = React.useState<StageToken | null>(null);
  const [doneCount, setDoneCount] = React.useState(0);
  const [queueLen, setQueueLen] = React.useState(0);
  // 同步取消标记：running 是 state（异步），ref 立即可见，供批处理循环判断
  const runningRef = React.useRef(false);

  const total = STAGE_ORDER.length;
  const pct = queueLen > 0 ? Math.round((doneCount / queueLen) * 100) : 0;

  const toggle = (token: StageToken) => {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  };

  const selectRunnable = () => {
    if (running) return;
    const next = new Set<StageToken>();
    for (const t of STAGE_ORDER) {
      if (stages[t]?.status !== 'completed') next.add(t);
    }
    setSelected(next);
  };

  const clearAll = () => {
    if (running) return;
    setSelected(new Set());
  };

  // 串行批处理核心：一次只派一个，await 到终态再进下一个。
  const runBatch = async () => {
    if (runningRef.current) return;
    // 队列 = 已勾选 且 未 completed（选中但已 done 的跳过）
    const queue = STAGE_ORDER.filter((t) => selected.has(t) && stages[t]?.status !== 'completed');
    if (queue.length === 0) {
      pushToast('info', '批处理队列为空：先勾选未完成阶段，或点「全选可推进的」');
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setDoneCount(0);
    setQueueLen(queue.length);
    let stopped = false;
    try {
      for (let i = 0; i < queue.length; i++) {
        if (!runningRef.current) {
          stopped = true; // 用户中止
          break;
        }
        const token = queue[i];
        const mapping = STAGE_TABLE[token];
        setCurrent(token);
        const result = await dispatch(mapping.command);
        if (result === 'blocked') {
          const upstream = mapping.upstream.length > 0 ? mapping.upstream.join('、') : '未知上游';
          pushToast('warn', `批处理暂停：${token} 上游未完成（${upstream}），先补齐再续跑`);
          stopped = true;
          break;
        }
        if (result === 'error') {
          if (runningRef.current) pushToast('error', `批处理中断：${token} 执行失败`);
          stopped = true;
          break;
        }
        if (result === false) {
          // dispatch 未发起（并发锁命中，理论不该发生），跳过该阶段不计数
          pushToast('warn', `跳过 ${token}：派活未发起`);
          continue;
        }
        setDoneCount((n) => n + 1);
      }
      if (!stopped && queue.length > 0) {
        pushToast('success', `批处理完成：${queue.length} 个阶段全部执行完成`);
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      setCurrent(null);
    }
  };

  // 中止：先置 ref 让循环下一轮退出，再 cancel 杀当前 runtime（派活中 turn 会快速返回 error）
  const handleAbort = () => {
    runningRef.current = false;
    cancel();
  };

  return (
    <div className="p-4 space-y-4">
      {/* 标题 + 说明 */}
      <div>
        <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
          <span className="text-emerald-600">
            <Icon name={I.listChecks} size={16} weight="fill" />
          </span>
          批处理队列
        </h3>
        <p className="text-xs text-zinc-500 mt-1">
          串行派活：一次只执行一个阶段，每阶段完成后自动推进下一个；遇门控阻塞自动暂停。
        </p>
      </div>

      {/* 顶部操作 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="secondary" size="sm" onClick={selectRunnable} disabled={running}>
          <Icon name={I.checkCircle} size={14} />
          全选可推进的
        </Button>
        <Button variant="ghost" size="sm" onClick={clearAll} disabled={running}>
          <Icon name={I.trash} size={14} />
          清空
        </Button>
        <span className="text-xs text-zinc-500 ml-1">
          已选 <span className="font-mono text-zinc-700">{selected.size}</span>/{total}
        </span>
        <div className="flex-1" />
        {running ? (
          <Button variant="danger" size="sm" onClick={handleAbort} disabled={cancelling}>
            <Icon name={I.stop} size={14} weight="fill" />
            {cancelling ? '中止中…' : '中止'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={runBatch}
            disabled={selected.size === 0}
            title="按勾选顺序串行派活（跳过已完成的阶段）"
          >
            <Icon name={I.play} size={14} weight="fill" />
            开始批处理
          </Button>
        )}
      </div>

      {/* 进度条 */}
      <div className="bg-white rounded-lg border border-zinc-200 p-3">
        <div className="flex items-center justify-between mb-1.5 text-xs text-zinc-600">
          <span className="inline-flex items-center gap-1.5">
            {running ? (
              <>
                <span className="text-amber-500 animate-pulse">
                  <Icon name={I.bolt} size={12} weight="fill" />
                </span>
                {current ? `正在执行：${current}` : '准备中…'}
              </>
            ) : (
              '批处理进度'
            )}
          </span>
          <span className="font-mono tabular-nums">
            {doneCount}/{queueLen || '—'}
          </span>
        </div>
        <div className="w-full bg-zinc-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-sage-500 h-2 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {running && current && (
          <div className="mt-1.5 text-xs text-zinc-500">
            已执行 <span className="font-mono tabular-nums">{elapsedSec}s</span>
            <span className="text-zinc-400">
              {' · '}
              {STAGE_TABLE[current]?.aspice || '—'}
            </span>
          </div>
        )}
      </div>

      {/* 阶段勾选列表（按 STAGE_GROUPS 分组） */}
      <div className="space-y-5">
        {Object.entries(STAGE_GROUPS).map(([group, tokens]) => {
          if (tokens.length === 0) return null;
          return (
            <div key={group}>
              <h4 className="text-xs font-bold text-zinc-600 mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-zinc-200 rounded text-[11px] text-zinc-600">
                  {GROUP_LABEL[group]}
                </span>
                {group}（{tokens.length} 阶段）
              </h4>
              <div className="space-y-1.5">
                {tokens.map((token) => {
                  const mapping = STAGE_TABLE[token];
                  const status = stages[token];
                  const completed = status?.status === 'completed';
                  const artifactCount =
                    status?.artifacts_count ?? status?.artifacts?.length ?? 0;
                  return (
                    <div
                      key={token}
                      className={`flex items-center gap-3 bg-white border border-zinc-200 rounded px-3 py-2 ${
                        completed ? 'opacity-50' : ''
                      } ${running ? 'cursor-not-allowed' : ''}`}
                      title={completed ? '已完成，批处理时自动跳过' : `${mapping.command}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(token)}
                        onChange={() => toggle(token)}
                        disabled={running}
                        className="size-4 shrink-0 accent-emerald-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-800 font-mono">
                            {token}
                          </span>
                          <span className="text-xs text-zinc-500">{mapping.aspice}</span>
                          {status && <Badge status={status.status} />}
                        </div>
                        <div className="text-xs text-zinc-400 font-mono truncate">
                          {mapping.command}
                        </div>
                      </div>
                      <span className="text-xs text-zinc-500 shrink-0 tabular-nums">
                        {artifactCount} 产物
                      </span>
                      {status?.gate_message && (
                        <span
                          className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 max-w-[220px] truncate shrink-0"
                          title={status.gate_message}
                        >
                          {renderInline(status.gate_message)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
