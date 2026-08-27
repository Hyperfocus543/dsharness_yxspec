// YXSpec 全 25 阶段映射 + 门控扫描（Track B 后端 · 铺满版）
// =============================================================================
// 依据：
//   - 权威映射表：ai_tbox/.claude/commands/yxspec/next.md §29-60（人读权威）
//   - 前端镜像：   yxspec-studio/src/data/stage-mapping.ts（27 条，含废弃/变体）
//   - 坑清单（见探查报告 §6）：token≠命令名、无 slash 阶段、废弃节点、审查命名例外
//
// 关键纪律：
//   1. stage_token（下划线）≠ 命令名（连字符）≠ 产物目录。命令名与 stage-mapping.ts 逐字一致。
//   2. 无 slash 命令阶段（hwe_analysis / comp / traceability）在网关层补合成命令
//      （/yxspec:hwe-analysis 等），框架原为 agent 触发——这是网关对框架的扩展。
//   3. swe_detail / swe_mod_develop_guid 已废弃（CLAUDE.md），标记 deprecated，默认链跳过：
//      swe_arch_if 直接承接 swe_coding_plan。
//   4. swe_coding_verify_pc 是 swe_coding_verify 的 PC 变体（二选一/并行），标记 variant。
// =============================================================================
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFeatureSections } from './features.mjs'
import { PROJECT_ROOT, TEMPLATES_ROOT, KNOWLEDGE_INDEX } from './paths.mjs'

// =============================================================================
// 项目路径常量（唯一来源见 lib/paths.mjs；此处保留导出以向后兼容）
// =============================================================================
export { PROJECT_ROOT, TEMPLATES_ROOT, KNOWLEDGE_INDEX } from './paths.mjs'

