# DSH 轨迹 × ASPICE 融合插件 — 设计文档

- **状态**: draft v0.1（落成即权威，子 agent 按此实现）
- **日期**: 2026-08-27
- **目标**: 基于官方 DSH session 事件溯源，融合第三方已验证插件能力，加一层 ASPICE 阶段门控小设计，实现「@yxspec/aspice-trajectory」插件模块

---

## 0. 调研结论（2026-08-27 实搜，来源见文末）

**官方层 = 事件溯源真源**：
- `@deepseek-ai/dsh-session`（`packages/core/session/`）— Session 是仅追加真源，LLM 消息历史由它派生；事件含 system prompts/推理/工具调用+结果/子代理调度/上下文注入；surface 投影供派生与压缩
- `packages/session-query/` 家族 — SQLite FTS 全文检索 + 关系查询 + 模型可调用工具 `tool-session-query`
- 官方四操作：**Resume / Fork / Search / Replay** 在同一事件流上
- 官方宣传：**"Every run is traceable"**

**第三方已验证能力（README 描述，装前需验证）**：
| 插件 | 能力 | 融合点 |
|---|---|---|
| `dsh-trajectory-debug` | 瀑布视图/确定性回放/断点/编辑重跑/fork 对比/OTel 导出 | 执行史可视化 + 审核导出 |
| `dsh_workflow` | run.json + events.jsonl + capsule 快照 + 确定性 guard + approvalMode 分级 + resume-run 断点续跑 | 过程基线双轨 + 可恢复执行 |
| `dsh-todo-guard` | 完成度三态：evidence exists→verified / fake→blocked / none→unverified | 门控证据语义 |
| `dsh-continual-harness` | harness_refine 原子提交 + rollbackId 精确回滚 + refinements.jsonl 追加记录 | 回滚协议正式化 |
| `dsh-trajectory-reader` | 每回合摘要 | 驾驶舱回合摘要 |
| `dsh-budget` | 会话/日/月预算 cap + alert/block/degrade | 成本治理（CostDashboard 数据源） |

---

## 1. 目标

在网关（`gateway/`，Node/Express + DSH SDK 通道）与前端（`studio/`，React/Vite 驾驶舱）中，实现一个**插件模块**：

> `@yxspec/aspice-trajectory`（网关侧 Cordis 插件 + 网关 API 端点 + 前端组件）

它把 DSH 的**执行轨迹**变成 ASPICE 25 阶段门控的**第一方证据**，实现"产物 + 轨迹证据双通道放行"。

---

## 2. 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│  前端 studio/ 驾驶舱                                          │
│  StageCockpit + 轨迹面板(TrajectoryPanel) + 导出               │
└──────────────┬──────────────────────────────────────────────┘
               │ fetch /api/trajectory?stage=...  /api/trajectory-gate
┌──────────────▼──────────────────────────────────────────────┐
│  网关 gateway/                                               │
│  server.mjs routes:                                          │
│    GET /api/trajectory?stage=swe_coding_do&limit=50          │
│    GET /api/trajectory-gate?stage=swe_analysis               │
│  lib/trajectory.mjs  ← 新建：事件聚合 + 门控判定 + 导出        │
│  stages.mjs resolveStage()  ← 扩展：门控升级                  │
└──────────────┬──────────────────────────────────────────────┘
               │ dsh session 事件流（append-only 真源）
