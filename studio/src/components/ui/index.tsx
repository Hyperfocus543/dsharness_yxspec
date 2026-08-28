// =============================================================================
// UI 基础层 — 统一设计语言（按 design-taste-frontend skill）
// 基线：
//   - 单强调色：emerald（深绿），避免 AI 蓝紫审美
//   - 中性底：zinc 系列（非蓝灰）
//   - 禁 emoji：全部图标用 Phosphor（@phosphor-icons/react）
//   - Dashboard 密度 (VISUAL_DENSITY 4-7)：少卡片多边框分组
//   - 交互：`:active` 触感（scale/translate）、加载骨架、空/错误态
// =============================================================================
// 原子组件拆分到独立文件（架构红线 200 行），本文件仅做 re-export：
//   Icon → ./Icon.tsx；Button → ./Button.tsx；Badge/StatusDot → ./Badge.tsx；
//   Skeleton → ./Skeleton.tsx；EmptyState/Panel/PanelHeader/SectionLabel → ./Layout.tsx
// 对外 API 不变：`import { Icon, Badge } from '../ui'` 等用法全部保持兼容。
// =============================================================================

export { Icon } from './Icon';
export { Button } from './Button';
export { Badge, StatusDot, STATUS_TONE, STATUS_LABEL } from './Badge';
export { Skeleton } from './Skeleton';
export { EmptyState, Panel, PanelHeader, SectionLabel } from './Layout';
export { GitDiffPreview } from './GitDiffPreview';
