// 项目路径常量（唯一来源，避免跨模块重复定义/循环依赖）
// =============================================================================
// 被 stages.mjs / state.mjs / features.mjs 等共同引用。项目根可经环境变量
// YXSPEC_PROJECT_ROOT 覆盖（缺省回落 Aima_X1_BCM，向后兼容）。后续切 ai_tbox
// 只需设变量。
//
// TEMPLATES_ROOT：产物模板 / 质量规则权威源。框架侧 ai_tbox/yxspec/templates
// 是唯一权威（stage 模板 + rules + yaml 检查单 + coding-specs 全在这），
// Aima 本地 templates/ 从未存在过 → readTemplate() 一直恒 null（模板从不注入）。
// 这里默认指向框架侧（只读引用，不动框架），可用 YXSPEC_TEMPLATES_ROOT 覆盖。
// =============================================================================
import { join } from 'node:path'

export const PROJECT_ROOT = process.env.YXSPEC_PROJECT_ROOT || 'D:/Work/01_Projects/Aima_X1_BCM'
export const TEMPLATES_ROOT =
  process.env.YXSPEC_TEMPLATES_ROOT ||
  'D:/Work/01_Projects/AI培训相关/yxspec_v4_tailg_linhanfei/ai_tbox/yxspec/templates'
// COMMANDS_ROOT：阶段执行规范权威源（ai_tbox/.claude/commands/yxspec/，33 个阶段命令文件）。
// 与 TEMPLATES_ROOT 同模式：默认指向框架侧（只读引用），可用 YXSPEC_COMMANDS_ROOT 覆盖。
export const COMMANDS_ROOT =
  process.env.YXSPEC_COMMANDS_ROOT ||
  'D:/Work/01_Projects/AI培训相关/yxspec_v4_tailg_linhanfei/ai_tbox/.claude/commands/yxspec'
export const KNOWLEDGE_INDEX = join(PROJECT_ROOT, 'project', 'knowledge', 'index.md')
export const STATE_PATH = join(PROJECT_ROOT, '.dsh', 'dsh_state.json')