┌──────────────▼──────────────────────────────────────────────┐
│  DSH harness（本地主仓 D:/AI/deepseek-harness-master）        │
│  dsh-session / session-query / tool-session-query            │
│  （官方地基，零 patch，随官方演进）                            │
└─────────────────────────────────────────────────────────────┘
```

**分层纪律**：
- 官方层**只读消费**（订阅 session/event、查 session-query），绝不改 harness 主仓
- 第三方能力**评估性吸收**（先 README 验证 → 本地 POC → 才进 vendor）
- 本插件层 = 薄胶水：聚合事件 → 门控判定 → 前端展示

---

## 3. 核心设计

### 3.1 事件聚合（trajectory.mjs 核心）

从 DSH session 事件流（`session/event`，事件类型含 `turn/start`、`turn/end`、`assistant/message`、`tool/result`、`todo/write`、`goal/change` 等）聚合出**阶段执行轨迹**：

```js
// 每条 = 一个阶段的执行记录（append-only 存 JSONL）
{
  stage: 'swe_coding_do',          // 阶段 token（权威表）
  command: '/yxspec:swe-coding-do-v2',
  status: 'passed' | 'failed' | 'unverified' | 'blocked',
  startedAt: 1730000000000,
  finishedAt: 1730000012345,
  turns: [
    { seq: 1, type: 'turn/start',  ts: 1730000000000 },
    { seq: 2, type: 'assistant/message', model: 'MiniMax-M3', tokens: 2345 },
    { seq: 3, type: 'tool/result', name: 'todo_write', ok: true },
    // ... 完整工具调用/结果对
  ],
  events: ['goal/change', 'todo/write', 'turn/end'],  // 关键事件类型索引
  cost: { tokens: 12345, estUsd: 0.05 },              // 成本（可接 dsh-budget）
  evidence: ['project/specs/sqt-tr/sqt-tr-*.md'],     // 该阶段产物 glob（复用 STAGE_TABLE）
  gate: {                                             // 门控结果
    artifact: { passed: true, files: ['...'] },       // 产物门（已有逻辑）
    trajectory: { passed: true, reason: 'evidence complete' },
    review: { passed: true, level: 'auto' },
  },
}
```

**实现要点**：
- 订阅 `session/event`（沿用已有 harness.mjs 的 SDK 通道），在阶段边界（command 命中 resolveStage）切分轨迹
- 事件**只追加**，写 `gateway/runtime-data/trajectory/<stage>-<seq>.jsonl`（gitignore 掉运行时数据）
- 阶段边界判定复用 `stages.mjs` 的权威表 + 刚修的 resolveStage（边界感知匹配）

### 3.2 门控升级（关键小设计）

现有 `review_gate: 'yes' | 'no'`（`stage-mapping.ts` / `stages.mjs`）升级为三态：

```
gate_policy: 'artifact' | 'artifact+trajectory'
```

- `artifact`（默认，兼容旧行为）：产物文件存在即过
- `artifact+trajectory`（新）：**产物存在 AND 轨迹证据完整**才放行

**轨迹证据三态**（吸收 dsh-todo-guard 语义）：
| 状态 | 判定 | 门控结果 |
|---|---|---|
| verified | 轨迹有 `tool/result ok` + 产物文件存在 | ✅ 放行 |
| unverified | 轨迹存在但缺关键证据（如无 review 报告） | ⚠️ 警告，可配降级 |
| blocked | 轨迹显示失败/反复修改/回滚 | ❌ 打回，走回滚协议 |

**门控判定伪代码**（trajectory.mjs 内）：
```js
function gateStage(stageToken, trajectory) {
  const stage = STAGES[stageToken]
  const artifact = checkArtifacts(stage.spec_globs)      // 已有
  if (stage.gate_policy !== 'artifact+trajectory') return { passed: artifact.passed }
  const traj = trajectory.at(-1)                          // 最近一次执行
  if (!traj) return { passed: false, reason: 'no-trajectory' }   // 未执行过 → unverified
  const evidenceComplete = traj.events.includes('turn/end')
    && traj.turns.some(t => t.type === 'tool/result' && t.ok)
  const evidenceStatus = evidenceComplete ? 'verified' : 'unverified'
  if (traj.status === 'failed' || traj.status === 'blocked') return { passed: false, reason: 'trajectory-' + traj.status }
  return { passed: artifact.passed && evidenceStatus !== 'blocked', status: evidenceStatus }
}
```

**阶段默认策略**（初步建议，可配置）：
- 有 `review_gate: 'yes'` 的阶段（如 `sys_analysis`/`swe_analysis`/`sqt_case_design`）→ `artifact+trajectory`（审查要证据）
- 无门控阶段（如 `swe_coding_do`/`swe_static_verify`）→ 保持 `artifact`，轨迹仅供查看

### 3.3 回滚协议（吸收 dsh-continual-harness rollbackId）

```
gate 打回 → 该阶段轨迹标记 blocked → 记 rollbackId = <stage>-<seq>
→ 网关发回滚指令（re-run 该阶段 / git reset 到块起始，沿用夜间脚本语义）
→ 回滚动作写入 trajectory JSONL 尾部（append-only 审计）
```

与夜间 `night/guard.sh` 的 `reset --hard 块起始` 语义对齐，但正式化为带 id 的治理原语。

### 3.4 导出 / 可视化（吸收 dsh-trajectory-debug）

- `GET /api/trajectory/:stage` → 前端轨迹面板（瀑布式：turn/step/tool 行 + 状态/耗时/token）
- `GET /api/trajectory/:stage/export` → OTel GenAI spans 格式（Langfuse/LangSmith 可消费）→ 审核证据
- 驾驶舱 StageCockpit 每阶段加「轨迹」标签：回合摘要（吸收 dsh-trajectory-reader）+ 瀑布图

---

## 4. 文件布局

```
gateway/
  runtime-js/vendor/@yxspec/aspice-trajectory/     ← 新增 Cordis 插件（自有插件形态）
    index.js        # 订阅 session/event，聚合轨迹，写 JSONL
    package.json    # @yxspec/aspice-trajectory v0.1.0
  lib/trajectory.mjs   ← 新增：事件聚合 + 门控判定 + 导出（被 server.mjs 引用）
  lib/stages.mjs       ← 扩展：gate_policy 字段 + resolveStage 返回轨迹索引
  server.mjs           ← 新增路由：/api/trajectory /api/trajectory-gate /api/trajectory/:stage/export
  runtime-data/trajectory/   ← 运行时轨迹 JSONL（gitignore）
