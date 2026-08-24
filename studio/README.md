# YXSpec Studio

> 把 yxspec V3 流程"驾驶舱化"的桌面工具 —— 25 个阶段一图全览，任务状态实时，审查报告聚合，Pipeline 状态可视化，模型管理。

**Phase 1 MVP**：M1 流程驾驶舱（含流向视图，产物图谱已并入）/ M2 任务状态机看板（实时合并 + 派活 + 写回）/ M3 审查中心 / M4 Pipeline State 全景 / 模型管理（设置页）
**Phase 2-3**（延后实现）：M6 门控自动化 / M7 接力快照 / M8 Skills 工作台

作者：林汉飞（雅迅智联 2026 届研发新人）
搭建日期：2026-08-20
目标项目：`trainees-2026`（台铃电动车 T-BOX，ML307C cmiot 平台）

---

## 1. 两种运行模式

YXSpec Studio 故意做成 **双模式可运行**：

### 模式 A：浏览器模式（开发 / 演示用，免编译）
直接 `npm install && npm run dev`，浏览器打开即可。**只读消费** yxspec 项目文件；如需写产物，可经本地网关（`server.mjs`）派活给真实模型——写回为**受限链式调用**，仅**手动触发**（对话终端 / 一键派活），不会自动跑。**任务状态写回**（看板拖拽改状态）经 Vite 中间件 `POST /yxspec/task-status` 代理，写 `project/tasks/*.md`（标准表格文件）。

```bash
cd yxspec-studio
npm install
npm run dev
# 浏览器打开 http://localhost:1420/?project=D:/Work/.../ai_tbox
```

适用场景：
- 看一眼整体状态、不做复杂交互
- 部署到 CI 看板
- 演示、培训
- 需要时经对话终端手动派活写产物（受限链式调用）

### 模式 B：Tauri 桌面模式（生产用，全功能）
桌面壳，**可写回 task_*.md**（受受限链式调用约束）。

```bash
cd yxspec-studio
npm install
npm run tauri dev    # 开发模式
npm run tauri build  # 打包发布
```

适用场景：
- 监工日常使用
- 需要拖拽改任务状态
- 需要自动写回 started_at / finished_at / duration

---

## 2. 对话管理系统

执行终端（`LLMConsole`）基于 **chatStore 对话管理系统**运行，支持多会话与持久化：

- **多会话**：可新建 / 切换 / 重命名 / 删除会话；会话按 `updatedAt` 倒序排列。
- **持久化**：所有会话存 `localStorage["yxspec-studio.chat.<projectKey>"]`，**按项目隔离**（切项目不串会话）；刷新页面不丢，可恢复续聊。
- **会话切换**：终端左侧会话列表（`SessionList`）一键切换，当前消息上下文跟随会话。
- **派活进对话**：对话终端输入即派活（`useAgentChat` 封装网关调用）；驾驶舱/各面板的"一键派活"也写入当前会话。Agent 模式下对话会真实调用本地网关（`127.0.0.1:8787`）驱动模型，回复与诊断信息回填会话。

---

## 3. 文件结构

