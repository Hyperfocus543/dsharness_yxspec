# YXSpec Studio — Claude 暖白视觉落地方案

> 依据 colorspace skill 的 `claude`（Anthropic）品牌设计系统。目标：把当前 zinc(冷灰)/emerald(绿) 的纯单色界面，换成 Claude 式**暖羊皮纸 + 赤陶橙**人文质感，同时解决"字太小"。

## 1. 设计基准（Claude 品牌核心）

| 维度 | 值 | 说明 |
|------|-----|------|
| 底色 | Parchment `#f5f4ed` | 暖羊皮纸，**全页背景**，非纯白 |
| 卡面 | Ivory `#faf9f5` / White `#fff` | 卡片/面板，比底色略浅形成层次 |
| 主强调 | Terracotta `#c96442`（赤陶橙） | 主 CTA / 当前阶段 / 选中态 |
| 副强调 | Coral `#d97757` | 链接、浅色面上的次要强调 |
| 文字主 | Near Black `#141413` | 暖近黑（带橄榄暖调） |
| 文字次 | Olive Gray `#5e5d59` | 暖橄榄灰，次级正文 |
| 文字弱 | Stone Gray `#87867f` | 三级/脚注 |
| 错误 | Crimson `#b53333` | 暖红，不刺眼 |
| 焦点 | Focus Blue `#3898ec` | 输入 focus ring（全系统唯一冷色） |
| 边框 | Border Cream `#f0eee6` / Warm `#e8e6dc` | 极浅暖边框 |
| 阴影 | ring-shadow `0 0 0 1px` 暖灰 + whisper `rgba(0,0,0,.05) 4px 24px` | 不用冷灰 drop-shadow |
| 圆角 | 8px 常规 / 12px 主按钮 / 16-24px 容器 | 整体更圆更柔 |

**铁律**：全系统**零冷灰、零纯黑、零饱和杂色**——所有灰色带黄棕调；赤陶橙只用于最高信号点；Serif 标题字重恒为 500。

## 2. 字号放大方案（解决"字太小"）

现状：`text-xs(12px)` ×118、`text-sm(14px)` ×37、`text-[10px]` ×17、`text-[11px]` ×14、`text-base(16px)` ×1。

> 已做过的 `tailwind.config` fontSize 覆盖（xs→14px、body 16px）**对 `text-[10px]/[11px]` 任意值类无效**，28 处仍是 10-11px，是当前"太小"的主因。

**处理：**
1. `tailwind.config.js` fontSize 全部整体上移一档：
   - `xs`：`0.875rem`（14px）→ **`0.9375rem`（15px）**（labl 级）
   - `sm`：`0.875rem` → **`0.9375rem`**（与 xs 同，或设 `1rem` 16px 按组件区分）
   - `base`：`1rem` → **`1.0625rem`（17px）**（Claude Body Standard 17px）
   - 新增 `lg`：`1.125rem`（18px）用于块标题
2. **清理 28 处 `text-[10px]/[11px]`**：批量替换为 `text-xs`（15px）或 `text-[12px]`（保留最小标签为 12px，不再低于 12px）。
3. `body` 字号 16px 保持；`line-height` 统一 `1.5`，正文类用 1.6（Claude 宽松阅读）。

## 3. 色 token 映射（zinc/emerald → claude 暖系）

| 现在（zinc/emerald） | 替换为（Claude 暖系） | Tailwind 类 |
|----------------------|----------------------|-------------|
| `bg-zinc-50` 页面底 | Parchment `#f5f4ed` | `bg-[#f5f4ed]` |
| `bg-zinc-100` 面板 | Ivory `#faf9f5` | `bg-[#faf9f5]` |
| `bg-white` 卡片 | White `#fff`（保留） | `bg-white` |
| `border-zinc-200` | Border Cream `#f0eee6` | `border-[#f0eee6]` |
| `border-zinc-300`（hover） | Border Warm `#e8e6dc` | `border-[#e8e6dc]` |
| `text-zinc-900/800` 主文 | Near Black `#141413` | `text-[#141413]` |
| `text-zinc-700/600` 次文 | Olive Gray `#5e5d59` | `text-[#5e5d59]` |
| `text-zinc-500/400` 弱文 | Stone Gray `#87867f` | `text-[#87867f]` |
| `text-emerald-600/700` 强调 | Terracotta `#c96442` | `text-[#c96442]` |
| `bg-emerald-600` 主按钮 | Terracotta `#c96442` | `bg-[#c96442]` |
| `bg-emerald-50/100` 选中底 | Coral 浅调 `#fdf0ea` / Warm Sand `#e8e6dc` | `bg-[#fdf0ea]` |
| `ring-emerald-*` 焦点 | Focus Blue `#3898ec`（仅 focus ring） | `ring-[#3898ec]` |
| `text-red-600/500` 错误 | Crimson `#b53333` | `text-[#b53333]` |
| `bg-red-50` 错误底 | 暖红浅底 `#fbeae9` | `bg-[#fbeae9]` |
| `amber`/`orange` 待审 | 保留（暖系，已符合） | `amber`/`orange` |
| `purple` 过时 | 保留 | `purple` |
| `blue-*`（导航/链接） | Coral `#d97757` | `text-[#d97757]` |

