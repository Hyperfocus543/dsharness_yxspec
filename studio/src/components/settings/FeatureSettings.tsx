import React from 'react';
import { useFeatureStore } from '../../store/featureStore';
import { useToastStore } from '../../store/toastStore';
import { STAGE_TABLE } from '../../data/stage-mapping';
import { Icon, Panel } from '../ui';
import { I } from '../ui/icons';
import PluginCard from '../plugin/PluginCard';
import type { StageToken } from '../../data/types';
import type { FeatureItem, UnifiedPlugin } from '../../utils/ipc';
import * as ipc from '../../utils/ipc';

// =============================================================================
// FeatureSettings — 插件中心「功能开关」面板
// 一切能力统一成插件卡（Everything-is-a-Plugin）：
//   · DSH 能力区：已装配插件 + 候选能力 + 基座，统一 PluginCard + 开关（开关即重建）
//   · 功能商店区：yxspec 阶段规则注入开关（features.yaml，热生效）
// 数据真相源：网关 plugins.mjs 注册表 + features.mjs 注册表。
// UI 基线：design-taste skill — zinc 底 + emerald 单强调色，禁 emoji，Phosphor 图标。
// =============================================================================

/** 成本等级徽章颜色（统一中性，避免彩色噪音；保留 emerald 唯一强调色） */
const COST_STYLE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-zinc-100 text-zinc-500',
  high: 'bg-zinc-100 text-zinc-500',
};

const COST_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高' };

/** 功能商店卡片分组：按规则族归类，避免长扁平列表。自定义功能单独一组。 */
const FEATURE_GROUPS: { label: string; ids: string[] }[] = [
  { label: '需求规则', ids: ['prd-gq6', 'prd-iq', 'prd-mq', 'prd-rq', 'prd-eq', 'sys-granularity', 'sys-aq', 'sys-fix'] },
  { label: '质量与审查', ids: ['swe-arch-terms', 'review-checklist', 'coding-rules'] },
  { label: '流程机制', ids: ['knowledge-first', 'tool-restrict', 'audit-ledger', 'ui-report'] },
];

/** 把 appliesTo（['all'] / ['review'] / token[]）转成可读的阶段清单 */
function describeApplies(f: FeatureItem): string {
  const list = f.appliesTo || [];
  if (list.includes('all')) return '全部阶段';
  if (list.includes('review')) return '各审查阶段';
  const labels = (f.appliesTo || [])
    .map((t) => {
      const m = (STAGE_TABLE as Record<string, any>)?.[t];
      return m?.label || m?.command || t;
    })
    .filter(Boolean);
  return labels.length > 0 ? labels.join(' · ') : (f.appliesTo || []).join(', ');
}

