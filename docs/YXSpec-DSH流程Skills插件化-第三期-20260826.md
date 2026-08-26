# YXSpec × DSH 流程 Skills 插件化（第三期）

> 承接《深入优化方案-DSH结构性硬约束》第一期（guard POC + 阶段3 门控结构性化）与
> 《YXSpec-DSH深化方案-插件化第二期》（guard 全阶段 / agent preset / invariants / subagent 四方向）。
> 本期目标：**把 yxspec 最核心的「流程 skills」真正插件化**——每阶段的产物结构、质量规则、执行要求
> 从「拼进 prompt 的文本」变成「DSH 原生可按需调起的 skill 装配」。
> 日期：2026-08-26 · 状态：方案介绍（含前期适配全记录 + 本期现状诊断 + 推进计划）
> 密级：内网。不含历史基线版本标识，不引 baselines/_monitor。

---

## 零、为什么做这件事

yxspec 的流程驱动本质是 **25 个 ASPICE 阶段**，每个阶段都有专属的产物结构、质量规则、门控、追溯要求。
过去这些「流程知识」全部以 **prompt 文本**注入模型：

| 流程知识 | 过去怎么进 prompt | 问题 |
|---|---|---|
| 阶段产物模板（prd/sys-req/sw-srs…） | `readTemplate()` 读 `templates/` 注入 | **`TEMPLATES_ROOT` 指向不存在的目录 → 模板从不注入**，模型只有 1 句 brief |
| 质量规则（PRD 六维/审查检查单） | `buildFeatureSections()` 注入技能目录 | **`.dsh/skills/` 是 15 个占位/阉割 SKILL.md**（`prd-gq6` 丢 IQ 断言、`coding-rules` 是空壳 `disable-model-invocation:true`），规则实体没灌进来 |
| 编码规范（coding-specs 11 份） | `coding-rules` 特性**灰置** `available:false` | 从不进模型（skill 占位明说"应在 harness 侧挂载同源规则后启用"）|
| 执行要求/产物规范 | 所有阶段共享 1 份硬编码通用文本 | 非阶段专属，与阶段无关的指令堆给每个阶段 |

**本质**：DSH 有原生的「技能渐进披露」（`SKILL.md` 目录 → 模型 `skill({name})` 按需调起），
且 `.dsh/skills/` 的机制 + skill() 调起链路**都已实证可用**（P2 POC 验证：模型 skill() 调起 prd-gq6 成功读到六维规则）。
但部分 skill **是占位/阉割**（规则实体没灌进来），模板**从不注入**——流程知识没变成完整装配，而是半文本半空壳。

**本方案的落点**：把占位/阉割的流程 skills **灌真**（对齐框架侧 `templates/rules/` 权威源），每阶段一个完整 SKILL.md
（frontmatter 阶段绑定 + body 完整产物规范），让流程知识从「prompt 硬拼 + 空壳占位」升级为「harness 原生按需调起」。**阶段 = 一个可调起的 skill 装配**。

---

## 一、前期适配工作全景（我们已对 DSH 做了什么）

> 这份记录是「YXSpec × DSH 适配」的完整背景。三期方案逐层递进：
> 第一期把「工具裁剪 + 门控」结构性化；第二期探索四方向深化；本期把流程 skills 插件化。

### 第一期：结构性硬约束（2026-08-25，已实证）

把 yxspec 的「prompt 软约束」升级为 DSH 原生**结构性硬约束**，全部通过网关本地 cordis 插件实现，**不动 harness 主仓源码**。

| 能力 | 实现 | 实证结果 |
|---|---|---|
| 工具 guard（`ctx.tools.guard`）| 插件 `@yxspec/tool-guard`（`gateway/runtime-js/vendor/` + junction）| headless runtime 真实拦截：模型调 `write` → deny → 改用 bash |
| 阶段命令注册表 | 插件 `@yxspec/commands`（25 命令注册进 harness）| 可用；SDK 通道限制下命令识别由网关 `resolveStage` 承担 |
| 门控结构性化 | guard 里做上游链检查：上游未 done → 禁行 | 跳级派活被结构性拒绝（不只是 prompt 提示）|
| 全量审计账本 | `harness.mjs` 把 `tool/call + tool/result + turn/end` 追加写 `.dsh/gateway-log/<session>/turn-<n>.jsonl` | 每轮每工具用了什么、产出什么可离线审计（ASPICE 证据链就绪）|