/** 25 阶段权威表（flow 顺序即 nextCurrent 推进顺序）。 */
export const STAGES = {
  // ===== ACQ.4 =====
  init: {
    token: 'init',
    command: '/yxspec:init',
    aspice: 'ACQ.4',
    spec_globs: ['project/inputs/parsed/**/*.md'],
    upstream: {}, // 无上游，项目入口
    review_gate: false,
    label: 'SOR 解析',
    brief: '解析原始 SOR 客户输入文档，产出结构化 parsed/ 文件与 parse-summary',
    template: null,
  },
  // ===== SYS.1 =====
  sys_elicitation: {
    token: 'sys_elicitation',
    command: '/yxspec:prd-analysis', // token≠命令名！
    aspice: 'SYS.1',
    spec_globs: ['project/specs/prd/prd-*.md'],
    upstream: { init: false },
    review_gate: true,
    label: '产品需求分析',
    brief: '产品需求生成（PRD）：从 parsed SOR 提炼 REQ，编号 REQ-{类别}-{SEQ}',
    template: 'md/prd.md.tpl',
  },
  // ===== SYS.2 =====
  sys_analysis: {
    token: 'sys_analysis',
    command: '/yxspec:sys-analysis',
    aspice: 'SYS.2',
    spec_globs: ['project/specs/sys/sys-req-*.md'],
    upstream: { sys_elicitation: false },
    review_gate: true,
    label: '系统需求分析',
    brief: '系统需求：SR 条目带 derived_from=PRD，编号 {spec}-SR-{SEQ}，10 字段结构',
    template: 'md/sys-req.md.tpl',
  },
  // ===== SYS.3 =====
  sys_arch: {
    token: 'sys_arch',
    command: '/yxspec:sys-arch',
    aspice: 'SYS.3',
    spec_globs: ['project/specs/sys/sys-arch-*.md'],
    upstream: { sys_analysis: false },
    review_gate: true,
    label: '系统架构设计',
    brief: '系统架构：子系统/模块划分、接口、部署视图，derived_from=SYS-REQ',
    template: 'md/sys-arch.md.tpl',
  },
  // ===== HWE.1（无 slash，网关合成命令）=====
  hwe_analysis: {
    token: 'hwe_analysis',
    command: '/yxspec:hwe-analysis', // 合成命令（框架经 agent 触发）
    aspice: 'HWE.1',
    spec_globs: ['project/specs/sys/hw-analyse-*.md'],
    upstream: { sys_arch: false },
    review_gate: true,
    label: '硬件需求分析',
    brief: '硬件需求：HW 需求条目、约束、derived_from=SYS-REQ（12 章节结构）',
    template: 'md/hw-analyse.md.tpl',
    synthetic: true,
  },
  // ===== SWE.1 =====
  swe_analysis: {
    token: 'swe_analysis',
    command: '/yxspec:swe-analysis',
    aspice: 'SWE.1',
    spec_globs: ['project/specs/sw-srs/sw-srs-*.md'],
    upstream: { sys_arch: false },
    review_gate: true,
    label: '软件需求分析',
    brief: '软件需求（SW-SRS）：SWR 条目 15 字段统一结构，编号 {spec}-SWR-{CAT}-{SEQ:4}',
    template: 'md/sw-srs.md.tpl',
  },
  // ===== SWE.2 =====
  swe_arch: {
    token: 'swe_arch',
    command: '/yxspec:swe-arch-v2', // 命令带 -v2！
    aspice: 'SWE.2',
    spec_globs: ['project/specs/sw-arch/sw-arch-*.md'],
    upstream: { swe_analysis: false },
    review_gate: true,
    label: '软件架构设计',
    brief: '软件架构：模块划分（MOD-xxx）、契约 registry JSON、derived_from=SWR',
    template: null, // 由 contract JSON 生成，非模板驱动
  },
  // ===== SWE.3 =====
  swe_arch_if: {
    token: 'swe_arch_if',
    command: '/yxspec:swe-arch-if-v2', // 命令带 -v2！
    aspice: 'SWE.3',
    spec_globs: [
      'project/specs/sw-arch/sw-if/sw-if-*.md',
      'project/specs/sw-arch/sw-shared-types.md',
    ],
    upstream: { swe_arch: false },
    review_gate: false,
    label: '软件接口规范',
    brief: '接口规范：IF-MOD 公共参数 + sw-shared-types，derived_from=SW-ARCH',
    template: 'md/sw-if-mod.md.tpl',
  },
  // ===== SWE.3 已废弃节点（保留但默认跳过）=====
  swe_detail: {
    token: 'swe_detail',
    command: '/yxspec:swe-detail',
    aspice: 'SWE.3',
    spec_globs: ['project/specs/sw-ddd/sw-ddd-*-ddd-mod-*.md'],
    upstream: { swe_arch_if: false },
    review_gate: true,
    label: '软件详细设计',
    brief: '详细设计（DDD）——已废弃，由 swe-coding-plan-v2 直接承接 swe-arch-if-v2',
    template: 'md/sw-ddd.md.tpl',
    deprecated: true,
  },
  // ===== SWE.4 编码计划 =====
  swe_coding_plan: {
    token: 'swe_coding_plan',
    command: '/yxspec:swe-coding-plan-v2', // 命令带 -v2！
    aspice: 'SWE.4',
    spec_globs: [
      'project/tasks/coding-plan/coding-plan-MOD-*.md',
      'project/tasks/coding-plan/coding-plan-index.md',
    ],
    upstream: { swe_arch_if: false }, // 直接承接 swe_arch_if（swe_detail 已废弃）
    review_gate: true,
    label: '模块编码计划',
    brief: '编码计划：每个 MOD 一份 coding-plan，含上下文摘要 + 原子任务 + 上游 API 白名单',
    template: null,
  },
  // ===== SWE.4 编码执行 =====
  swe_coding_do: {
    token: 'swe_coding_do',
    command: '/yxspec:swe-coding-do-v2', // 命令带 -v2！
    aspice: 'SWE.4',
    spec_globs: [
      'project/tasks/coding-do/coding-result-MOD-*.md',
      'project/source/app_src/**/*',
    ],
    upstream: { swe_coding_plan: false },
    review_gate: false, // 可选审查；review token=swe_coding
    label: '模块编码执行',
    brief: '编码执行：按 coding-plan 落 C/H 源码，产出 coding-result + 源码文件',
    template: null,
    restrictTools: true, // 只允许 fs/bash
  },
  // ===== SUP.1 静态验证 =====
  swe_static_verify: {
    token: 'swe_static_verify',
    command: '/yxspec:swe-static-verify',
    aspice: 'SUP.1',
    spec_globs: ['project/tests/static/*.html'],
    upstream: { swe_coding_do: false },
    review_gate: false,
    label: '静态验证',
    brief: '静态分析：Cppcheck/MISRA 报告（HTML），覆盖编码产物',
    template: null,
    restrictTools: true,
  },
  // ===== SWE.4 编码验证 =====
  swe_coding_verify: {
    token: 'swe_coding_verify',
    command: '/yxspec:swe-coding-verify-v2', // 命令带 -v2！
    aspice: 'SWE.4',
    spec_globs: ['project/tasks/coding-verify/coding-verify-report.md'],
    upstream: { swe_static_verify: false },
    review_gate: false,
    label: '编码验证',
    brief: '编码验证：按模块跑 verify，产出 coding-verify-report（编译/行为/回归）',
    template: null,
    restrictTools: true,
  },
  // ===== SWE.4 PC 变体（与 swe_coding_verify 二选一/并行）=====
  swe_coding_verify_pc: {
    token: 'swe_coding_verify_pc',
    command: '/yxspec:swe-coding-verify-pc-v2', // 命令带 -v2！
    aspice: 'SWE.4',
    spec_globs: ['project/tasks/coding-verify-pc/coding-verify-pc-report.md'],
    upstream: { swe_static_verify: false },
    review_gate: false,
    label: 'PC 端编码验证',
    brief: 'PC 端编码验证（Linux Twins）——实机验证的 PC 变体',
    template: null,
    variant: true,
    restrictTools: true,
  },
  // ===== SWE.4 单元验证 =====
  swe_unit_verify: {
    token: 'swe_unit_verify',
    command: '/yxspec:swe-unit-verify',
    aspice: 'SWE.4',
    spec_globs: ['project/specs/ts-ut/ts-ut-*.md'],
    upstream: { swe_coding_verify: false },
    review_gate: true,
    label: '单元验证',
    brief: '单元测试设计：ts-ut 用例，derived_from=SWR，覆盖编码模块',
    template: 'md/ts-ut.md.tpl',
  },
  // ===== SWE.5 集成验证 =====
  swe_integration_verify: {
    token: 'swe_integration_verify',
    command: '/yxspec:swe-integration-verify',
    aspice: 'SWE.5',
    spec_globs: ['project/specs/ts-it/ts-it-*.md'],
    upstream: { swe_unit_verify: false },
    review_gate: true,
    label: '集成验证',
    brief: '集成测试设计：ts-it 用例，模块间集成场景',
    template: 'md/ts-it.md.tpl',
  },
  // ===== SYS.5 BP1 测试策略 =====
  sqt_strategy: {
    token: 'sqt_strategy',
    command: '/yxspec:sqt-strategy',
    aspice: 'SYS.5/MAN.3',
    spec_globs: ['project/specs/sqt-tp/sqt-tp-*.md'],
    upstream: { swe_integration_verify: false },
    review_gate: true,
    label: '测试策略方案',
    brief: 'SQT 测试策略：FUNC/NFR×8/IF 三分法、测试层级、环境、外设依赖矩阵',
    template: 'md/sqt-tp.md.tpl',
  },
  // ===== SYS.5 BP2 测试需求分析 =====
  sqt_tr: {
    token: 'sqt_tr',
    command: '/yxspec:sqt-tr-analysis', // token≠命令名！
    aspice: 'SYS.5',
    spec_globs: ['project/specs/sqt-tr/sqt-tr-*.md'],
    upstream: { sqt_strategy: false },
    review_gate: true,
    label: '测试需求分析',
    brief: '测试需求：功能/接口/非功能需求→测试需求的映射表（FUNC/IF/NFR）',
    template: 'md/sqt-tr-func.md.tpl',
  },
  // ===== SYS.5 BP3 测试用例设计 =====
  sqt_case_design: {
    token: 'sqt_case_design',
    command: '/yxspec:sqt-case-design',
    aspice: 'SYS.5',
    spec_globs: ['project/specs/sqt-tc/sqt-tc-*.md'],
    upstream: { sqt_tr: false },
    review_gate: true,
    label: '测试用例设计',
    brief: '测试用例：等价类/边界/场景法，含预期结果与覆盖需求（FUNC/IF/NFR 子目录）',
    template: 'md/sqt-tc-func.md.tpl',
  },
  // ===== SYS.5 BP4 脚本生成 =====
  sqt_script_gen: {
    token: 'sqt_script_gen',
    command: '/yxspec:sqt-script-gen',
    aspice: 'SYS.5',
    spec_globs: [
      'project/tests/auto_test/features/**/*.feature',
      'project/tests/auto_test/features/steps/*.py',
    ],
    upstream: { sqt_case_design: false },
    review_gate: false,
    label: '测试脚本生成',
    brief: '自动化脚本：Gherkin feature + steps 定义，覆盖用例',
    template: null,
  },
  // ===== SYS.5/SUP.8 自动化测试 =====
  sqt_auto_test: {
    token: 'sqt_auto_test',
    command: '/yxspec:sqt-auto-test',
    aspice: 'SYS.5/SUP.8',
    spec_globs: ['project/tests/**/defect-reports/**/report.md'],
    upstream: { sqt_script_gen: false },
    review_gate: false,
    label: '自动化测试执行',
    brief: '自动化执行：跑 feature，输出缺陷报告 report.md（{imei}_{ts}_{fd}/def-*）',
    template: null,
    restrictTools: true,
  },
  // ===== SUP.8 缺陷反馈闭环 =====
  sqt_defect_feedback: {
    token: 'sqt_defect_feedback',
    command: '/yxspec:sqt-defect-feedback',
    aspice: 'SUP.8',
    spec_globs: ['project/specs/sqt-dr/sqt-dr-*.md'],
    upstream: { sqt_auto_test: false },
    review_gate: true,
    label: '缺陷反馈闭环',
    brief: '缺陷反馈：5-Why 根因分析、严重度分级、上游反馈建议',
    template: 'md/sqt-dr.md.tpl',
  },
  // ===== SUP.1 合规检查（无 slash，网关合成命令）=====
  comp: {
    token: 'comp',
    command: '/yxspec:comp', // 合成命令（框架经 agent 触发）
    aspice: 'SUP.1',
    spec_globs: ['project/specs/comp-report-*.md'],
    upstream: { sqt_defect_feedback: false },
    review_gate: false,
    label: '合规检查',
    brief: '合规检查：ASPICE 流程符合性报告（comp-report）',
    template: 'md/comp-report.md.tpl',
    synthetic: true,
  },
  // ===== SUP.2 追溯矩阵（无 slash，网关合成命令）=====
  traceability: {
    token: 'traceability',
    command: '/yxspec:traceability', // 合成命令（框架经 agent 触发）
    aspice: 'SUP.2',
    spec_globs: ['project/traceability/traceability-report-*.md'],
    upstream: { comp: false },
    review_gate: false,
    label: '追溯矩阵',
    brief: '追溯矩阵：PRD→SR→SWR→Test 全覆盖的 traceability-report',
    template: 'md/traceability-report.md.tpl',
    synthetic: true,
  },
  // ===== SPL.2 SDK 发布 =====
  swe_sdk_release: {
    token: 'swe_sdk_release',
    command: '/yxspec:swe-sdk-release',
    aspice: 'SPL.2',
    spec_globs: [], // SDK BSP tag，无文件产物
    upstream: { traceability: false },
    review_gate: false,
    label: 'SDK 发布',
    brief: 'SDK 发布：BSP tag + PLAT_VAR_VERSION 版本回灌（无文件产物）',
    template: null,
  },
  // ===== SPL.2 应用发布 =====
  swe_release: {
    token: 'swe_release',
    command: '/yxspec:swe-release',
    aspice: 'SPL.2',
    spec_globs: ['CHANGELOG.md'],
    upstream: { swe_sdk_release: false },
    review_gate: false,
    label: '应用发布',
    brief: '应用发布：CHANGELOG + annotated tag',
    template: null,
  },
  // ===== SPL.2 发布过渡 =====
  swe_release_promote: {
    token: 'swe_release_promote',
    command: '/yxspec:swe-release-promote',
    aspice: 'SPL.2',
    spec_globs: [], // stage 过渡（alpha→beta→rc→release），无文件产物
    upstream: { swe_release: false },
    review_gate: false,
    label: '发布过渡',
    brief: '发布阶段过渡：alpha→beta→rc→release 状态推进（无文件产物）',
    template: null,
  },
}

