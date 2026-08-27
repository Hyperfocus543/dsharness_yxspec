# dsharness_yxspec

YXSpec Studio — 把 yxspec（车载嵌入式 ASPICE V+ 工作流）"驾驶舱化"的桌面工具，包含执行网关 + React 前端。

## 仓库结构

```
dsharness_yxspec/
├── gateway/    # 执行网关（Node.js http，:8787）
│   ├── server.mjs        # HTTP 入口（22 端点）
│   ├── start-gateway.mjs # 启动包装（注入凭据 env）
│   ├── lib/              # 12 个模块
│   ├── runtime-js/       # DSH runtime 装配（cordis.yml + vendor 插件）
│   ├── scripts/          # junction 重建 + 冒烟脚本
│   └── test/             # 验收脚本
└── studio/     # 前端（React/Vite + Tauri Rust 壳）
```

## gateway/ — 执行网关

Node.js 原生 http 网关，桥接前端与 DeepSeek Harness runtime。

- **server.mjs** — HTTP 入口（:8787）：`/api/agent`（派活）、`/api/agent/abort`、`/api/tasks/:id`（后台任务）、`/api/models*`（模型管理）、`/api/events`（SSE）、`/api/session`、`/api/gates`、`/api/cost`、`/api/resume`、`/api/export`（周报）、`/api/features*`（功能商店）、`/api/plugins`（插件统一开关层）、`/api/community-plugins`（社区插件）、`/api/capability-candidates`（已验证能力）
- **lib/** — 12 模块：
  - `harness.mjs` — SDK 驱动 + 串行闸门 + 超时熔断 + 合成装配
  - `stages.mjs` — 27 阶段映射 + 门控扫描 + agent prompt
  - `state.mjs` — dsh_state.json 读写 + 状态机迁移
  - `bus.mjs` — SSE 事件总线
  - `paths.mjs` — 项目路径常量（env 可覆盖）
  - `models.mjs` — 模型配置
  - `features.mjs` — 功能商店开关层
  - `cost.mjs` — 执行成本统计（审计账本聚合）
  - `community.mjs` — 社区插件市场（GitHub 缓存）
  - `installed.mjs` — 已安装插件清单（cordis.yml 解析）
  - `candidates.mjs` — 已验证待接入能力注册表
  - `plugins.mjs` — 插件统一模型（base/plugin/candidate 三层，开关即重建 runtime）
- **runtime-js/config/cordis.yml** — harness runtime 主装配；另有 13 个 POC 装配配置（`cordis-poc-*.yml`）
- **runtime-js/vendor/** — 3 个自有插件（yxspec-commands / yxspec-invariants / yxspec-tool-guard）
- **model-config.json** — 模型目录（默认模型 + 列表）

### 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `HARNESS_HOME` | ✅ | DeepSeek Harness 主仓根（默认 `D:/AI/deepseek-harness-master`） |
| `GATEWAY_PORT` | 可选 | 网关端口（默认 8787） |
| `YXSPEC_PROJECT_ROOT` | 可选 | 项目根（默认 `D:/Work/01_Projects/Aima_X1_BCM`） |
| `YXSPEC_WORKSPACE_CWD` | 可选 | runtime 工作区 cwd（默认同 PROJECT_ROOT） |
| `YXSPEC_TEMPLATES_ROOT` | 可选 | 模板权威源 |
| `YXSPEC_CORDIS_CONFIG` | 可选 | 显式装配文件（副本验证用） |
| `YXSPEC_GRAPH_MEMORY_DB` | 可选 | graph-memory db 路径 |
| `SESSION_QUERY_DB` | 可选 | session-query db 路径 |
| `MINIMAX_CN_API_KEY` / `DEEPSEEK_API_KEY` | ✅ | 模型 API key（**只走环境变量**） |

### 首次启动

```bash
cd gateway
# 1. 重建 runtime-js/node_modules 的 junction（指向 HARNESS_HOME，幂等）
powershell -File scripts/mk-all-junctions.ps1
# 2. 启动网关（start-gateway.mjs 从 ~/.dsh/.credentials.yaml 注入 key）
node start-gateway.mjs          # :8787
# 或直接起（需已设 API key env）
node server.mjs
```

## studio/ — 前端

React/Vite + Tauri 桌面壳。对话驱动驾驶舱：流程驾驶舱、任务看板、审查中心、Pipeline 全景、插件中心、功能商店、模型管理。

**浏览器模式**（开发/演示）：
```bash
cd studio
npm ci
npm run dev     # :1420
```

**Tauri 桌面模式**（生产）：
```bash
cd studio
npm run tauri dev
```

## 验证

```bash
# gateway 语法
cd gateway && node --check server.mjs && node --check lib/*.mjs
# studio 类型 + 测试 + 构建
cd studio && npx tsc --noEmit && npm test && npm run build
```

## 安全边界

- 模型 key 一律走环境变量，仓库内不含任何真实凭据（`.gitignore` 排除 `.workbuddy/`、`*.local.json`、`.env`）
- `D:/AI/deepseek-harness-master` 是只读引用（junction 指向，不修改）；`Aima_X1_BCM/.dsh/vendor/` 亦只读
- 项目 `baselines/`、`_monitor/` 不在本仓库范围

## 版本史

- `cb1721a` — v1.0：初始 gateway + 前端（8-24）
- `baseline-v2` — v2：全量同步 v2 网关（12 lib + 插件中心 + 社区插件）+ studio 新组件；硬编码路径抽 HARNESS_HOME 等 env；新增 mk-all-junctions.ps1（8-27）