```
yxspec-studio/
├── src/                          # React 前端（双模式共用）
│   ├── main.tsx
│   ├── App.tsx                   # 主应用（执行终端常驻 + 功能面板）
│   ├── components/
│   │   ├── cockpit/              # M1 流程驾驶舱
│   │   │   ├── StageCockpit.tsx  # 网格/流向双视图切换
│   │   │   ├── FlowView.tsx      # 流向视图（产物图谱并入于此）
│   │   │   └── NextCommand.tsx
│   │   ├── taskboard/            # M2 任务状态机看板
│   │   │   └── TaskBoard.tsx     # 实时合并 + 派活到单任务 + 进度双口径
│   │   ├── settings/             # 设置
│   │   │   └── ModelSettings.tsx # 模型管理（默认模型 + 列表增删 + 立即应用）
│   │   ├── review/               # M3 审查中心
│   │   │   └── ReviewCenter.tsx
│   │   └── pipeline/             # M4 Pipeline State 全景
│   │       └── PipelinePanel.tsx
│   ├── store/                    # Zustand 状态（7 个 store）
│   │   ├── projectStore.ts       # 当前打开的项目
│   │   ├── stageStore.ts         # 25 阶段状态
│   │   ├── taskStore.ts          # 任务状态机（含写回 + reconcile 对账 + progressStats）
│   │   ├── reviewStore.ts        # 审查报告
│   │   ├── pipelineStore.ts      # pipeline_state.json
│   │   ├── chatStore.ts          # 对话管理（多会话 + localStorage 持久化）
│   │   ├── modelStore.ts         # 模型管理（/api/models* 网关对接）
│   │   └── toastStore.ts         # 全局提示
│   ├── components/chat/          # 会话列表
│   │   └── SessionList.tsx
│   ├── hooks/
│   │   └── useAgentChat.ts       # 对话派活（走网关 /api/agent，含模型选择）
│   ├── data/                     # 静态数据（25 阶段权威映射表）
│   │   ├── types.ts
│   │   └── stage-mapping.ts
│   ├── utils/                    # 工具函数
│   │   ├── time.ts               # 时间格式化
│   │   └── ipc.ts                # IPC 抽象层（自动检测 Tauri / 浏览器，含模型 API）
│   └── styles/
│       └── tailwind.css
├── vite.config.ts                # /yxspec/* 中间件（projects/set-project/glob/task-status/兜底）
├── vite.task-writer.ts           # 任务状态写回（Rust write_task_status TS 移植）
├── src-tauri/                    # Rust 后端（仅模式 B 用）
│   ├── src/
│   │   ├── main.rs
│   │   ├── models/
│   │   │   ├── mod.rs
│   │   │   └── stage_table.rs    # 25 阶段权威映射表（Rust 镜像）
│   │   ├── parser/
│   │   │   ├── progress.rs       # PROGRESS.md 解析
│   │   │   ├── task.rs           # task_*.md 解析（含 Markdown 表格适配）
│   │   │   ├── review.rs         # review-*.md 解析
│   │   │   └── pipeline.rs       # pipeline_state.json 解析
│   │   ├── engine/
│   │   │   ├── stage_status.rs   # 阶段状态计算（build-spec §5）
│   │   │   ├── task_machine.rs   # 任务状态机校验
│   │   │   └── gate_check.rs     # 门控检查（build-spec §7）
│   │   └── commands/             # Tauri IPC 命令
│   │       ├── project.rs
│   │       ├── stage.rs
│   │       ├── task.rs
│   │       ├── pipeline.rs
│   │       └── review.rs
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
└── index.html
```

---

## 4. 关键技术决策

### 4.1 适配真实数据格式（与 build-spec v1 描述的差异）

| 项目 | build-spec v1 描述 | 实际 trainees-2026 数据 | YXSpec Studio 实际处理 |
|---|---|---|---|
| task_*.md | YAML Front Matter + Markdown Body | **Markdown 表格** | ✅ 解析真实表格格式（前端 + Rust 双实现）|
| pipeline_state.json | 三段式 plan/do/verify + overall_status | **单一 status 字段** | ✅ 直接读 m.status，已适配 |
| review-*.md 位置 | 默认与被审产物同目录 | **同目录 + task_review_{stage}.md 双轨** | ✅ 先找 task_review_*.md，兜底找 review-{stage_token}-{spec_id}.md |
| 任务文件名 | task_<stage_token>.md 统一 | **别名**（task_sw_req.md / task_sw_arch_if.md / task_sw_ut.md）| ✅ TASK_FILE_ALIASES 处理别名 |
| 审查 token | stage_token | **swe_coding_do 例外**用 swe_coding | ✅ find_review_summary 特殊处理 |

### 4.2 双模式 IPC 抽象层

`src/utils/ipc.ts` 是核心抽象：自动检测 `window.__TAURI__` 是否存在，存在走 `invoke('xxx')`，不存在走 `fetch` + 简化解析。两套解析器（前端 + Rust）结果一致。

### 4.3 受限链式调用（核心纪律）

UI 上"建议下一步"按钮**只复制命令到剪贴板，不自动执行**。符合 yxspec 三大硬约束之一（build-spec §1.3）：
> 完成非 review 阶段后仅建议下一步；仅当存在对应 `/yxspec:review <stage>` 时，可主动连跑一次 AI 预审 + ≤3 轮偏离项自动修复。