**Semantic 语义色**（StageNode/徽章/图例）：completed/done/approved/通过 用 **sage 暖绿** `#728a52`（柔和、低饱和，区别于阻塞的绯红，避免"通过/阻塞同色"），in_progress 保留 amber，pending_review 保留 orange，rejected/blocked 用 Crimson `#b53333`，stale 保留 purple。**赤陶橙 `#c96442`(emerald) 只留交互/当前态**（主按钮、当前阶段、可派活、开关激活），不占完成态。所有状态色保持暖调。

> 更新记录（2026-08-25）：新增 `sage` 暖绿语义色板（`tailwind.config.js colors.sage`：50=`#f3f6ed`/100=`#e6ecd9`/300=`#aebe8f`/500=`#728a52`/600=`#5c7042`/700=`#4a5a36`）。此前 completed 误用 emerald（已被赤陶橙覆盖）导致"通过"与"阻塞"同属红橙色系、色相混淆且刺眼；现 completed/done/approved/成功 toast/进度条 全部改用 sage，blocked/rejected 保持暖绯红，赤陶橙回归交互定位。改动组件：ui/StatusDot、StageCockpit、GateOverview、FlowView、LLMConsole、PipelinePanel、TaskBoard、ReviewCenter、BatchQueue、ReportExport、App(toast)。

## 4. 阴影与圆角

- **阴影**：按钮/卡 hover 用 ring-shadow（`shadow-[0_0_0_1px_#d1cfc5]`）；卡片悬浮用 whisper（`shadow-[0_4px_24px_rgba(0,0,0,0.05)]`）；**移除**现有冷灰 drop-shadow。
- **圆角**：常规卡 `rounded-lg`(8px)；主按钮 `rounded-xl`(12px)；容器/抽屉 `rounded-2xl`(16px)。整体比现在更圆。

## 5. 字体

- 正文/UI：保持系统无衬线栈（含 PingFang SC/雅黑），符合 Claude "Sans for utility"。
- **标题可选加衬线**：Claude 品牌核心是 serif 标题（Georgia fallback）。本项目驾驶舱标题、面板标题可加 `font-serif`（Georgia/'Noto Serif SC'）营造人文感——**作为可选增强，先不加，避免大面积改动**。

## 6. 落地步骤

1. `tailwind.config.js`：fontSize 整体上移一档 + 新增 `colors.claude` 命名空间（Parchment/Terracotta/Ivory/...）。
2. `src/styles/tailwind.css`：body 底色改 Parchment，滚动条改暖调，`text-[10px]/[11px]` 批量替换。
3. `src/components/ui/index.tsx`：Button/Badge/StatusDot/Panel 的 emerald→terracotta、zinc 浅色→暖系。
4. `App.tsx`：header/状态条/侧栏/Footer 底色改暖，功能卡选中态 emerald→terracotta。
5. 核心面板 + 辅助面板：批量色 token 映射（emerald→terracotta，zinc 冷灰→暖灰）。
6. `docs/` 留档本方案 + `tsc` 验证 + 起 dev server 预览。

## 7. 风险

- **改动面大**：全部组件色类都要换，一次性批量改。
- **暖系 + 高密度数据**：暖底更适合阅读型界面，密集状态看板需保证状态色对比度（用 Terracotta/Crimson 深浅区分）。
- 保留 `colorspace`/`claude` 的 brand token 名，后续可随时整体切换。
