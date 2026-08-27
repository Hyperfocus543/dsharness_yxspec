// =============================================================================
// 阶段进度报告 - ReportExport（纯前端，无后端依赖）
// 功能商店插件：ui-report 开启后左侧出现「周报」功能卡。
// 数据源：useStageStore（stages / dshState）+ useProjectStore（current.meta.spec_id）
// 能力：整体进度 + 按 STAGE_GROUPS 分组的阶段明细表 + 复制 Markdown + 下载 .md
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================
// 修复记录（2026-08-25）：
//   1. 门控三态：不再把"正向提示（产物已存在可进 review）"当阻塞渲染成红色警告。
//      gate_state 由 computeGateState 判定：blocked 红（真阻塞）/ pending 琥珀（待补）
//      / ok 绿（正向）。"阻塞与待产物"清单只收真阻塞。
//   2. 数据新鲜度：顶部显示 store.lastUpdate（"数据更新于 xx:xx"）+ 手动刷新按钮
//      （reloadDshState 重拉 dsh_state.json）。
//   3. 所见即所导：页面表格与 buildMarkdown 共用同一份 buildRows() 组装行数据，
//      杜绝两套遍历逻辑分叉。
//   4. 定位与空态：标题改「阶段进度报告」（非"周报导出"）；无项目时给空状态提示。
// =============================================================================

import React from 'react';
import { STAGE_GROUPS, STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import { useStageStore, computeGateState } from '../../store/stageStore';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import { Badge, Button, Icon, Panel, PanelHeader, EmptyState } from '../ui';
import { I } from '../ui/icons';
import type { StageStatus, StageToken } from '../../data/types';

/** 状态中文映射（报告 md 用词，与 STATUS_LABEL 略有差异：待审/被拒/需重做）*/
const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  in_progress: '进行中',
  pending: '未开始',
  pending_review: '待审',
  blocked: '阻塞',
  rejected: '被拒',
  stale: '需重做',
};

/** 门控三态 → 中文标签 */
const GATE_LABEL: Record<string, string> = {
  blocked: '阻塞',
  pending: '待补',
  ok: '就绪',
};