**关键技术结论**（见《深入优化方案》§八/九/十）：
- 插件访问 `ctx.tools` 必须声明 `export const inject = ['tools']`，否则整个插件树加载失败（表象 `no adapter registered for provider`）。
- `ctx.tools.guard(exec => reason|undefined)`：返回字符串 = 拒绝该工具执行；`exec.name/arguments/agent` 可读；goal/todo 状态工具必须永远放行否则阶段卡死。
- guard deny 走 harness `materializeFinalResult` 生成 `isError:true` 结果反馈模型，模型收到会自主改用白名单工具。
- headless runtime 是 JSON-RPC 静默服务：调试插件加载错误靠 stderr 落盘，别盯 stdout。
- 阶段 2 收敛：SDK JSON-RPC 通道只支持 `initialize/session/prompt/shutdown`，`commands/execute` 只走 web UI wire；runtime 内命令校验放弃，落点调整为网关侧 `resolveStage`。

### 第二期：插件化四方向（2026-08-26，方向 A 完成）

用户四方向全选，从「单 agent + prompt 切换阶段」向「每阶段一个独立装配」升级。

| 方向 | 目标 | 状态 |
|---|---|---|
| **A. guard 全阶段白名单 + 门控** | 5 个 coding 阶段扩到**全 25 阶段**，每阶段专属工具白名单 + 上游门控链 | ✅ 已完成 |
| **B. 阶段 = agent preset** | 每阶段一个 preset（工具面 + prompt section + skill 目录）| ⏳ POC 探关键变量（SDK 对多 agent 的支持）|
| **C. invariants 跨事件不变量** | signoff 前置等升级为 harness 原生不变量 | ⏳ 依赖 B |
| **D. subagent 委派** | 验证/评审并行子代理 | ⏳ 依赖 B/C |

**方向 A 完成内容**（本期承接口子）：
- `STAGE_ALLOWED` 全 25 阶段白名单，按阶段大类分面：
  - 分析/需求类（PRD/SYS/SWE/SQT 需求分析、架构、策略）：`fs/read/bash + weknora_ask`（检索放行）
  - 编码/验证类：`fs/read/write/bash`（严格、不开放外部检索）
  - 测试脚本/自动化、发布/合规/追溯：相应面
- **`write` 工具修复**：编码阶段白名单此前缺 `write`，模型被迫 bash 绕道；已补（实测放行，probe 落盘）。
- `STAGE_UPSTREAM` 补齐 `swe_coding_verify_pc`（变体）、`swe_detail`（废弃），门控全链覆盖。
- 阶段动态解析：`env YXSPEC_STAGE` → `dsh_state.current` → config stage（runtime 进程复用也正确）。
- **验证**：单测 62/62（全阶段白名单放行 + web_search 全阶段 deny + write 回归 + 门控）；真实 runtime 冒烟——`swe_analysis` 模型调 `weknora_search`/`gm_record` 被工具面拦、改用白名单内 `weknora_ask`；编码阶段 `write` 放行；门控 pending 上游禁行。

### 部署形态（两期共有的工程实践）

| 项 | 做法 |
|---|---|
| 主仓红线 | 不动 harness 主仓源码 / 不动 yxspec 框架源码；插件全部经网关本地 cordis 插件包（`gateway/runtime-js/vendor/`）|
| 插件挂载 | junction（`fs.symlinkSync`）只读引用 vendor 包，不动主仓 |
| 配置覆盖 | `YXSPEC_CORDIS_CONFIG` / `GATEWAY_PORT` / `YXSPEC_PROJECT_ROOT` / `YXSPEC_WORKSPACE_CWD` / `YXSPEC_AUDIT_ROOT` env 覆盖，副本独立端口验证 |
| 副本验证纪律 | 改动前副本冒烟 → 独立端口验证 → 确认 → 切主 |
| GitHub 异地备份 | 每步 `git commit` + push `Hyperfocus543/dsharness_yxspec` |

---

## 二、本期：流程 Skills 插件化（核心方案）

### 2.1 现状诊断（本期摸清）

| 项 | 实际 | 问题 |
|---|---|---|
| `TEMPLATES_ROOT`（`paths.mjs`）| 指向 `Aima_X1_BCM/templates/`（**不存在**）| `readTemplate()` 恒 null，模板从不注入 |
| 模板权威源 | `ai_tbox/yxspec/templates/{md,rules,yaml,coding-specs}`（框架侧，都在）| 已存在但**未接线**到 Aima |
| `FEATURE_SKILL_ROOT`（`.dsh/skills/`）| **15 个占位/阉割 SKILL.md**（`prd-gq6` 丢 IQ、`coding-rules` 空壳、`sys-granularity` 已灌真）| 规则实体**部分缺失**，`skill()` 调起读到的是阉割版 |
| `coding-rules` 编码规范 | 特性 `available:false` 灰置 + skill 占位 | 编码阶段从不加载编码规范 |

