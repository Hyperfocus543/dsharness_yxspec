// =============================================================================
// candidates.mjs — 已验证待接入能力清单（GET /api/capability-candidates）
// =============================================================================
// 场景：subagent / session-query / ralph / schedule / feedback / commands /
//       invariants 已在 POC 副本装配 + 独立端口验证通过，但**尚未进主 cordis.yml**。
//       前端「插件中心」据此展示「已验证待接入能力」，避免"功能做了但页面看不出来"。
//
// 数据语义：
//   · 本注册表是**静态手维护**——每次把一项能力真正接进主 cordis.yml 后，
//     应把它从本表移除（或标记 wired=true），保持「已接入」与「候选」不重复。
//   · 每条附 证据文件 与 验证端口，供回溯。
// =============================================================================

export const CAPABILITY_CANDIDATES = [
  {
    id: 'subagent',
    name: 'subagent（并行子代理）',
    desc: 'agent 委派子 agent 并行执行——验证/评审阶段并行提效（6 个 provider，spawn 全新 / fork 继承父历史）',
    packages: ['@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-tool-subagent', '@deepseek-ai/dsh-subagent-spawn-in-process', '@deepseek-ai/dsh-subagent-fork-in-process'],
    verified: true,
    verifiedAt: '2026-08-26',
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.1',
    port: 8788,
    guard: true, // 需 @yxspec/tool-guard 白名单放行
    wired: false,
  },
  {
    id: 'session-query',
    name: 'session-query（审计检索 + 轨迹）',
    desc: 'session 日志授权检索 + traceSession/traceEvent 轨迹追踪——ASPICE 追溯断链定位（complete:false）',
    packages: ['@deepseek-ai/dsh-session-query', '@deepseek-ai/dsh-session-query-sqlite', '@deepseek-ai/dsh-tool-session-query'],
    verified: true,
    verifiedAt: '2026-08-26',
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.2',
    port: 8788,
    guard: true,
    wired: false,
  },
  {
    id: 'ralph',
    name: 'ralph（fresh-agent 原子循环）',
    desc: 'fresh child + 不可变目标原子轮次——与自迭代智能体「原子轮次 + 防污染」天然咬合',
    packages: ['@deepseek-ai/dsh-tool-ralph', '@deepseek-ai/dsh-workflow', '@deepseek-ai/dsh-workflow-worker-thread'],
    verified: true,
    verifiedAt: '2026-08-26',
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.3',
    port: 8788,
    guard: true,
    wired: false,
  },
  {
    id: 'schedule',
    name: 'schedule（session 本地定时器）',
    desc: '无人值守定时复查/提醒（schedule_create/list/delete，session-local 投递）',
    packages: ['@deepseek-ai/dsh-schedule'],
    verified: true,
    verifiedAt: '2026-08-26',
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.4',
    port: 8788,
    guard: true,
    wired: false,
  },
  {
    id: 'feedback',
    name: 'feedback（人工反馈捕获）',
    desc: '人对单条消息打分/备注（sidecar）——自迭代人工反馈通道；headless 走网关 /api/feedback 事件写路径',
    packages: ['@deepseek-ai/dsh-command-feedback', '@deepseek-ai/dsh-message-feedback'],
    verified: true,
    verifiedAt: '2026-08-26',
    evidence: '.dsh/验证报告-DSH候选能力可达性-20260826.md §2.5',
    port: 8788,
    guard: false, // 反馈永不进模型请求，无需 guard 放行
    wired: false,
  },
  {
    id: 'commands',
    name: 'commands（阶段命令注册表）',
    desc: '把 25 个 /yxspec:* 命令经 harness 注册表路由，取代网关 includes 子串匹配',
    packages: ['@yxspec/commands', '@deepseek-ai/dsh-commands'],
    verified: true,
    verifiedAt: '2026-08-26',
    evidence: 'gateway/runtime-js/config/cordis-poc-commands.yml',
    port: 8788,
    guard: false,
    wired: false,
  },
  {
    id: 'invariants',
    name: 'invariants（跨事件不变量）',
    desc: '阶段产物落盘前上游必须 done（方向 C）——结构性保证「追溯完整」',
    packages: ['@deepseek-ai/dsh-invariants', '@yxspec/invariants'],
    verified: true,
    verifiedAt: '2026-08-26',
    evidence: 'gateway/runtime-js/config/cordis-poc-invariants.yml',
    port: 8788,
    guard: false,
    wired: false,
  },
]

/** 主入口：返回候选清单（可按 wired 过滤）。 */
export function listCapabilityCandidates({ wired = 'all' } = {}) {
  let list = CAPABILITY_CANDIDATES
  if (wired === 'wired') list = list.filter((c) => c.wired)
  if (wired === 'pending') list = list.filter((c) => !c.wired)
  return list.map((c) => ({
    id: c.id,
    name: c.name,
    desc: c.desc,
    packages: c.packages,
    verified: c.verified,
    verifiedAt: c.verifiedAt,
    evidence: c.evidence,
    port: c.port,
    guard: c.guard,
    wired: c.wired,
  }))
}
