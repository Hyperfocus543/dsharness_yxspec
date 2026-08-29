// =============================================================================
// GateOverview — 驾驶舱「门控全景」视图（A3）
// 读 useStageStore.dshState → dshState.stages[token].gate（upstream/spec_hit/message），
// 按 STAGE_GROUPS 分组展示每阶段门控三态：
//   绿  上游就绪 + 产物命中 spec_hit
//   琥珀 上游就绪但产物缺失（spec_hit=false）→ 待产物
//   红  上游未完成 → 阻塞
// 异常阶段高亮，点击卡片调 useStageDispatch().dispatch(command) 派活补齐。
// 顶部统计：通过 / 待产物 / 阻塞 计数。
// dshState 为 null → 「等待 dsh_state 加载」占位；gate 为 null（如 init）→「无门控」。
// command 从 STAGE_TABLE[token].command 取。
//
// 轨迹门控徽标（叠层，不取代三态底色）：gate_policy==='artifact+trajectory' 的
// 阶段在卡片右上叠加「迹」徽标，色随轨迹证据三态（gate_trajectory），
// hover 显示门控证据 tooltip（策略/轨迹三态/原因/产物命中）。数据源 =
// stageStore 已拉取的 /api/trajectory-gate 全量汇总，不额外发请求。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { STAGE_GROUPS, STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import type { DshGate, StageToken } from '../../data/types';
import { useStageStore } from '../../store/stageStore';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { Button, EmptyState, Icon } from '../ui';
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

/** 门控三态 */
type GateState = 'ok' | 'pending_spec' | 'blocked' | 'none';

interface GateCardData {
  token: StageToken;
  gate: DshGate | null;
  state: GateState;
  upstreamReady: boolean;
  missing: string[];
}

// 门控三态色 — Claude 暖系语义
// ok(通过)：sage 暖绿（柔和，区别于阻塞绯红，避免"通过/阻塞同色"）
// blocked(阻塞)：暖绯红（警示）
// pending_spec(待产物)：琥珀（暖橙）
const STATE_TONE: Record<GateState, { border: string; bg: string; dot: string }> = {
  ok: { border: 'border-sage-300', bg: 'bg-sage-50', dot: 'bg-sage-500' },
  pending_spec: { border: 'border-amber-400', bg: 'bg-amber-50', dot: 'bg-amber-500' },
  blocked: { border: 'border-red-300', bg: 'bg-red-50', dot: 'bg-red-500' },
  none: { border: 'border-zinc-200', bg: 'bg-zinc-50', dot: 'bg-zinc-400' },
};

const STATE_LABEL: Record<GateState, string> = {
  ok: '通过',
  pending_spec: '待产物',
  blocked: '阻塞',
  none: '无门控',
};

/** 轨迹证据三态 → 徽标文案/样式（与 TrajectoryPanel GATE_BADGE 语义一致）。 */
const TRAJ_BADGE: Record<string, { label: string; cls: string; tone: 'sage' | 'amber' | 'red' }> = {
  verified: { label: '迹·通过', cls: 'bg-sage-100 text-sage-700 border-sage-300', tone: 'sage' },
  unverified: { label: '迹·未验证', cls: 'bg-amber-100 text-amber-700 border-amber-300', tone: 'amber' },
  blocked: { label: '迹·打回', cls: 'bg-red-100 text-red-700 border-red-300', tone: 'red' },
};

/** 门控打回/警告原因 → 人类可读文案（与 useStageDispatch 契约一致）。 */
const REASON_TEXT: Record<string, string> = {
  'trajectory-blocked': '轨迹证据打回（failed/interrupted/反复失败）',
  'trajectory-unverified': '轨迹存在但缺关键证据（无 turn/end 或全工具失败）',
  'no-trajectory': '无轨迹记录（该阶段从未执行）',
  'artifact-passed-no-trajectory': '产物命中但无轨迹（策略 artifact+trajectory 需证据）',
  'artifact-missing': '产物缺失',
  'upstream-blocked': '上游阶段未完成',
};