### 4.4 任务状态机（7 状态）

| 状态 | 转换目标 |
|---|---|
| pending | ready / in_progress / skipped |
| ready | in_progress / pending / skipped |
| in_progress | done / blocked / pending |
| blocked | in_progress / pending / skipped |
| **done** | **stale**（仅能变 stale）|
| skipped | pending |
| stale | pending / in_progress |

违反转换会被 Rust 端 + 前端双重校验拒绝。

### 4.5 模型管理（设置页 + 网关 model-config）

- **默认模型**：`deepseek/deepseek-v4-flash-vision-exp`（内网 API `172.16.2.148:6060`，同 deepseek v4 flash 那套）
- **key**：`DEEPSEEK_API_KEY` 环境变量（用户级 `setx` 持久化，绝不入仓库）
- **配置真相源**：网关 `Aima_X1_BCM/.dsh/gateway/model-config.json`（默认模型 + 模型列表），经 `/api/models*` 端点读写；harness 侧 `settings.yaml` 声明 provider 路由（`llm-pi-ai.providers`，热重载）
- **切换机制**：设置页切换默认模型 → 写配置（懒生效，下次派活重建）；「⚡ 立即应用」→ `POST /api/models/apply` 显式重建 harness。SDK 握手冻结 provider/model，切换必须重建实例
- **路由声明边界**：`deepseek-v4-flash-vision-exp` 不在 pi-ai 任何 catalog，需在 settings.yaml 手动声明（含 `input: [text, image]` 模态）；视觉模态当前仅声明，图片附件能力后续
- **模型目录**（`lib/models.mjs`）：`minimax-cn/MiniMax-M3`（text）+ `deepseek/deepseek-v4-flash-vision-exp`（text+image）双种子，支持增删（不能删默认/仅剩一个）

### 4.6 任务看板写回与实时对账

- **写回**（浏览器模式）：`POST /yxspec/task-status`（Vite 中间件，注册在通用兜底之前）→ 路径白名单 `project/tasks/*.md` → `vite.task-writer.ts`（Rust `write_task_status` TS 移植）重写 status / started_at / finished_at / done / duration
- **写回边界**：仅标准 Markdown 表格（`## 任务表` / `## 任务列表`）文件支持解析/写回/状态变更；**自由文档**文件降级为只读纯文本视图（不可逐任务改状态）
- **P1 实时对账**：`taskStore.reconcileTasks(staticTasks, todos)` 按 id 匹配——命中叠加实时状态 overlay（琥珀高亮 + `agent:` badge），未匹配进网格「实时-only」卡（红色「实时」标记）；红条只显示差量说明
- **P2 派活到单任务**：卡片「🚀 派活」组装 action+verify prompt → `useAgentChat().send()` 并入中央终端
- **P3 进度双口径**：`progressStats` 按 status 计数（done/skipped/in_progress/blocked/stale），附完成列布尔对比
- **移植坑**（已踩已修）：① cells 空值过滤掉空 verify 列致列数不足；② 插入 status 列 headers 未同步位移致列错位；③ 表头/分隔行未同步改写致重复请求列漂移

---

## 5. Phase 1 MVP 验收清单

### 5.1 功能验收

- [x] 能打开 `trainees-2026` 项目
- [x] M1 流程驾驶舱正确显示 25 个阶段（按 ACQ/SYS/HWE/SWE/SQT/COMP/REL 分组）
- [x] 当前阶段（sqt_defect_feedback ✅ approved）有视觉高亮（📍）
- [x] M2 任务看板能显示 task_*.md 的所有任务
- [x] 拖拽任务状态会写回 task_*.md（模式 B **+ 浏览器模式**经 /yxspec/task-status）
- [x] 启动任务自动记 started_at
- [x] 完成任务自动算 duration（按 build-spec §1.3 规则省略高位零）
- [x] 实时 todo 与静态任务对账合并（P1 reconcile + 孤儿卡 + overlay 高亮）
- [x] 派活到单任务（P2 卡片「🚀 派活」→ 中央终端）
- [x] 进度双口径（P3 done 列 vs status）
- [x] 模型管理（设置页：默认模型切换 + 列表增删 + 立即应用）
- [x] 默认模型 deepseek-v4-flash-vision-exp，key 经 DEEPSEEK_API_KEY
- [x] M4 Pipeline 状态正确显示 N 个模块（trainees-2026 当前为 17 模块，按真实数据）
- [x] M3 审查中心聚合所有 review-*.md（approved / conditional / rejected / pending）
- [x] "建议下一步"按钮仅填充 / 复制，不自动执行

