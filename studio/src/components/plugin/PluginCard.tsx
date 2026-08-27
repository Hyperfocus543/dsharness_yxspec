// =============================================================================
// PluginCard — 统一插件卡（Everything-is-a-Plugin 开关）
// =============================================================================
// 所有能力（已装配插件 / 候选能力 / 基座）统一成一张"插件卡 + 开关"，
// 视觉一套，遵循 DSH 逻辑——都是插件、都能开关（基座只读锁定）。
// 开关语义：
//   · 已装配插件 / 候选能力：真开关（switchable），开/关后重建 runtime（开关即重建）
//   · 基座：只读（switchable=false），不渲染开关，标「基座」徽章
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

import React from 'react';
import { Icon } from '../ui';
import { I } from '../ui/icons';
import type { UnifiedPlugin } from '../../utils/ipc';

const PluginCard: React.FC<{
  p: UnifiedPlugin;
  busy?: boolean;
  onToggle?: (id: string, enabled: boolean) => void;
}> = ({ p, busy, onToggle }) => {
  const locked = !p.switchable; // 基座 / agent-spine 锁
  const off = !p.enabled && !locked;

  const badge = (() => {
    // tier 是权威分类：base / plugin / candidate（kind 仅 plugin|candidate，基座也是 plugin）
    if (p.tier === 'base') {
      return (
        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-semibold leading-5 shrink-0" title="DSH harness 基座必需，不可关">
          基座
        </span>
      );
    }
    if (p.tier === 'candidate') {
      return (
        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-semibold leading-5 shrink-0" title="POC 已验证，未进主装配">
          候选
        </span>
      );
    }
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold leading-5 shrink-0" title="已接入 cordis.yml">
        接入
      </span>
    );
  })();

  return (
    <div
      className={`rounded-md border px-2.5 py-2 transition-colors ${
        locked
          ? 'border-zinc-200 bg-zinc-50 opacity-70'
          : off
            ? 'border-zinc-200 bg-white hover:border-emerald-300'
            : 'border-emerald-300 bg-emerald-50/40'
      }`}
      title={p.desc}
    >
      <div className="flex items-start gap-2">
        {/* 开关 */}
        <div className="pt-1 shrink-0">
          {locked ? (
            <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-400 font-semibold leading-5">
              固定
            </span>
          ) : (
            <button
              onClick={() => !busy && onToggle?.(p.id, !p.enabled)}
              disabled={busy}
              aria-label={p.name}
              title={p.enabled ? '点击关闭（重建 runtime）' : '点击开启（重建 runtime）'}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
                p.enabled
                  ? 'bg-emerald-500 disabled:bg-zinc-300'
                  : 'bg-zinc-300 disabled:bg-zinc-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  p.enabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          )}
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-zinc-800">{p.name}</span>
            {badge}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 truncate" title={p.desc}>
            {p.desc}
          </p>
        </div>

        <Icon name={I.plugs} size={14} className="mt-1 shrink-0 text-zinc-300" />
      </div>
    </div>
  );
};

export default PluginCard;