export const GateOverview: React.FC = () => {
  const dshState = useStageStore((s) => s.dshState);
  const dshError = useStageStore((s) => s.dshError);
  const loadDshState = useStageStore((s) => s.loadDshState);
  const stages = useStageStore((s) => s.stages);
  const { dispatch, sending, dispatchingCmd } = useStageDispatch();
  const pushToast = useToastStore((s) => s.push);
  const projectPath = useProjectStore((s) => s.current?.path || '');

  // 轨迹门控汇总（stageStore 已在 loadDshState 时拉取 /api/trajectory-gate 全量，
  // 各阶段 gate_trajectory/gate_policy/gate_reason 已合并进 stages）——直接复用，
  // 不额外发请求。数据缺失（网关未起/未拉取）→ undefined，卡片不渲染「迹」徽标。
  const trajGateOf = React.useCallback((token: string) => {
    const s = stages[token as StageToken];
    if (!s?.gate_policy) return null;
    return {
      policy: s.gate_policy,
      status: s.gate_trajectory ?? null,
      reason: s.gate_reason ?? null,
    };
  }, [stages]);

  const cards = React.useMemo<GateCardData[]>(() => {
    if (!dshState?.stages) return [];
    return STAGE_ORDER.map((token) => {
      const entry = dshState.stages?.[token];
      if (!entry?.gate) {
        // 无 gate（如 init）：按无门控展示
        return {
          token,
          gate: null,
          state: 'none' as GateState,
          upstreamReady: true,
          missing: [],
        };
      }
      const upstream = entry.gate.upstream ?? {};
      const missing = Object.entries(upstream)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);
      const upstreamReady = missing.length === 0;
      let state: GateState;
      if (!upstreamReady) state = 'blocked';
      else if (entry.gate.spec_hit) state = 'ok';
      else state = 'pending_spec';
      return { token, gate: entry.gate, state, upstreamReady, missing };
    });
  }, [dshState]);

  const stats = React.useMemo(() => {
    let ok = 0;
    let pending = 0;
    let blocked = 0;
    for (const c of cards) {
      if (c.state === 'ok') ok++;
      else if (c.state === 'pending_spec') pending++;
      else if (c.state === 'blocked') blocked++;
    }
    return { ok, pending, blocked };
  }, [cards]);

  // 重试：重跑 loadDshState（会刷新 dsh_state 快照并恢复/重建网关事件订阅，幂等安全）
  const handleRetry = () => {
    if (!projectPath) {
      pushToast('warn', '当前未打开项目，无法重试加载门控快照');
      return;
    }
    void loadDshState(projectPath).catch(() => {});
  };

  if (!dshState) {
    // dsh_state 缺失/读取失败（dshError）≠ 正在加载：给专属错误态 + 可用的重试，
    // 避免新项目/瞬时读取失败永久停在「等待加载」占位（无数据、无出路）。
    if (dshError) {
      return (
        <div className="space-y-3">
          <div className="border border-zinc-200 rounded-lg bg-white">
            <EmptyState
              icon={I.gauge}
              title="门控快照不可用"
              hint="未读到 .dsh/dsh_state.json（项目可能尚无该文件，或读取中断）。生成后点下方重试即可点亮门控全景。"
            />
          </div>
          <div className="flex justify-center">
            <Button variant="secondary" size="sm" onClick={handleRetry}>
              <Icon name={I.refresh} size={14} />
              重试
            </Button>
          </div>
        </div>
      );
    }
    // 首次加载中：骨架屏（与驾驶舱其他视图同款，不闪「等待加载」占位）
    return (
      <div className="border border-zinc-200 rounded-lg bg-white p-3 space-y-2" role="status" aria-busy="true" aria-label="正在加载门控快照">
        <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/3" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 bg-zinc-100 rounded animate-pulse" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-zinc-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  const dispatchFor = (token: StageToken) => {
    const command = STAGE_TABLE[token]?.command;
    if (!command) {
      pushToast('warn', `${token} 无可用命令（无原生 slash 命令）`);
      return;
    }
    dispatch(command);
  };

  const busy = (token: StageToken) => sending && dispatchingCmd === STAGE_TABLE[token]?.command;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
          <span className="text-emerald-600">
            <Icon name={I.shield} size={16} weight="fill" />
          </span>
          门控全景
        </h3>
        <p className="text-xs text-zinc-500 mt-1">
          按 ASPICE 分组展示各阶段门控状态；异常阶段点击可直接派活补齐。
        </p>
      </div>

      {/* 顶部统计 */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="通过"
          value={stats.ok}
          tone="ok"
          icon={I.checkCircle}
        />
        <StatTile
          label="待产物"
          value={stats.pending}
          tone="warn"
          icon={I.warn}
        />
        <StatTile
          label="阻塞"
          value={stats.blocked}
          tone="err"
          icon={I.xCircle}
        />
      </div>

      {/* 分组门控卡片 */}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {tokens.map((token) => {
                  const card = cards.find((c) => c.token === token);
                  if (!card) return null;
                  return (
                    <GateCard
                      key={token}
                      card={card}
                      statusLabel={stages[token]?.status}
                      busy={busy(token)}
                      onClick={() => dispatchFor(token)}
                      trajGate={trajGateOf(token)}
                    />
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

const StatTile: React.FC<{
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'err';
  icon: React.ElementType;
}> = ({ label, value, tone, icon }) => {
  const tones = {
    ok: 'border-sage-300 bg-sage-50 text-sage-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-700',
    err: 'border-red-200 bg-red-50 text-red-700',
  };
  return (
    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-2.5 ${tones[tone]}`}>
      <span>
        <Icon name={icon} size={18} weight="fill" />
      </span>
      <div>
        <div className="text-lg font-bold leading-none tabular-nums">{value}</div>
        <div className="text-xs mt-0.5 opacity-80">{label}</div>
      </div>
    </div>
  );
};

/** 轨迹门控叠加信息（GateOverview 透传；null = 非轨迹策略/无数据 → 不渲染徽标）。 */
interface TrajGateInfo {
  policy: 'artifact' | 'artifact+trajectory';
  status: 'verified' | 'unverified' | 'blocked' | null;
  reason: string | null;
}

const GateCard: React.FC<{
  card: GateCardData;
  statusLabel?: string;
  busy: boolean;
  onClick: () => void;
  trajGate?: TrajGateInfo | null;
}> = ({ card, statusLabel, busy, onClick, trajGate }) => {
  const tone = STATE_TONE[card.state];
  const label = STATE_LABEL[card.state];
  // 异常（待产物 / 阻塞）才可点击派活；通过 / 无门控为纯展示
  const actionable = card.state === 'pending_spec' || card.state === 'blocked';
  const cmd = STAGE_TABLE[card.token]?.command || '';
  // 轨迹证据徽标：仅 artifact+trajectory 策略显示；无三态时按「未验证」兜底（产物命中但无轨迹）
  const trajBadge = trajGate?.policy === 'artifact+trajectory'
    ? TRAJ_BADGE[trajGate.status ?? 'unverified']
    : null;
  const trajTooltip = [
    `门控策略：${trajGate?.policy ?? 'artifact'}`,
    `产物：${card.gate?.spec_hit ? '已命中' : '缺失'}`,
    `轨迹证据：${trajGate?.status ? (TRAJ_BADGE[trajGate.status]?.label ?? trajGate.status) : '未参与/无数据'}`,
    trajGate?.reason ? `判定：${REASON_TEXT[trajGate.reason] ?? trajGate.reason}` : null,
  ]
    .filter((l): l is string => Boolean(l))
    .join('\n');

  return (
    <button
      type="button"
      className={`text-left relative rounded-lg border-2 p-2.5 transition-all ${tone.border} ${tone.bg} ${
        actionable
          ? 'cursor-pointer hover:shadow-md active:scale-[0.98]'
          : 'cursor-default'
      }`}
      onClick={actionable ? onClick : undefined}
      title={
        actionable
          ? `点击派活补齐：${cmd}`
          : cmd || `未定义命令（gate 为 null）`
      }
    >
      {trajBadge && (
        <span
          className={`absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold shadow-sm inline-flex items-center gap-0.5 ${trajBadge.cls}`}
          title={`轨迹证据（hover 查看门控证据）\n${trajTooltip}`}
        >
          <Icon name={I.tag} size={9} weight="fill" />
          {trajBadge.label}
        </span>
      )}
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-mono text-zinc-500 truncate">
          {STAGE_TABLE[card.token]?.aspice || '—'}
        </span>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${tone.dot}`} />
      </div>
      <div className="text-sm font-semibold text-zinc-800 mt-1 font-mono truncate" title={card.token}>
        {card.token}
      </div>
      <div className="flex items-center justify-between mt-1.5 gap-1">
        <span
          className={`text-xs font-medium px-1.5 py-0.5 rounded ${
            card.state === 'ok'
              ? 'bg-sage-100 text-sage-700'
              : card.state === 'pending_spec'
                ? 'bg-amber-100 text-amber-700'
                : card.state === 'blocked'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-zinc-200 text-zinc-500'
          }`}
        >
          {label}
        </span>
        {busy && (
          <span className="text-[10px] text-zinc-500 inline-flex items-center gap-1">
            <Icon name={I.clock} size={11} weight="fill" className="text-amber-500" />
            派活中
          </span>
        )}
      </div>
      {(card.state === 'blocked' && card.missing.length > 0) ||
      (card.state === 'pending_spec' && card.gate?.message) ? (
        <div className="mt-1.5 text-[11px] leading-tight text-zinc-600 bg-white/60 rounded px-1.5 py-1 break-words">
          {card.state === 'blocked' ? (
            <>
              上游未完成：
              <span className="text-red-700 font-medium">{card.missing.join('、')}</span>
            </>
          ) : (
            card.gate?.message || '产物缺失'
          )}
        </div>
      ) : null}
      {card.state === 'none' && (
        <div className="mt-1.5 text-[11px] text-zinc-400">该阶段无门控定义</div>
      )}
    </button>
  );
};
