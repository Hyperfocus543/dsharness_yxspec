// YXSpec SQT 阶段映射 + 门控扫描（Track B 后端）
// 依据契约表：6 个子阶段、spec_glob、upstream 依赖。
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const PROJECT_ROOT = 'D:/Work/01_Projects/Aima_X1_BCM'

/** SQT 6 子阶段权威表（来自契约 + stage-mapping.ts）。 */
export const STAGES = {
  sqt_strategy: {
    command: '/yxspec:sqt-strategy',
    aspice: 'SYS.5/MAN.3',
    spec_glob: 'project/specs/sqt-tp/sqt-tp-*.md',
    // 上游是 SQT 之外的 SWE.5 阶段；契约示例默认 true（外部已就绪，SQT 从入口放行）
    upstream: { swe_integration_verify: true },
    label: 'SQT 策略',
    brief: 'SQT 测试策略：范围、测试层级、通过准则、环境需求',
  },
  sqt_tr: {
    command: '/yxspec:sqt-tr-analysis',
    aspice: 'SYS.5',
    spec_glob: 'project/specs/sqt-tr/sqt-tr-*.md',
    upstream: { sqt_strategy: false },
    label: '测试需求分析',
    brief: 'SQT 测试需求分析：功能/接口/非功能需求到测试需求的映射表',
  },
  sqt_case_design: {
    command: '/yxspec:sqt-case-design',
    aspice: 'SYS.5',
    spec_glob: 'project/specs/sqt-tc/sqt-tc-*.md',
    upstream: { sqt_tr: false },
    label: '测试用例设计',
    brief: 'SQT 测试用例设计：等价类/边界/场景法，含预期结果与覆盖需求',
  },
  sqt_script_gen: {
    command: '/yxspec:sqt-script-gen',
    aspice: 'SYS.5',
    spec_glob: 'tests/auto_test/features/*.feature',
    upstream: { sqt_case_design: false },
    label: '测试脚本生成',
    brief: 'SQT 自动化脚本：Gherkin feature 文件，步骤定义到用例',
  },
  sqt_auto_test: {
    command: '/yxspec:sqt-auto-test',
    aspice: 'SYS.5/SUP.8',
    spec_glob: 'tests/auto_test/reports/*.json',
    upstream: { sqt_script_gen: false },
    label: '自动化测试执行',
    brief: 'SQT 自动化执行：跑 feature，输出 JSON 测试报告',
  },
  sqt_defect_feedback: {
    command: '/yxspec:sqt-defect-feedback',
    aspice: 'SUP.8',
    spec_glob: 'project/specs/sqt-dr/sqt-dr-*.md',
    upstream: { sqt_auto_test: false },
    label: '缺陷反馈闭环',
    brief: 'SQT 缺陷反馈：缺陷列表、严重度、处置建议',
  },
}

export const STAGE_TOKENS = Object.keys(STAGES)

/**
 * 简单 glob 命中：目录 + 文件名模式（支持单个 * 通配）。
 * 相对项目根的 spec_glob 展开为绝对路径扫描。
 */
export function globHit(specGlob) {
  const parts = specGlob.replace(/\\/g, '/').split('/')
  const dir = join(PROJECT_ROOT, ...parts.slice(0, -1))
  const pattern = parts[parts.length - 1]
  if (!existsSync(dir)) return false
  try {
    const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
    return readdirSync(dir).some((name) => re.test(name))
  } catch {
    return false
  }
}

