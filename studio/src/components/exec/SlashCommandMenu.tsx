// =============================================================================
// SlashCommandMenu — 输入 `/` 自动弹出的补全下拉
// 对标 Claude Code 的 slash 命令：
//   · 阶段命令（可执行）：/yxspec:xxx → 回车触发跑阶段
//   · 功能商店（规则开关）：PRD六维打分 / SYS追问 / 审查检查单…
//     回车 = 切换开关，实时反映 enabled 状态（☑/☐）
// 输入 `/` 弹全部，继续输入过滤（命令名 / 功能名 / ASPICE），Esc 关闭。
// 阶段命令排除废弃节点（swe_detail）与 PC 变体（swe_coding_verify_pc）。
// 末尾追加一条「自迭代」网关插件级命令（非阶段）：选中后由 LLMConsole
// 注入当前阶段 token 组成 /yxspec:self-iterate <stage> 再派活（裸命令不建 run）。
// =============================================================================

import React from 'react';
import { STAGE_ORDER, STAGE_TABLE } from '../../data/stage-mapping';
import type { FeatureItem } from '../../utils/ipc';

export type SlashItem =
  | {
      kind: 'command';
      token: string;
      command: string;
      command_name: string;
      aspice: string;
      group: string;
    }
  | {
      kind: 'feature';
      id: string;
      name: string;
      desc: string;
      enabled: boolean;
      always: boolean;
      locked: boolean;
    };

// 活跃阶段命令（排除废弃/变体）
const EXCLUDED = new Set(['swe_detail', 'swe_coding_verify_pc']);

export const SLASH_COMMANDS: Extract<SlashItem, { kind: 'command' }>[] = [
  ...STAGE_ORDER.filter((t) => !EXCLUDED.has(t)).map(
    (t): Extract<SlashItem, { kind: 'command' }> => {
      const m = STAGE_TABLE[t];
      return {
        kind: 'command',
        token: t,
        command: m.command,
        command_name: m.command_name,
        aspice: m.aspice,
        group: m.group,
      };
    },
  ),
  // 自迭代（非阶段命令，网关插件级）：选中后由 LLMConsole 注入当前阶段派活
  {
    kind: 'command' as const,
    token: 'self-iterate',
    command: '/yxspec:self-iterate ',
    command_name: '自迭代',
    aspice: 'ACQ.4',
    group: '自迭代',
  },
];

/** 功能商店条目转 Slash 项（含开关状态快照）。纯 UI 插件（uiOnly）不进命令菜单。 */
export function featuresToSlashItems(features: FeatureItem[]): Extract<SlashItem, { kind: 'feature' }>[] {
  return features
    .filter((f) => !f.uiOnly) // ui-report 等纯 UI 插件排除（不进 / 菜单）
    .map((f) => ({
      kind: 'feature',
      id: f.id,
      name: f.name,
      desc: f.desc,
      enabled: f.enabled,
      always: f.always,
      locked: !f.available,
    }));
}

/**
 * 过滤：`/` 或 `/yxspec:` 全量；否则匹配命令名 / 功能名 / 命令前缀。
 * features 实时传入，保证开关状态最新。
 */
export function filterSlashItems(
  input: string,
  features: FeatureItem[],
): SlashItem[] {
  const q = input.trim().toLowerCase();
  const all: SlashItem[] = [...SLASH_COMMANDS, ...featuresToSlashItems(features)];
  if (!q || q === '/yxspec:' || q === '/') return all;
  const afterColon = q.replace(/^\/yxspec:/, '');
  return all.filter((it) => {
    if (it.kind === 'command') {
      return (
        it.command.toLowerCase().startsWith(q) ||
        it.command.toLowerCase().includes(q) ||
        it.command_name.toLowerCase().startsWith(afterColon) ||
        it.command_name.toLowerCase().includes(q)
      );
    }
    // feature：匹配 name/desc/id
    return (
      it.name.toLowerCase().includes(q) ||
      it.id.toLowerCase().includes(q) ||
      (it.desc || '').toLowerCase().includes(q)
    );
  });
}

/** 是否为"裸触发"（只有 `/` 或 `/yxspec:`，无实质过滤词）——此时回车不自动发送 */
export function isBareTrigger(input: string): boolean {
  const t = input.trim();
  return t === '/' || t === '/yxspec:' || t === '/yxspec';
}

interface Props {
  items: SlashItem[];
  highlight: number;
  onSelect: (item: SlashItem) => void;
  onHover: (index: number) => void;
}

/** 分组渲染：阶段命令 + 功能商店，各带标签，功能项显示开关状态 */
export const SlashCommandMenu: React.FC<Props> = ({ items, highlight, onSelect, onHover }) => {
  if (items.length === 0) return null;
  const commands = items.filter((i) => i.kind === 'command');
  const features = items.filter((i) => i.kind === 'feature');
  // 全局索引 <-> 局部索引映射（分组内高亮用）
  const rowIndexOf = (i: SlashItem): number => items.indexOf(i);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-72 overflow-y-auto bg-white border border-zinc-200 rounded-md shadow-lg z-50">
      <div className="px-3 py-1 text-[10px] text-zinc-400 border-b border-zinc-100 flex items-center gap-2">
        <span>选择命令触发阶段 / 切换功能开关</span>
        <span className="ml-auto inline-flex gap-1.5 text-zinc-300">
          <kbd className="px-1 bg-zinc-100 rounded">Enter</kbd>触发
          <kbd className="px-1 bg-zinc-100 rounded">Tab</kbd>填充
          <kbd className="px-1 bg-zinc-100 rounded">Esc</kbd>关闭
        </span>
      </div>

      {commands.length > 0 && (
        <>
          <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold text-zinc-400">阶段命令</div>
          {commands.map((c) => {
            const gi = rowIndexOf(c);
            return (
              <button
                key={c.command}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                  gi === highlight ? 'bg-emerald-50 text-emerald-800' : 'text-zinc-700 hover:bg-zinc-50'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(c);
                }}
                onMouseEnter={() => onHover(gi)}
              >
                <span className="font-mono font-semibold truncate">{c.command}</span>
                <span className="text-zinc-400 shrink-0">{c.aspice}</span>
                <span className="ml-auto text-[10px] text-zinc-400 shrink-0">{c.group}</span>
              </button>
            );
          })}
        </>
      )}

      {features.length > 0 && (
        <>
          <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold text-zinc-400 border-t border-zinc-100">
            功能商店
          </div>
          {features.map((f) => {
            const gi = rowIndexOf(f);
            const dimmed = f.locked;
            return (
              <button
                key={f.id}
                type="button"
                title={dimmed ? `${f.desc}（未可用，依赖 harness 链路确认）` : f.desc}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                  gi === highlight ? 'bg-emerald-50 text-emerald-800' : 'text-zinc-700 hover:bg-zinc-50'
                } ${dimmed ? 'opacity-60' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(f);
                }}
                onMouseEnter={() => onHover(gi)}
              >
                {/* 开关状态圆点：☑ 绿 / ☐ 灰 / 锁定琥珀 */}
                <span
                  className={`shrink-0 w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                    f.always
                      ? 'bg-emerald-500 border-emerald-500'
                      : f.enabled
                        ? 'bg-sage-500 border-sage-600'
                        : dimmed
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-zinc-300 bg-white'
                  }`}
                >
                  {(f.always || f.enabled) && (
                    <span className="text-white text-[8px] leading-none">✓</span>
                  )}
                </span>
                <span className="truncate">{f.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
                  {f.always ? '始终' : f.enabled ? '开' : dimmed ? '锁定' : '关'}
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
};
