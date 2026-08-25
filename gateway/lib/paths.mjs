// 项目路径常量（唯一来源，避免跨模块重复定义/循环依赖）
// =============================================================================
// 被 stages.mjs / state.mjs / features.mjs 等共同引用。项目根可经环境变量
// YXSPEC_PROJECT_ROOT 覆盖（缺省回落 Aima_X1_BCM，向后兼容）。后续切 ai_tbox
// 只需设变量。
// =============================================================================
import { join } from 'node:path'

export const PROJECT_ROOT = process.env.YXSPEC_PROJECT_ROOT || 'D:/Work/01_Projects/Aima_X1_BCM'
export const TEMPLATES_ROOT = process.env.YXSPEC_TEMPLATES_ROOT || join(PROJECT_ROOT, 'templates')
export const KNOWLEDGE_INDEX = join(PROJECT_ROOT, 'project', 'knowledge', 'index.md')
export const STATE_PATH = join(PROJECT_ROOT, '.dsh', 'dsh_state.json')