**结论**：DSH 的 skill 机制（SKILL.md 目录 → 模型 `skill({name})` 按需调起）已在 agent-spine 启用、
`FEATURE_SKILL_ROOT` 扫描已铺路，**且 skill() 调起链路已实证可用**（P2 POC：模型调起 prd-gq6 成功）。
缺的是**把占位/阉割的 skill 灌真**——对齐框架侧模板/规则权威源，补齐 SKILL.md 实体。

### 2.2 混合策略（本方案的落点）

**为什么不全押渐进式披露**：即便两侧用同一套外部大模型 API，**引擎的调起 UX 成熟度也不同**——
Claude Code 引擎会把技能目录直接灌进模型上下文并附清晰调用引导，模型"顺水推舟"调起；
DSH 引擎（我们验证过）是把目录作为 prompt 一段"可用技能清单"，执行层无人值守时
依赖模型自觉 `skill()` 调起，风险比人驱动时高。所以分两类：

| 分类 | 内容 | 注入方式 |
|---|---|---|
| **小而关键**（每阶段必须）| 阶段 brief、产物结构模板、门控、产物路径、追溯要求 | **继续 prompt 注入**（结构性上下文，不能省）|
| **大而按需**（用时才要）| PRD 六维评分、审查检查单、coding-specs 编码规范（2-4KB 规则）| **进 `.dsh/skills/` 走 `skill()` 按需调起**（省上下文、聚焦）|

**两个具体动作**（P2 已完成第一个）：

1. **修 `TEMPLATES_ROOT`**：指向框架侧 `ai_tbox/yxspec/templates`（原指向不存在的目录，模板从没注入过）。✅ **已完成**（P2a）：15 个 stage 模板全部命中，`buildAgentPrompt` 实测含 PRD 模板结构。
2. **补全 `.dsh/skills/<id>/SKILL.md`**：把占位/阉割的 skill 对齐框架侧权威源灌真。✅ **P2b 已探路**：升级 `prd-gq6`（补 IQ 指引 + 读权威源），`skill()` 调起在 runtime 实证成功。

### 2.3 每阶段 SKILL.md 形态

```
.dsh/skills/<feature-id>/
└── SKILL.md
    ├── frontmatter
    │   ├── name: <feature-id>          （kebab-case，与 FEATURES 注册表一致）
    │   ├── description: <一句话>         （进模型技能目录，渐进披露用）
    │   ├── whenToUse: <阶段触发条件>     （模型判断何时调起）
    │   ├── disable-model-invocation: true|false  （开关状态同步，A+A 已铺路）
    │   └── metadata: stage-token / appliesTo
    └── body
        ├── 适用阶段（token + 命令 + ASPICE）
        ├── 上游追溯链（产物须 derived_from 引用）
        ├── 产物结构（模板或指向模板源文件）
        ├── 质量规则（评分维度 / 检查单 / 编码规范）
        └── 执行要求（并行写文件、命名规范、红线）
```

**frontmatter 的 `disable-model-invocation` 由 `features.mjs` 的 `syncFeatureSkillInvocation` 同步**——
功能开关（features.yaml）开 → 模型可 `skill()` 调起；关 → 模型目录不可见。这正是 A+A 迁移已铺的机制。

### 2.4 与 Claude Code + yxspec skills 的对比（为什么这套在执行层成立）

**重要前提**：Claude Code 那层接的**不是原生 Claude，也是外部大模型 API**（与 DSH 同一套或同级）。
所以两侧**模型能力差异很小甚至相同**——真正的差异不在模型，在**引擎**：
Claude Code 是终端交互、人驱动的开发/定义引擎；DSH 是 headless、无人值守的执行引擎 + 结构性硬约束。

两者核心机制同构：技能目录渐进披露 → 模型按需调起 → 拿完整规则执行。