export const STAGE_TOKENS = Object.keys(STAGES)

// =============================================================================
// glob 匹配（支持 * 与 ** 递归；相对项目根）
// =============================================================================
function globMatch(pattern) {
  const parts = pattern.replace(/\\/g, '/').split('/')
  const out = []
  const walk = (dirAbs, segIdx, prefix) => {
    if (segIdx >= parts.length) {
      try { if (statSync(dirAbs).isFile()) out.push(prefix) } catch { /* 非文件忽略 */ }
      return
    }
    const seg = parts[segIdx]
    if (seg === '**') {
      // 0 层（跳过该段）
      walk(dirAbs, segIdx + 1, prefix)
      // 1+ 层（进入所有子目录）
      let entries = []
      try { entries = readdirSync(dirAbs, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (!e.isDirectory()) continue
        const next = prefix ? `${prefix}/${e.name}` : e.name
        walk(join(dirAbs, e.name), segIdx, next)
      }
    } else if (seg.includes('*')) {
      const re = new RegExp('^' + seg.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$')
      let entries = []
      try { entries = readdirSync(dirAbs, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (!re.test(e.name)) continue
        const next = prefix ? `${prefix}/${e.name}` : e.name
        walk(join(dirAbs, e.name), segIdx + 1, next)
      }
    } else {
      walk(join(dirAbs, seg), segIdx + 1, prefix ? `${prefix}/${seg}` : seg)
    }
  }
  walk(PROJECT_ROOT, 0, '')
  return out.sort()
}

/** 单 glob 是否有命中。 */
export function globHit(specGlob) {
  return globMatch(specGlob).length > 0
}

/** 单 glob 扫描产物文件列表：`[{path, kind, size, mtime}]`（相对项目根）。 */
export function scanArtifacts(specGlob) {
  const kindOf = (name) =>
    name.endsWith('.md') ? 'markdown'
      : name.endsWith('.feature') ? 'gherkin'
      : name.endsWith('.json') ? 'json'
      : name.endsWith('.html') ? 'html'
      : name.endsWith('.py') ? 'python'
      : name.endsWith('.c') || name.endsWith('.h') ? 'code'
      : 'file'
  return globMatch(specGlob).map((p) => {
    const abs = join(PROJECT_ROOT, ...p.split('/'))
    let st = null
    try { st = statSync(abs) } catch { st = { size: 0, mtimeMs: 0 } }
    const name = p.split('/').pop()
    return {
      path: p,
      kind: kindOf(name),
      size: st.size,
      mtime: new Date(st.mtimeMs).toISOString(),
    }
  })
}

/** 跨阶段全部 spec_globs 扫描（去重，按路径排序）。 */
export function scanStageArtifacts(stage) {
  const seen = new Set()
  const out = []
  for (const g of stage.spec_globs || [stage.spec_glob]) {
    for (const a of scanArtifacts(g)) {
      if (seen.has(a.path)) continue
      seen.add(a.path)
      out.push(a)
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** 阶段产物是否有命中（任一 glob）。 */
export function stageGlobHit(stage) {
  return (stage.spec_globs || [stage.spec_glob]).some((g) => globHit(g))
}

// =============================================================================
// 门控扫描
// =============================================================================
export function scanGates(state) {
  const gates = {}
  for (const [token, stage] of Object.entries(STAGES)) {
    const upstream = {}
    const missing = []
    for (const [key, fallback] of Object.entries(stage.upstream || {})) {
      const up = state.stages?.[key]
      const ok = up ? up.state === 'done' : fallback
      upstream[key] = ok
      if (!ok) missing.push(key)
    }
    const specHit = stageGlobHit(stage)
    const blocked = missing.length > 0
    const blockedMsg = missing.length > 0
      ? `上游 ${missing.join('、')} 未完成，无法启动${stage.label}`
      : specHit
        ? `${stage.label}产物已存在，可进入 review`
        : `上游就绪，可推进${stage.label}`
    gates[token] = {
      upstream,
      spec_glob: (stage.spec_globs || [])[0] ?? '',
      spec_hit: specHit,
      message: blockedMsg,
      blocked,
    }
  }
  return gates
}

/** 从 prompt 识别目标阶段。仅完整命令匹配（/yxspec:<command>）。
 *  边界规则：命令后必须跟 空白/标点/字符串结尾，禁止子串命中——
 *  否则 /yxspec:swe-coding-verify-v2 会误吞 /yxspec:swe-coding-verify-pc-v2。
 *  按命令长度降序匹配：同时提及多个命令时取最具体的那个（PC 变体优先）。 */
export function resolveStage(prompt) {
  // 分析/咨询问句（含阶段名或中文标签）一律返回 null → 走 general 模式，
  // 避免"请分析 sqt_defect_feedback"误触发阶段执行 + 篡改状态。
  const text = String(prompt ?? '')
  const byLen = Object.entries(STAGES).sort(
    (a, b) => b[1].command.length - a[1].command.length,
  )
  for (const [token, stage] of byLen) {
    const cmd = stage.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?:^|[^\\w-])${cmd}(?:$|[\\s.,;:!?，。；：！？、)）]|(?:[^\\w-]))`)
    if (re.test(text)) return { token, stage }
  }
  return null
}

/** 同步外部 gate 到 state（将外部默认写回 state 结构，与契约一致）。 */
export function applyGatesToState(state, gates) {
  for (const [token, gate] of Object.entries(gates)) {
    if (!state.stages[token]) continue
    state.stages[token].gate = gate
  }
  return state
}

// =============================================================================
// 模板读取（条件降级：模板不存在 → 返回 null）
// =============================================================================
function readTemplate(rel) {
  if (!rel) return null
  try {
    const abs = join(TEMPLATES_ROOT, rel.split('/').join('\\'))
    if (!existsSync(abs)) return null
    return readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
}

/** 知识库 index 是否可注入（检索优先）。 */
export function hasKnowledgeIndex() {
  return existsSync(KNOWLEDGE_INDEX)
}

// =============================================================================
// prompt 构造
//   general=false（默认）：执行指定阶段并生成产物（模板驱动）
//   general=true：不绑定阶段，仅读当前状态回答咨询类问题（分析/解释/进度等）
// =============================================================================
export function buildAgentPrompt({ userPrompt, token, stage, state, gates, force, general }) {
  const gate = gates?.[token]
  const stageSummary = STAGE_TOKENS
    .map((t) => {
      const s = state.stages?.[t]
      return `- ${t} [${s?.state ?? '?'}] 产物: ${s?.artifacts?.length ?? 0} 项`
    })
    .join('\n')

  // 通用咨询模式：不要求生成产物，只读状态并直接回答
  if (general) {
    return `你是 YXSpec 车载嵌入式 ASPICE 流程助理（对话式）。用户提问：${userPrompt}

## 当前全流程状态（来自 dsh_state.json）
${stageSummary}

## 当前阶段
- current: ${state.current ?? '未知'}
- 说明：state 中 state='done' 表示已完成，'in_progress' 表示进行中，'pending' 表示未开始

## 要求
- 直接基于上面状态回答用户的问题（分析进度、解释卡点、说明下一步等）
- 引用具体阶段 token 和状态，不要泛泛而谈
- 如果需要更多文件细节，可用 fs / bash 读取项目内 .dsh/dsh_state.json 或 PROGRESS.md
- 不要创建任何产物文件，不要修改任何状态，只回答问题
- 最后用中文简洁总结

## 保密红线（必须遵守）
- 绝不读/写 baselines/、_monitor/ 里的任何内容
- 不提及任何历史基线版本标识，所有工作基于当前状态从零生成`
  }

  // ===== 阶段执行模式 =====
  const parts = []
  parts.push(`你是 YXSpec 车载嵌入式 ASPICE 阶段执行 agent（流程驱动）。用户在驾驶舱对话框提出：${userPrompt}`)
  parts.push(``)
  parts.push(`## 当前要推进的阶段`)
  parts.push(`- token: ${token}`)
  parts.push(`- 命令: ${stage.command}`)
  parts.push(`- ASPICE: ${stage.aspice}`)
  parts.push(`- 阶段名: ${stage.label}`)
  if (stage.deprecated) parts.push(`- ⚠️ 本阶段已废弃：${stage.brief}（若用户误触，请说明并建议跳转到 swe-coding-plan-v2）`)
  else if (stage.variant) parts.push(`- ℹ️ 本阶段是变体：${stage.brief}（与 swe_coding_verify 二选一/并行）`)

  parts.push(``)
  parts.push(`## 当前全流程状态（来自 dsh_state.json）`)
  parts.push(stageSummary)

  // 上游已完成产物清单 → 追溯链
  const upstreamDone = Object.entries(stage.upstream || {})
    .map(([k]) => state.stages?.[k])
    .filter((s) => s && s.state === 'done')
  if (upstreamDone.length > 0) {
    parts.push(``)
    parts.push(`## 上游已完成产物（追溯链：新产物条目必须 derived_from 引用它们）`)
    for (const s of upstreamDone) {
      const files = (s.artifacts || []).map((a) => a.path)
      parts.push(`- ${s.token} [${s.state}]: ${files.length > 0 ? files.join(', ') : '(无产物文件)'}`)
    }
    parts.push(`- 引用格式：derived_from 用完整文件名（含版本号）+ §章节，相对路径从产物所在目录起算`)
  }

  // 知识库检索优先（index.md 存在才注入）
  if (hasKnowledgeIndex()) {
    parts.push(``)
    parts.push(`## 检索优先（上游源资料）`)
    parts.push(`- 查询项目内 inputs/raw|baselines 范围的上游源资料时，先读 project/knowledge/index.md 定位候选源行，再按出处跳源文件`)
  }

  // 模板驱动注入（模板存在才注入）
  const tpl = readTemplate(stage.template)
  if (tpl) {
    parts.push(``)
    parts.push(`## 产物模板（必须遵循，见 templates/${stage.template}）`)
    parts.push(`模板关键结构（${stage.template}）：`)
    parts.push(tpl.slice(0, 4000)) // 截断避免超长
  }

  // 功能商店注入（启用且适用于本阶段的 feature 规则/检查单/评分标准）
  const featureSections = buildFeatureSections(token, stage)
  if (featureSections) {
    parts.push(``)
    parts.push(`## 已启用的质量功能（功能商店）`)
    parts.push(featureSections)
  }

  parts.push(``)
  parts.push(`## 门控扫描结果（前端注入，不靠你自行发现）`)
  parts.push(JSON.stringify(gate ?? null, null, 2))

  parts.push(``)
  parts.push(`## 产物规范`)
  parts.push(`请按以下要求生成产物：`)
  parts.push(`- 目标路径：匹配 ${(stage.spec_globs || []).join(' 或 ')}（在项目根 ${PROJECT_ROOT} 下创建目录与文件）`)
  parts.push(`- 产物内容：${stage.brief}`)
  if (stage.review_gate) {
    parts.push(`- 本阶段有审查门控：产物完成后将进入 review，请保证条目带 derived_from / verifies 追溯字段，禁止 internal/空值/null`)
  }
  parts.push(`- 若产物已存在（spec_hit=true），先读它再增量补充`)
  parts.push(`- 命名规范：小写英文，单词间用连字符 - 或下划线 _ 分隔，禁止大写/中文/空格/特殊字符（内容文字用中文，文件名用英文）`)

  // 工具集裁剪（coding 阶段）
  if (stage.restrictTools) {
    parts.push(``)
    parts.push(`## 工具限制`)
    parts.push(`- 本阶段只允许使用 fs（文件读写）和 bash（执行命令）工具`)
    parts.push(`- 禁止调用 create_goal / todo_write 之外的任何 agent 编排工具、web 搜索、外部 API 工具`)
    parts.push(`- 需要多次文件操作时，一次 tool_call 并行发起，避免逐文件串行往返`)
  } else {
    parts.push(``)
    parts.push(`## 执行要求`)
    parts.push(`1. 先调用 create_goal 创建目标，objective 必须包含阶段 token「${token}」，标记进行中`)
    parts.push(`2. 再用 todo_write 建立 2-4 个任务计划`)
    parts.push(`3. 用 fs / bash 工具创建产物文件：同一轮里一次发多个工具调用并行写入所有文件（不要写一个等一个）`)
    parts.push(`4. 全部完成后，用 todo_write 把任务标记 completed`)
    parts.push(`5. 最后回复一段中文总结，说明产物路径与覆盖内容`)
    parts.push(``)
    parts.push(`## 提速要求`)
    parts.push(`- 本阶段产物建议拆成 2-5 个独立 markdown 并行写出`)
    parts.push(`- 能用一次工具调用完成多文件的（如 bash 写多个文件）优先，避免逐文件串行往返`)
  }

  parts.push(``)
  parts.push(`## 保密红线（必须遵守）`)
  parts.push(`- 只动 project/、tests/、CHANGELOG.md、PROGRESS.md、.dsh/ 下的文件`)
  parts.push(`- 绝不读/写 baselines/、_monitor/ 里的任何内容`)
  parts.push(`- 不提及任何历史基线版本标识，所有工作基于当前状态从零生成`)

  return parts.join('\n')
}