### 5.2 性能验收

- [ ] 启动时间 < 3 秒
- [ ] 25 阶段状态计算 < 1 秒
- [ ] 任务状态机更新 < 500ms
- [ ] 文件变更响应 < 2 秒（Phase 2 引入文件监听）

### 5.3 兼容性验收

- [ ] Windows 10/11 正常运行（已测试）
- [ ] 不修改 yxspec 框架文件（`.claude/`、`templates/`、`yxspec/`）
- [ ] 不影响 yxspec 流程运行

### 5.4 代码验收

- [x] TypeScript 严格模式
- [ ] Rust 无 unsafe（必要时可加注释）
- [ ] 关键算法有单元测试（Phase 2 补）
- [x] 文档齐全（README + 各模块说明）

---

## 6. 与 yxspec 框架的对接（消费清单）

> 表格为只读消费映射；**写回**仅经受限链式调用（网关派活 / Tauri 模式），不会自动改 yxspec 项目。

| 文件/目录 | M1 | M2 | M3 | M4 |
|---|---|---|---|---|
| `PROGRESS.md` | ✓（项目元信息）| | | |
| `project/tasks/task_*.md` | | ✓ | | |
| `project/tasks/task_review_*.md` | | | ✓ | |
| `project/tasks/pipeline_state.json` | | | | ✓ |
| `project/specs/<stage>/review-*.md` | ✓（兜底）| | ✓ | |
| `project/specs/<stage>/**` | ✓（产物数）| | | |

**严格只读**：`yxspec/.claude/`、`templates/`、`AGENTS.md` 等框架文件不修改。

---

## 7. Phase 2-3 路线图

| Phase | 模块 | 工作量 | 备注 |
|---|---|---|---|
| Phase 2 | M7 接力快照 | 2 天 | 一键打包 PROGRESS + pipeline_state |
| Phase 3 | M6 门控自动化 | 2 天 | Gate Check 5 项自动判定 |
| Phase 3 | M8 Skills / Agents 工作台 | 1 天 | 32 skills + 50 agents 索引 |
| Phase 4 | 智能化 + 团队协作 | 4 周 | 智能推荐 + Web 端 |

> M5 产物图谱已并入 M1 流程驾驶舱的**流向视图**（`StageCockpit` 网格 / 流向双视图，`FlowView.tsx` 实现），不再单列。

---

## 8. 关键参考

- **搭建方案**：[`../yxspec-studio-build-spec-v1.md`](../yxspec-studio-build-spec-v1.md)
- **yxspec 框架规则**：`D:\Work\01_Projects\AI培训相关\yxspec_v4_tailg_linhanfei\ai_tbox\AGENTS.md`
- **25 阶段权威映射表（人读）**：`.claude/commands/yxspec/next.md` 第 29-60 行
- **25 阶段权威映射表（机读）**：`.claude/scripts/next_decision.py:STAGE_TABLE`
- **PROGRESS 中心**：`PROGRESS.md`

---

## 9. 已知限制 / 后续补

1. **Phase 1 不引入文件监听**：手动刷新按钮（已实现）。Phase 2 引入 `notify` crate 监听 + Tauri `emit_all('file-changed')`。
2. **浏览器模式写回仅限标准表格文件**：自由文档 task 文件（如执行端指令 `task_init-rewrite-aima-bcm.md`）只读降级视图，不可逐任务改状态；写回仅对 `## 任务表` 标准表格生效。
3. **M6 / M7 / M8 留空**：Tab 暂不显示，Phase 2-3 实现（M5 产物图谱已并入驾驶舱流向视图）。
4. **没有 unit test**：Phase 2 补关键算法（compute_stage_status / write_task_status）。
5. **Pipeline 模块没有详细过滤**：Phase 2 加按模块名 / 状态过滤。

---

如有疑问，请参考 PROGRESS.md 或垂询林汉飞（linhanfei@yaxon.com）。