/** 单个功能开关卡片（紧凑行卡）。 */
const FeatureRow: React.FC<{
  f: FeatureItem;
  disabled: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove?: (id: string) => void;
}> = ({ f, disabled, onToggle, onRemove }) => {
  const locked = !f.available; // 灰置
  const alwaysOn = f.always; // 审计账本：始终启用
  const off = !f.enabled && !locked && !alwaysOn;
  return (
    <div
      className={`rounded-md border px-2.5 py-2 transition-colors ${
        locked
          ? 'border-zinc-200 bg-zinc-50 opacity-70'
          : off
            ? 'border-zinc-200 bg-white hover:border-emerald-300'
            : 'border-emerald-300 bg-emerald-50/40'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* 开关 */}
        <div className="pt-1 shrink-0">
          {alwaysOn ? (
            <span
              className="inline-block text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold leading-5"
              title="始终启用（审计账本）"
            >
              常开
            </span>
          ) : (
            <button
              onClick={() => !disabled && !locked && onToggle(f.id, !f.enabled)}
              disabled={disabled || locked}
              aria-label={f.name}
              title={
                locked
                  ? `依赖 ${f.depends.join('、')}，等待 harness 链路确认`
                  : f.enabled
                    ? '点击关闭'
                    : '点击开启'
              }
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
                f.enabled
                  ? 'bg-emerald-500 disabled:bg-zinc-300'
                  : 'bg-zinc-300 disabled:bg-zinc-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  f.enabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          )}
        </div>
        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-zinc-800">{f.name}</span>
            {f.custom && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold leading-5"
                title="用户自定义功能（custom-features.yaml）"
              >
                自定义
              </span>
            )}
            {locked && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-500 font-semibold leading-5"
                title={`依赖 ${f.depends.join('、')}`}
              >
                待确认
              </span>
            )}
            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold leading-5 ${COST_STYLE[f.cost] || COST_STYLE.low}`}>
              成本 {COST_LABEL[f.cost] || f.cost}
            </span>
            {/* skill 载体徽章：A+A 里该功能有 .dsh/skills/<id>/SKILL.md 才有 */}
            {f.skill && (
              f.always ? (
                <span
                  className="text-xs px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-500 font-semibold leading-5"
                  title="网关机制 skill，模型不可调（disable-model-invocation: true）"
                >
                  机制
                </span>
              ) : f.enabled ? (
                <span
                  className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold leading-5"
                  title="模型可 skill() 调起（disable-model-invocation: false）"
                >
                  可调
                </span>
              ) : (
                <span
                  className="text-xs px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-500 font-semibold leading-5"
                  title="该 skill 已生成，但功能开关关闭，模型暂不可调；开启后可调"
                >
                  关闭
                </span>
              )
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 truncate" title={f.desc}>{f.desc}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-zinc-400">适用：{describeApplies(f)}</span>
            {locked && f.depends.length > 0 && (
              <span className="text-xs text-zinc-400">依赖：{f.depends.join('、')}</span>
            )}
          </div>
        </div>
        {/* 自定义功能：删除按钮 */}
        {f.custom && onRemove && (
          <button
            onClick={() => !disabled && onRemove(f.id)}
            disabled={disabled}
            aria-label={`删除自定义功能 ${f.name}`}
            title="删除自定义功能"
            className="text-xs px-1.5 py-0.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 shrink-0"
          >
            <Icon name={I.trash} size={13} />
            删除
          </button>
        )}
      </div>
    </div>
  );
};

const EMPTY_FORM = {
  id: '',
  name: '',
  desc: '',
  appliesTo: '',
  cost: 'low',
  ruleFile: '',
  defaultEnabled: true,
};

export const FeatureSettings: React.FC = () => {
  const features = useFeatureStore((s) => s.features);
  const loading = useFeatureStore((s) => s.loading);
  const error = useFeatureStore((s) => s.error);
  const load = useFeatureStore((s) => s.load);
  const toggle = useFeatureStore((s) => s.toggle);
  const add = useFeatureStore((s) => s.add);
  const remove = useFeatureStore((s) => s.remove);
  const pushToast = useToastStore((s) => s.push);

  const [busy, setBusy] = React.useState(false);
  const [showAdd, setShowAdd] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_FORM);
  // 统一插件清单（已装配 + 候选 + 基座）
  const [plugins, setPlugins] = React.useState<UnifiedPlugin[]>([]);
  const [pluginsLoading, setPluginsLoading] = React.useState(false);

  React.useEffect(() => {
    load();
  }, [load]);

  // 拉统一插件清单（Everything-is-a-Plugin：所有能力统一成插件条目）
  React.useEffect(() => {
    let cancelled = false;
    setPluginsLoading(true);
    ipc
      .fetchPlugins()
      .then((data) => {
        if (!cancelled) setPlugins(data?.plugins ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPluginsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadPlugins = () => {
    setPluginsLoading(true);
    ipc
      .fetchPlugins()
      .then((data) => setPlugins(data?.plugins ?? []))
      .catch(() => {})
      .finally(() => setPluginsLoading(false));
  };

  // 插件开关（开关即重建，后端已做 busy 检查 + closeHarness 重建）
  const handlePluginToggle = async (id: string, enabled: boolean) => {
    setBusy(true);
    try {
      const r = await ipc.setPluginEnabled(id, enabled);
      pushToast('success', r?.message || `插件 ${id} 已${enabled ? '启用' : '关闭'}（runtime 重建中）`);
      reloadPlugins();
    } catch (e: any) {
      pushToast('error', `插件开关失败：${e?.message || e}`);
      reloadPlugins();
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setBusy(true);
    try {
      await toggle(id, enabled);
      pushToast('success', `功能${enabled ? '已开启' : '已关闭'}：${id}（下个阶段生效）`);
    } catch (e: any) {
      pushToast('error', `开关失败：${e?.message || e}`);
      load();
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    const id = form.id.trim();
    const name = form.name.trim();
    if (!id) {
      pushToast('warn', 'id 必填（小写字母/数字/连字符）');
      return;
    }
    if (!name) {
      pushToast('warn', '名称必填');
      return;
    }
    // 适用阶段：逗号分隔 → 数组；后端再校验 token 合法性
    const appliesTo = form.appliesTo
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (appliesTo.length === 0) {
      pushToast('warn', '适用阶段至少填一个（all / review / 阶段 token）');
      return;
    }
    setBusy(true);
    try {
      await add({
        id,
        name,
        desc: form.desc.trim() || undefined,
        appliesTo,
        cost: form.cost,
        defaultEnabled: form.defaultEnabled,
        ruleFile: form.ruleFile.trim() || undefined,
      });
      pushToast('success', `已新增自定义功能：${id}（配置驱动，无需重启网关）`);
      setShowAdd(false);
      setForm(EMPTY_FORM);
    } catch (e: any) {
      pushToast('error', `新增失败：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      await remove(id);
      pushToast('success', `已删除自定义功能：${id}`);
    } catch (e: any) {
      pushToast('error', `删除失败：${e?.message || e}`);
      load();
    } finally {
      setBusy(false);
    }
  };

  const available = features.filter((f) => f.available);
  const locked = features.filter((f) => !f.available);
  const enabledCount = available.filter((f) => f.enabled).length;

  // 按组渲染：组内 id 命中可用 feature 才算；自定义功能单独一组
  const availById = Object.fromEntries(available.map((f) => [f.id, f]));
  const groupedIds = new Set(FEATURE_GROUPS.flatMap((g) => g.ids));
  const groupsWithItems = FEATURE_GROUPS.map((g) => ({
    label: g.label,
    items: g.ids.map((id) => availById[id]).filter(Boolean),
  })).filter((g) => g.items.length > 0);
  const ungroupedCustom = available.filter((f) => f.custom && !groupedIds.has(f.id));

  return (
    <div className="p-3 space-y-3">
      {/* DSH 能力：已接入插件 + 候选能力 + 基座（Everything-is-a-Plugin 统一插件卡） */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-700">
            <Icon name={I.stack} size={13} />
            DSH 能力
          </span>
          <span className="text-xs text-zinc-400">
            {pluginsLoading
              ? '加载中…'
              : `${plugins.filter((p) => p.tier === 'plugin').length} 接入 · ${plugins.filter((p) => p.tier === 'candidate').length} 候选 · ${plugins.filter((p) => p.tier === 'base').length} 基座`}
          </span>
        </div>

        {/* 已接入（plugin）直展 */}
        {plugins.filter((p) => p.tier === 'plugin').length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-1.5">
            {plugins
              .filter((p) => p.tier === 'plugin')
              .map((p) => (
                <PluginCard key={p.id} p={p} busy={busy} onToggle={handlePluginToggle} />
              ))}
          </div>
        )}

        {/* 已验证候选（POC 通过未进主装配，可开关） */}
        {plugins.filter((p) => p.tier === 'candidate').length > 0 && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {plugins
                .filter((p) => p.tier === 'candidate')
                .map((p) => (
                  <PluginCard key={p.id} p={p} busy={busy} onToggle={handlePluginToggle} />
                ))}
            </div>
            <p className="text-xs text-zinc-400">
              候选能力 POC 已验证、默认关闭；打开即把装配片段插入合成装配并重建 runtime。带「守卫」标记的能力还需在{' '}
              <code className="bg-zinc-100 px-1 rounded">@yxspec/tool-guard</code> 白名单放行。
            </p>
          </div>
        )}

        {/* 基座（折叠） */}
        {plugins.filter((p) => p.tier === 'base').length > 0 && (
          <details className="group mt-1.5">
            <summary className="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer select-none py-0.5 inline-flex items-center gap-1">
              <Icon name={I.caretDown} size={11} className="group-open:rotate-180 transition-transform" />
              DSH 基座 {plugins.filter((p) => p.tier === 'base').length} 个（runtime 必需）
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1.5">
              {plugins
                .filter((p) => p.tier === 'base')
                .map((p) => (
                  <PluginCard key={p.id} p={p} busy={busy} onToggle={handlePluginToggle} />
                ))}
            </div>
          </details>
        )}

        {/* 空态 */}
        {!pluginsLoading && plugins.length === 0 && (
          <div className="text-xs text-zinc-400 rounded-md border border-dashed border-zinc-200 px-2.5 py-2">
            尚未接入任何插件。去「社区插件」找 dsh 插件，或手动挂到{' '}
            <code className="bg-zinc-100 px-0.5 rounded">runtime-js/config/cordis.yml</code>。
          </div>
        )}
      </div>

      {/* 标题 + 操作 */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h3 className="text-sm font-bold text-zinc-700">功能商店</h3>
          <p className="text-xs text-zinc-500">
            yxspec 适配功能开关 · 驱动网关阶段执行时按需注入
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-zinc-600">
              已启用 <span className="font-mono font-bold text-emerald-600">{enabledCount}</span> /{' '}
              {available.length}
            </div>
            <button
              className="text-xs text-emerald-600 hover:underline mt-0.5 inline-flex items-center gap-1"
              onClick={() => load()}
              disabled={loading}
            >
              <Icon name={I.refresh} size={12} />
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
          <button
            className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            onClick={() => setShowAdd(!showAdd)}
            disabled={busy}
          >
            <Icon name={I.plus} size={14} />
            {showAdd ? '收起' : '新增功能'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          <span className="inline-flex items-center gap-1">
            <Icon name={I.warn} size={13} weight="fill" />
            网关不可达或功能商店未加载：{error}
          </span>
          <div className="text-zinc-500 mt-1">
            确认网关（server.mjs）运行中，且已升级到含 /api/features 的版本。
          </div>
        </div>
      )}

      {loading && !error && (
        <div className="text-xs text-zinc-500 py-4 text-center">加载功能商店…</div>
      )}

      {!loading && !error && (
        <>
          {showAdd && (
            <Panel className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-800">新增自定义功能</span>
                <span className="text-xs text-zinc-400">
                  写入 project/config/custom-features.yaml · 无需重启网关
                </span>
              </div>
              <div className="p-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs">
                    <span className="text-zinc-500">id *（小写字母/数字/连字符）</span>
                    <input
                      className="w-full mt-0.5 text-xs border border-zinc-300 rounded-md px-2 py-1 font-mono bg-white"
                      value={form.id}
                      onChange={(e) => setForm({ ...form, id: e.target.value })}
                      placeholder="my-rule"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="text-zinc-500">名称 *</span>
                    <input
                      className="w-full mt-0.5 text-xs border border-zinc-300 rounded-md px-2 py-1 font-mono bg-white"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="我的自定义规则"
                    />
                  </label>
                  <label className="text-xs col-span-2">
                    <span className="text-zinc-500">描述</span>
                    <input
                      className="w-full mt-0.5 text-xs border border-zinc-300 rounded-md px-2 py-1 font-mono bg-white"
                      value={form.desc}
                      onChange={(e) => setForm({ ...form, desc: e.target.value })}
                      placeholder="一句话说明"
                    />
                  </label>
                  <label className="text-xs col-span-2">
                    <span className="text-zinc-500">
                      适用阶段（逗号分隔；'all' 全部 / 'review' 各审查阶段）
                    </span>
                    <input
                      className="w-full mt-0.5 text-xs border border-zinc-300 rounded-md px-2 py-1 font-mono bg-white"
                      value={form.appliesTo}
                      onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}
                      placeholder="sys_analysis"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="text-zinc-500">成本</span>
                    <select
                      className="w-full mt-0.5 text-xs border border-zinc-300 rounded-md px-2 py-1 font-mono bg-white"
                      value={form.cost}
                      onChange={(e) => setForm({ ...form, cost: e.target.value })}
                    >
                      <option value="low">low（低）</option>
                      <option value="medium">medium（中）</option>
                      <option value="high">high（高）</option>
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="text-zinc-500">规则文件（可选，相对模板根）</span>
                    <input
                      className="w-full mt-0.5 text-xs border border-zinc-300 rounded-md px-2 py-1 font-mono bg-white"
                      value={form.ruleFile}
                      onChange={(e) => setForm({ ...form, ruleFile: e.target.value })}
                      placeholder="rules/my/my-rule.yaml"
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-600 select-none">
                  <input
                    type="checkbox"
                    className="accent-emerald-600"
                    checked={form.defaultEnabled}
                    onChange={(e) => setForm({ ...form, defaultEnabled: e.target.checked })}
                  />
                  默认启用
                </label>
                <div className="flex gap-2">
                  <button
                    className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleAdd}
                    disabled={busy}
                  >
                    添加
                  </button>
                  <button
                    className="text-xs px-3 py-1 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 active:scale-[0.98]"
                    onClick={() => setShowAdd(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            </Panel>
          )}

          {/* 功能开关：按规则族分组 */}
          {groupsWithItems.map((g) => (
            <div key={g.label} className="pt-1">
              <div className="text-xs font-semibold text-zinc-500 mb-1.5">{g.label}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {g.items.map((f) => (
                  <FeatureRow
                    key={f.id}
                    f={f}
                    disabled={busy}
                    onToggle={handleToggle}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* 自定义功能（未归组的单独一组） */}
          {ungroupedCustom.length > 0 && (
            <div className="pt-1">
              <div className="text-xs font-semibold text-zinc-500 mb-1.5">自定义功能</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {ungroupedCustom.map((f) => (
                  <FeatureRow
                    key={f.id}
                    f={f}
                    disabled={busy}
                    onToggle={handleToggle}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 待确认（灰置，收进折叠） */}
          {locked.length > 0 && (
            <div className="pt-1">
              <details className="group">
                <summary className="text-xs font-semibold text-zinc-500 mb-1.5 cursor-pointer select-none inline-flex items-center gap-1 hover:text-zinc-700">
                  <Icon name={I.caretDown} size={11} className="group-open:rotate-180 transition-transform" />
                  待确认 {locked.length} 项（依赖 harness 链路能力，等 yxspec 专家确认后点亮）
                </summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {locked.map((f) => (
                    <FeatureRow key={f.id} f={f} disabled={busy} onToggle={handleToggle} />
                  ))}
                </div>
              </details>
            </div>
          )}

          <div className="text-xs text-zinc-400 pt-1">
            开关状态存{' '}
            <code className="bg-zinc-100 px-1 rounded">project/config/features.yaml</code>，
            下个阶段派活时网关按开关装配注入规则；自定义功能定义存{' '}
            <code className="bg-zinc-100 px-1 rounded">project/config/custom-features.yaml</code>。
            各功能的 skill 载体（.dsh/skills/&lt;id&gt;/SKILL.md）随功能卡标注「可调/关闭/机制」。
          </div>
        </>
      )}
    </div>
  );
};