| 维度 | Claude Code + yxspec skills | DSH + 流程 skills 插件化 |
|---|---|---|
| 模型 | 外部大模型 API（**非原生 Claude**）| 同一套/同级外部 API（DSH 走内网）|
| 引擎定位 | 终端交互、人驱动（开发/定义层）| headless 批量、无人值守（执行/自动化层）|
| 数据/部署 | 外部 API | 内网私有化（汽车件 NDA / ASPICE 合规）|
| 流程硬约束 | hooks 启发式（per-工具权限，无 per-阶段）| guard 管道结构性 deny（per-阶段工具面 + 门控）|
| 每阶段装配 | 无 per-阶段重建装配 | agent preset：每阶段=工具面+prompt+skills |
| 审计账本 | 会话转录 | `tool/call+result+turn/end` 全量账本 |
| 技能调起 UX | 目录灌进上下文 + 清晰调用引导，模型易顺手调起 | 目录作 prompt 一段"可用技能清单"，执行层靠模型自觉 |
| 权限 UX | 人工放行/拒绝 + 沙箱 | 静默 guard 返回字符串，无人审 |

**优缺点**：
- **Claude Code 赢**：人驱动、能盯着调起（用户自己会点技能、看结果）、权限 UX 成熟、生态成熟。
- **Claude Code 输**：终端交互难无人值守、hooks 做不到 per-阶段结构性拦截、无结构化审计账本。
- **DSH 赢**：无人值守自动化 + 结构性硬约束（guard/门控/审计）+ 内网私有化。**DSH 输**：执行层无人盯着时模型可能不主动调起技能、无权限人审、生态小。
- **定位**：不是二选一，是两层——Claude Code = 开发/定义层（写流程、调模板、验证基准，人盯着）；DSH = 执行/自动化层（批量跑 25 阶段、出审计证据，无人值守）。**模型同源，引擎各司其职。**

> 注：若两侧后续接的是**同一套** API，则「渐进式披露能不能可靠调起」的风险在两侧一致，
> 但 DSH 侧是无人值守执行，风险被放大——这正是本方案用混合策略（关键结构仍 prompt 注入）的核心理由。

### 2.5 验收标准

1. `TEMPLATES_ROOT` 指向框架侧，`readTemplate()` 真能读到 `md/*.tpl`，模板驱动注入生效。
2. `.dsh/skills/` 生成首批技能实体，`skill()` 调起在 headless runtime 真实生效（模型调起后遵守规则）。
3. 质量规则/编码规范从「prompt 全量注入」改为「按需 skill 调起」，上下文省、聚焦提升可量化。
4. 全 25 阶段回归不破坏现有产物生成；主网关 8787 不受影响（副本验证后切主）。

---

## 三、推进计划（含前期工作位置）

| 阶段 | 内容 | 对应前期适配 | 产出 |
|---|---|---|---|
| P0（已完成）| 工具 guard POC + 门控结构性化 | 第一期 §八/九/十 | guard 插件 + 副本验证 |
| P1（已完成）| guard 全 25 阶段白名单 + write 修复 | 第二期方向 A | 全阶段工具面 + 单测 62/62 + runtime 冒烟 |
| P2（已完成）| 修 `TEMPLATES_ROOT`（15 模板命中 + prompt 实测含模板）+ 升级 `prd-gq6`（补 IQ/读权威源）+ skill() 调起实证 | 本期 | 模板真注入 + skill() 调起成功 |
| P3（已完成）| 盘点 15 skill 灌真状态 + 灌真 `coding-rules`（空壳→指针，启用特征）+ 修 `sys-aq`（错引 SYS.3→SYS.2 + 补读权威源）+ 两 skill() 端到端验证 | 本期 | 去占位，指针型 skill 设计实证（模型主动读权威源全文）|
| P4（后续）| 方向 B agent preset / C invariants / D subagent | 第二期方向 B/C/D | 阶段=装配、原生不变量、并行验证 |

---

## 四、红线 & 边界（全程保持）

- 不动 harness 主仓源码 / 不动 yxspec 框架源码；全部经网关本地 cordis 插件包 + `.dsh/skills/` 实现。
- 不读 `baselines/`、`_monitor/`；不提及历史基线版本标识。
- 主 8787 在跑，改动前副本端口验证（`YXSPEC_CORDIS_CONFIG` + `GATEWAY_PORT` 已支持）。
- 每步 `git commit` + push GitHub 异地备份。
- 每步自动校验（语法 → 冒烟 → 切主），失败自愈，同一问题 3 次求助。

---

> 本方案为第三期：把流程 skills 插件化。前期两期的结构性硬约束（guard/门控/审计）是这套的地基；
> 本期把「每阶段一个可调起的 skill 装配」落地，让 yxspec 的流程驱动真正吃透 DSH 插件化。
