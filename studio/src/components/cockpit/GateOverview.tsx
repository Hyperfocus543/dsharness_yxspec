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
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { STAGE_GROUPS, STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import type { DshGate, StageToken } from '../../data/types';
import { useStageStore } from '../../store/stageStore';
import { useToastStore } from '../../store/toastStore';
import { useStageDispatch } from '../../hooks/useStageDispatch';
import { EmptyState, Icon } from '../ui';
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

export const GateOverview: React.FC = () => {
  const dshState = useStageStore((s) => s.dshState);
  const stages = useStageStore((s) => s.stages);
  const { dispatch, sending, dispatchingCmd } = useStageDispatch();
  const pushToast = useToastStore((s) => s.push);

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

  if (!dshState) {
    return (
      <div className="border border-zinc-200 rounded-lg bg-white">
        <EmptyState
          icon={I.gauge}
          title="等待 dsh_state 加载"
          hint="门控全景读 .dsh/dsh_state.json 的门控快照，加载后自动点亮。"
        />
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

const GateCard: React.FC<{
  card: GateCardData;
  statusLabel?: string;
  busy: boolean;
  onClick: () => void;
}> = ({ card, statusLabel, busy, onClick }) => {
  const tone = STATE_TONE[card.state];
  const label = STATE_LABEL[card.state];
  // 异常（待产物 / 阻塞）才可点击派活；通过 / 无门控为纯展示
  const actionable = card.state === 'pending_spec' || card.state === 'blocked';
  const cmd = STAGE_TABLE[card.token]?.command || '';

  return (
    <button
      type="button"
      className={`text-left rounded-lg border-2 p-2.5 transition-all ${tone.border} ${tone.bg} ${
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
