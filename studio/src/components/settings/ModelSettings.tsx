// =============================================================================
// ModelSettings — 模型管理设置面板（设置功能卡）
// 默认模型切换（懒生效）+ 模型列表增删 + 立即应用（重建 harness）。
// 数据真相源：网关 model-config.json（经 /api/models*）。
// =============================================================================

import React from 'react';
import { useModelStore } from '../../store/modelStore';
import { useToastStore } from '../../store/toastStore';
import type { ModelEntry } from '../../utils/ipc';

const MODALITIES_LABEL: Record<string, string> = {
  text: '文本',
  image: '视觉',
};

export const ModelSettings: React.FC = () => {
  const models = useModelStore((s) => s.models);
  const defaultModelId = useModelStore((s) => s.defaultModelId);
  const current = useModelStore((s) => s.current);
  const loading = useModelStore((s) => s.loading);
  const error = useModelStore((s) => s.error);
  const load = useModelStore((s) => s.load);
  const setDefault = useModelStore((s) => s.setDefault);
  const add = useModelStore((s) => s.add);
  const remove = useModelStore((s) => s.remove);
  const apply = useModelStore((s) => s.apply);
  const pushToast = useToastStore((s) => s.push);

  const [busy, setBusy] = React.useState(false);
  // 新增模型表单
  const [showAdd, setShowAdd] = React.useState(false);
  const [form, setForm] = React.useState({
    provider: 'deepseek',
    model: '',
    label: '',
    modalities: 'text,image',
    contextWindow: '1000000',
    maxTokens: '128000',
  });

  React.useEffect(() => {
    load();
  }, [load]);

  const handleSetDefault = async (id: string) => {
    setBusy(true);
    try {
      await setDefault(id);
      pushToast('info', `默认模型已切换：${id}（下次派活生效）`);
    } catch (e: any) {
      pushToast('error', `切换失败: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    setBusy(true);
    try {
      await apply();
      pushToast('success', '已重建 harness runtime，下次派活按新默认模型');
    } catch (e: any) {
      pushToast('error', `应用失败: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!form.provider.trim() || !form.model.trim()) {
      pushToast('warn', 'provider / 模型名必填');
      return;
    }
    const entry: ModelEntry = {
      provider: form.provider.trim(),
      model: form.model.trim(),
      label: form.label.trim() || undefined,
      modalities: form.modalities
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      contextWindow: form.contextWindow ? Number(form.contextWindow) : null,
      maxTokens: form.maxTokens ? Number(form.maxTokens) : undefined,
    };
    setBusy(true);
    try {
      await add(entry);
      pushToast('success', `已添加模型：${entry.provider}/${entry.model}`);
      setShowAdd(false);
      setForm({ ...form, model: '', label: '' });
    } catch (e: any) {
      pushToast('error', `添加失败: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      await remove(id);
      pushToast('success', `已删除模型：${id}`);
    } catch (e: any) {
      pushToast('error', `删除失败: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg">⚙️ 模型管理</h3>
        <div className="flex gap-2">
          <button
            className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded"
            onClick={() => load()}
            disabled={loading}
          >
            🔄 刷新
          </button>
          <button
            className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
            onClick={handleApply}
            disabled={busy || loading}
            title="立即重建 harness runtime（当前对话上下文重置）"
          >
            ⚡ 立即应用
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      {loading && <div className="text-xs text-gray-400">加载中…</div>}

      {/* 当前 harness spec */}
      <div className="text-xs bg-gray-50 border rounded p-2">
        <span className="text-gray-500">当前 runtime：</span>
        {current ? (
          <code className="font-mono text-gray-700">
            {current.provider}/{current.model}（maxTokens {current.maxTokens}）
          </code>
        ) : (
          <span className="text-gray-400">未构建（下次派活按默认模型启动）</span>
        )}
      </div>

      {/* 默认模型 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="text-sm font-semibold text-gray-700 mb-2">默认模型</div>
        <select
          className="w-full text-sm border rounded px-2 py-1.5 font-mono"
          value={defaultModelId ?? ''}
          onChange={(e) => handleSetDefault(e.target.value)}
          disabled={busy}
        >
          {models.length === 0 && <option value="">（无模型）</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label || m.id}
            </option>
          ))}
        </select>
        <div className="text-[11px] text-gray-500 mt-1">
          切换后下次派活按新默认模型重建 harness（懒生效）。当前会话上下文会重置。
        </div>
      </div>

      {/* 模型列表 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-700">模型列表</span>
          <button
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => setShowAdd(!showAdd)}
          >
            {showAdd ? '收起' : '+ 新增模型'}
          </button>
        </div>

        {showAdd && (
          <div className="bg-white border rounded-lg p-3 space-y-2 mb-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                <span className="text-gray-500">provider *</span>
                <input
                  className="w-full mt-0.5 text-xs border rounded px-2 py-1 font-mono"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  placeholder="deepseek"
                />
              </label>
              <label className="text-xs">
                <span className="text-gray-500">模型名 *</span>
                <input
                  className="w-full mt-0.5 text-xs border rounded px-2 py-1 font-mono"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="deepseek-v4-flash-vision-exp"
                />
              </label>
              <label className="text-xs">
                <span className="text-gray-500">显示名</span>
                <input
                  className="w-full mt-0.5 text-xs border rounded px-2 py-1 font-mono"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="DeepSeek V4 Vision"
                />
              </label>
              <label className="text-xs">
                <span className="text-gray-500">模态（逗号分隔）</span>
                <input
                  className="w-full mt-0.5 text-xs border rounded px-2 py-1 font-mono"
                  value={form.modalities}
                  onChange={(e) => setForm({ ...form, modalities: e.target.value })}
                  placeholder="text,image"
                />
              </label>
              <label className="text-xs">
                <span className="text-gray-500">contextWindow</span>
                <input
                  className="w-full mt-0.5 text-xs border rounded px-2 py-1 font-mono"
                  value={form.contextWindow}
                  onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
                />
              </label>
              <label className="text-xs">
                <span className="text-gray-500">maxTokens</span>
                <input
                  className="w-full mt-0.5 text-xs border rounded px-2 py-1 font-mono"
                  value={form.maxTokens}
                  onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                onClick={handleAdd}
                disabled={busy}
              >
                添加
              </button>
              <button
                className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200"
                onClick={() => setShowAdd(false)}
              >
                取消
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          {models.map((m) => (
            <div
              key={m.id}
              className={`flex items-center gap-2 text-xs bg-white border rounded px-3 py-2 ${
                m.id === defaultModelId ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
              }`}
            >
              <span className="font-mono text-gray-700 flex-1 min-w-0 truncate" title={m.id}>
                {m.id}
              </span>
              {m.modalities?.map((mod) => (
                <span
                  key={mod}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600"
                >
                  {MODALITIES_LABEL[mod] ?? mod}
                </span>
              ))}
              {m.id === defaultModelId && (
                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                  默认
                </span>
              )}
              <button
                className="text-[10px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50"
                onClick={() => handleSetDefault(m.id!)}
                disabled={busy || m.id === defaultModelId}
                title="设为默认（懒生效）"
              >
                设为默认
              </button>
              <button
                className="text-[10px] px-2 py-0.5 bg-red-50 text-red-600 hover:bg-red-100 rounded disabled:opacity-50"
                onClick={() => handleRemove(m.id!)}
                disabled={busy || m.id === defaultModelId}
                title="删除（不能删默认）"
              >
                删除
              </button>
            </div>
          ))}
          {models.length === 0 && <div className="text-xs text-gray-400 text-center py-4">暂无模型</div>}
        </div>
      </div>

      <div className="text-[11px] text-gray-400 border-t pt-2">
        ⚠️ 模型目录配置在网关 <code>model-config.json</code>；provider 路由需在 harness 的
        <code> settings.yaml</code> 中声明（否则运行时 UNKNOWN_MODEL 显式失败）。
        视觉模型（image）当前仅声明模态，对话区图片附件能力后续支持。
      </div>
    </div>
  );
};