/** 扫描产物文件列表：`[{path, kind, size, mtime}]`（相对项目根）。 */
export function scanArtifacts(specGlob) {
  const parts = specGlob.replace(/\\/g, '/').split('/')
  const dir = join(PROJECT_ROOT, ...parts.slice(0, -1))
  const pattern = parts[parts.length - 1]
  if (!existsSync(dir)) return []
  try {
    const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
    const out = []
    for (const name of readdirSync(dir)) {
      if (!re.test(name)) continue
      const abs = join(dir, name)
      const st = statSync(abs)
      if (!st.isFile()) continue
      out.push({
        path: `${parts.slice(0, -1).join('/')}/${name}`,
        kind: name.endsWith('.md') ? 'markdown' : name.endsWith('.feature') ? 'gherkin' : name.endsWith('.json') ? 'json' : 'file',
        size: st.size,
        mtime: new Date(st.mtimeMs).toISOString(),
      })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  } catch {
    return []
  }
}

/**
 * 计算全部阶段的门控。upstream 状态取自 dsh_state（SQT 内部），
 * 外部 key（如 swe_integration_verify）保留 stage 默认。
 * 返回 `{ token: gate }`。
 */
export function scanGates(state) {
  const gates = {}
  for (const [token, stage] of Object.entries(STAGES)) {
    const upstream = {}
    let blocked = false
    const missing = []
    for (const [key, fallback] of Object.entries(stage.upstream)) {
      const up = state.stages?.[key]
      const ok = up ? up.state === 'done' : fallback
      upstream[key] = ok
      if (!ok) missing.push(key)
    }
    const specHit = globHit(stage.spec_glob)
    const blockedMsg = missing.length > 0
      ? `上游 ${missing.join('、')} 未完成，无法启动${stage.label}`
      : specHit
        ? `${stage.label}产物已存在，可进入 review`
        : `上游就绪，可推进${stage.label}`
    gates[token] = {
      upstream,
      spec_glob: stage.spec_glob,
      spec_hit: specHit,
      message: blockedMsg,
      // 门控判定：上游全部完成才算放行
      blocked,
    }
  }
  return gates
}

/** 从 prompt 识别目标阶段。仅完整命令匹配（/yxspec:<command>）。 */
export function resolveStage(prompt) {
  // 分析/咨询问句（含阶段名或中文标签）一律返回 null → 走 general 模式，
  // 避免"请分析 sqt_defect_feedback"误触发阶段执行 + 篡改状态。
  // （原 token/中文标签宽松匹配会误判，已移除——见 M2 压测记录 §13.7）
  for (const [token, stage] of Object.entries(STAGES)) {
    if (prompt.includes(stage.command)) return { token, stage }
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

/** 构造注入给 agent 的上下文 prompt。
 *  general=false（默认）：执行指定阶段并生成产物（模板驱动）
 *  general=true：不绑定阶段，仅读当前状态回答咨询类问题（分析/解释/进度等）
 */
export function buildAgentPrompt({ userPrompt, token, stage, state, gates, force, general }) {
  const gate = gates[token]
  const stageSummary = STAGE_TOKENS
    .map((t) => {
      const s = state.stages[t]
      return `- ${t} [${s?.state ?? '?'}] 产物: ${s?.artifacts?.length ?? 0} 项`
    })
    .join('\n')

  // 通用咨询模式：不要求生成产物，只读状态并直接回答
  if (general) {
    return `你是 YXSpec 车载嵌入式 ASPICE 流程助理（对话式）。用户提问：${userPrompt}

## 当前 SQT 流程状态（来自 dsh_state.json）
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
- 不提及任何 P02 基线版本号`
  }

  return `你是 YXSpec SQT 阶段执行 agent。用户在驾驶舱对话框提出：${userPrompt}

## 当前要推进的阶段
- token: ${token}
- 命令: ${stage.command}
- ASPICE: ${stage.aspice}
- 阶段名: ${stage.label}

## 当前 SQT 状态（来自 dsh_state.json）
${stageSummary}

## 门控扫描结果（前端注入，不靠你自行发现）
${JSON.stringify(gate, null, 2)}

## 产物规范
请按以下要求生成产物：
- 目标路径：匹配 ${stage.spec_glob}（在项目根 ${PROJECT_ROOT} 下创建目录与文件）
- 产物内容：${stage.brief}
- 产出物用 markdown 编写，文件命名格式：sqt-<token 去前缀>-<序号>-<主题>.md（如 project/specs/sqt-tr/sqt-tr-01-功能需求分析.md）
- 若产物已存在（spec_hit=true），先读它再增量补充

## 执行要求
1. 先调用 create_goal 创建目标，objective 必须包含阶段 token「${token}」，标记进行中
2. 再用 todo_write 建立 2-4 个任务计划
3. 用 fs / bash 工具创建产物文件：**同一轮里一次发多个工具调用并行写入所有文件**（不要写一个等一个）；每份产物相互独立、不需等待彼此
4. 全部完成后，用 todo_write 把任务标记 completed
5. 最后回复一段中文总结，说明产物路径与覆盖内容

## 提速要求
- 本阶段产物建议拆成 2-5 个独立 markdown 并行写出（如 sqt-tc-01-总体框架、sqt-tc-02-功能用例、sqt-tc-03-接口用例、sqt-tc-04-非功能用例）
- 能用一次工具调用完成多文件的（如 bash 写多个文件）优先，避免逐文件串行往返

## 保密红线（必须遵守）
- 只动 project/specs/sqt-*、tests/auto_test/、PROGRESS.md、.dsh/
- 绝不读/写 baselines/、_monitor/ 里的任何内容
- 不提及任何 P02 基线版本号，所有工作基于当前状态从零生成`
}