studio/src/
  components/cockpit/TrajectoryPanel.tsx   ← 新增：瀑布式轨迹面板
  components/cockpit/StageCockpit.tsx      ← 扩展：加「轨迹」标签 + 门控徽标
  data/stage-mapping.ts                    ← 扩展：gate_policy 字段
```

---

## 5. 落地步骤（渐进式，子 agent 可分批）

### Phase 1：地基（本插件模块核心，必须一次做对）
1. `gateway/runtime-js/vendor/@yxspec/aspice-trajectory/` Cordis 插件：订阅 `session/event`，聚合阶段轨迹，写 JSONL
2. `gateway/lib/trajectory.mjs`：门控判定 + 导出
3. `gateway/lib/stages.mjs` + `stage-mapping.ts`：`gate_policy` 字段（默认 `artifact` 兼容）
4. `server.mjs` 路由 + 前端 TrajectoryPanel（只读展示，先不接门控）
5. **验证**：`node --check` / tsc / vitest / 一个真实 turn 的轨迹 JSONL 落盘

### Phase 2：门控接入
6. `gateway/lib/trajectory.mjs` 接 `resolveStage`：`artifact+trajectory` 阶段在派活前检查轨迹证据
7. 驾驶舱门控徽标（verified/unverified/blocked 三态展示）
8. **验证**：门控判定单测 + 打回路径冒烟

### Phase 3：回滚协议 + 导出
9. rollbackId 正式化（对齐 guard.sh 语义）
10. OTel GenAI 导出端点
11. **验证**：回滚留档 + 导出可被 Langfuse 消费（可选）

### Phase 4（可选，评估性吸收第三方）
12. 评估 `dsh_workflow`（run.json/events.jsonl/capsule）是否值得装进 vendor —— 不装则保持自有实现
13. 评估 `dsh-trajectory-debug` 瀑布图组件可否直接复用前端（其 RPC 传输是浏览器 fetch host 路由，需适配）

---

## 6. 验证门禁（沿用 night/gates.sh 语义）

每个 Phase 完成必须全绿：
```
cd studio && npx tsc --noEmit    # 0 error
cd studio && npm test            # vitest 全过
cd studio && npm run build       # 产出成功
cd gateway && node --check 各 mjs # 语法
git diff --check + guard 扫描（无 vendor/*.db/log/node_modules）
```

---

## 7. 红线

- 绝不改动 `D:/AI/deepseek-harness-master`（harness 主仓）——官方层只读消费
- 第三方插件**不直接装**进仓库：先 README 验证 → 本地 POC → 评估后才进 `vendor/`
- 运行时轨迹数据（`runtime-data/trajectory/*.jsonl`）**不入库**（.gitignore）
- 主 8787 网关不动，冒烟一律副本端口 8789
- 基线版本号（model-config.json 默认模型、package.json version）不改
- 单 commit 单主题，前缀 `feat:` / `fix:` / `refactor:`，中文描述 ≤50 字

---

## 8. 来源（2026-08-27 实搜）

- 官方: [deepseek.com/harness/en](https://deepseek.com/harness/en/)、"Every run is traceable"、append-only session log + Resume/Fork/Search/Replay
- 官方源码: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) `packages/core/session/`、`packages/session-query/`
- 第三方: [dsh-trajectory-debug](https://github.com/devmom/dsh-trajectory-debug)、[dsh_workflow](https://github.com/omdsh-dev/dsh_workflow)、[dsh-todo-guard](https://github.com/dsh-todo-guard)、[dsh-continual-harness](https://github.com/jasen215/dsh-continual-harness)、[dsh-trajectory-reader](https://github.com/dsh-trajectory-reader)、[dsh-budget](https://github.com/dsh-budget)
- 聚合榜: [awesome-dsh-plugins (dshworks)](https://github.com/dshworks/awesome-dsh-plugins)、[Oh-My-DSH](https://github.com/NoWint/Oh-My-DSH)、[awesome-deepseek-harness (0xsline)](https://github.com/0xsline/awesome-deepseek-harness)