export const ReportExport: React.FC = () => {
  const stages = useStageStore((s) => s.stages);
  const dshState = useStageStore((s) => s.dshState);
  const lastUpdate = useStageStore((s) => s.lastUpdate);
  const eventsConnected = useStageStore((s) => s.eventsConnected);
  const loadDshState = useStageStore((s) => s.loadDshState);
  const project = useProjectStore((s) => s.current);
  const pushToast = useToastStore((s) => s.push);
  const [refreshing, setRefreshing] = React.useState(false);

  // 实时订阅：挂载时若 SSE 未连接 → loadDshState 幂等重连（内部 connectEvents）。
  // 此后 stage/update 事件实时更新 stages/lastUpdate，报告跟随刷新，无需手动点。
  const projectPath = project?.path || '';
  const specId = project?.meta?.spec_id || '—';
  React.useEffect(() => {
    if (!projectPath) return;
    if (!useStageStore.getState().eventsConnected) {
      loadDshState(projectPath).catch(() => {});
    }
  }, [projectPath, loadDshState]);

  // 总进度：STAGE_ORDER 里 status === 'completed' 计数
  const done = STAGE_ORDER.filter((t) => stages[t]?.status === 'completed').length;
  const total = STAGE_ORDER.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  /** 门控 message：优先 dshState.stages[token].gate.message，回退 stages[token].gate_message */
  const gateMessageOf = (token: StageToken): string =>
    dshState?.stages?.[token]?.gate?.message || stages[token]?.gate_message || '';

  /** 门控三态：优先 stageStore 已算好的 gate_state，回退用 dsh_state 现算 */
  const gateStateOf = (token: StageToken): StageStatus['gate_state'] | undefined =>
    stages[token]?.gate_state ?? computeGateState(dshState?.stages?.[token]?.gate);

  /** 产物数：优先 dshState.artifacts 数组长度，回退 stages.artifacts_count / artifacts.length */
  const artifactCountOf = (token: StageToken): number => {
    const dshArtifacts = dshState?.stages?.[token]?.artifacts;
    if (Array.isArray(dshArtifacts)) return dshArtifacts.length;
    const st = stages[token];
    return st?.artifacts_count ?? st?.artifacts?.length ?? 0;
  };

  /** 清理 markdown 表格单元格：转义管道符、折叠换行 */
  const sanitizeCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

  // ---- 单一数据组装：页面表格与 buildMarkdown 共用，所见即所导 ----
  interface Row {
    token: StageToken;
    aspice: string;
    status: StageStatus['status'];
    statusLabel: string;
    artifactCount: number;
    gateMessage: string;
    gateState: StageStatus['gate_state'] | undefined;
  }
  const buildRows = (): Row[] =>
    STAGE_ORDER.map((token) => {
      const m = STAGE_TABLE[token];
      const status = stages[token]?.status || 'pending';
      const gateState = gateStateOf(token);
      return {
        token,
        aspice: m.aspice,
        status,
        statusLabel: STATUS_LABEL[status] || '未开始',
        artifactCount: artifactCountOf(token),
        gateMessage: gateMessageOf(token),
        gateState,
      };
    });

  /** 手动刷新：重拉 dsh_state.json（网关/外部改动后前端同步） */
  const handleRefresh = async () => {
    if (!projectPath || refreshing) return;
    setRefreshing(true);
    try {
      await loadDshState(projectPath);
      pushToast('success', '已重新加载 dsh_state 数据');
    } catch (e: any) {
      pushToast('error', `刷新失败: ${e?.message || e}`);
    } finally {
      setRefreshing(false);
    }
  };

  /** 组装周报 Markdown（与 buildRows 共用行数据） */
  const buildMarkdown = (): string => {
    const date = new Date().toISOString().slice(0, 10);
    const rows = buildRows();
    const lines: string[] = [];
    lines.push('# YXSpec 阶段进度报告');
    lines.push(`- 项目代号：${specId}`);
    lines.push(`- 生成日期：${date}`);
    lines.push(`- 整体进度：${done}/${total}（${pct}%）`);
    lines.push('');
    lines.push('## 阶段明细');
    lines.push('');
    for (const [group, tokens] of Object.entries(STAGE_GROUPS)) {
      if (tokens.length === 0) continue;
      lines.push(`### ${group}`);
      lines.push('| 阶段 | ASPICE | 状态 | 产物 | 门控 |');
      lines.push('|---|---|---|---|---|');
      for (const token of tokens) {
        const r = rows.find((x) => x.token === token);
        if (!r) continue;
        const gateCell = r.gateMessage ? `${GATE_LABEL[r.gateState || 'pending'] || ''}：${sanitizeCell(r.gateMessage)}` : '—';
        lines.push(`| ${token} | ${r.aspice} | ${r.statusLabel} | ${r.artifactCount} | ${gateCell} |`);
      }
      lines.push('');
    }
    lines.push('## 阻塞与待产物');
    const blocks = rows.filter((r) => r.gateMessage && r.gateState === 'blocked');
    if (blocks.length === 0) {
      lines.push('- 无阻塞');
    } else {
      for (const b of blocks) {
        lines.push(`- ${b.token}: ${sanitizeCell(b.gateMessage)}`);
      }
    }
    return lines.join('\n');
  };

  /** 复制 Markdown 到剪贴板；失败静默 */
  const handleCopy = async () => {
    const md = buildMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      pushToast('success', '报告 Markdown 已复制到剪贴板');
    } catch {
      // 剪贴板不可用时静默失败
    }
  };

  /** 下载 .md 文件 */
  const handleDownload = () => {
    const md = buildMarkdown();
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yxspec-进度报告-${date}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 未选项目：空状态
  if (!projectPath) {
    return (
      <div className="p-8">
        <EmptyState icon={I.fileText} title="未选择项目" hint="请先在上方选择项目，再生成阶段进度报告" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* 顶部：标题 + 导出按钮 + 数据新鲜度 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold text-zinc-800">阶段进度报告</h3>
          <div className="text-xs text-zinc-400 mt-0.5 inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  eventsConnected ? 'bg-sage-500' : 'bg-zinc-300'
                }`}
                title={eventsConnected ? '已实时订阅网关事件' : '未连接（可点刷新拉取最新数据）'}
              />
              {eventsConnected ? '实时' : '离线'}
            </span>
            <span>数据更新于 {lastUpdate ? new Date(lastUpdate).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
            >
              <Icon name={I.refresh} size={12} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? '刷新中' : '刷新'}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            <Icon name={I.clipboard} size={14} />
            复制 Markdown
          </Button>
          <Button variant="primary" size="sm" onClick={handleDownload}>
            <Icon name={I.download} size={14} />
            下载 .md
          </Button>
        </div>
      </div>

      {/* 项目信息 + 整体进度 */}
      <Panel className="p-4">
        <div className="text-sm text-zinc-600">
          <span className="text-zinc-400">项目代号：</span>
          <span className="font-mono text-zinc-800">{specId}</span>
          {projectPath && (
            <span className="text-xs text-zinc-400 ml-2 truncate" title={projectPath}>
              {projectPath}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="font-semibold text-zinc-700">整体进度</span>
          <span className="font-mono text-zinc-600 tabular-nums">
            {done}/{total}（{pct}%）
          </span>
        </div>
        <div className="mt-2 w-full bg-zinc-200 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-sage-500 h-2.5 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </Panel>

      {/* 按 STAGE_GROUPS 分组的阶段明细表 */}
      <div className="space-y-4">
        {Object.entries(STAGE_GROUPS).map(([group, tokens]) => {
          if (tokens.length === 0) return null;
          return (
            <Panel key={group}>
              <PanelHeader title={`${group}（${tokens.length} 阶段）`} icon={I.stack} />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-400 border-b border-zinc-200">
                      <th className="px-3 py-2 font-medium">阶段</th>
                      <th className="px-3 py-2 font-medium">ASPICE</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">产物</th>
                      <th className="px-3 py-2 font-medium">门控</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((token) => {
                      const m = STAGE_TABLE[token];
                      const status = stages[token]?.status || 'pending';
                      const gateMsg = gateMessageOf(token);
                      const gateState = gateStateOf(token);
                      return (
                        <tr key={token} className="border-b border-zinc-100 last:border-0">
                          <td className="px-3 py-2 font-mono text-zinc-700">{token}</td>
                          <td className="px-3 py-2 font-mono text-zinc-500">{m.aspice}</td>
                          <td className="px-3 py-2">
                            <Badge status={status} />
                          </td>
                          <td className="px-3 py-2 text-zinc-600 tabular-nums">
                            {artifactCountOf(token)}
                          </td>
                          <td className="px-3 py-2">
                            {gateMsg ? (
                              <span
                                className={`inline-flex items-center gap-1 min-w-0 ${
                                  gateState === 'blocked'
                                    ? 'text-red-600'
                                    : gateState === 'pending'
                                      ? 'text-amber-600'
                                      : 'text-sage-600'
                                }`}
                                title={gateMsg}
                              >
                                <Icon
                                  name={gateState === 'blocked' ? I.warn : I.check}
                                  size={11}
                                  weight="fill"
                                  className="shrink-0"
                                />
                                <span className="truncate max-w-[220px]">{gateMsg}</span>
                              </span>
                            ) : (
                              <span className="text-zinc-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* 阻塞与待产物：只收真阻塞（gate_state === 'blocked'） */}
      <Panel>
        <PanelHeader title="阻塞与待产物" icon={I.warn} />
        <div className="p-3 space-y-1.5">
          {(() => {
            const blocks = STAGE_ORDER.filter((t) => gateMessageOf(t) && gateStateOf(t) === 'blocked');
            if (blocks.length === 0) {
              return <div className="text-xs text-zinc-500">无阻塞</div>;
            }
            return blocks.map((token) => (
              <div key={token} className="flex items-start gap-1.5 text-xs text-red-600">
                <Icon name={I.warn} size={12} weight="fill" className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">
                  <span className="font-mono font-semibold">{token}</span>：{gateMessageOf(token)}
                </span>
              </div>
            ));
          })()}
        </div>
      </Panel>
    </div>
  );
};
