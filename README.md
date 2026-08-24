# dsharness_yxspec

YXSpec Studio — 把 yxspec（车载嵌入式 ASPICE V+ 工作流）"驾驶舱化"的桌面工具，包含执行网关 + React 前端。

## 仓库结构

```
dsharness_yxspec/
├── gateway/    # 执行网关（Node.js http，:8787）
└── studio/     # 前端（React/Vite + Tauri Rust 壳）
```

## gateway/ — 执行网关

Node.js 原生 http 网关，桥接前端与 DeepSeek Harness runtime。

- `server.mjs` — HTTP 入口（:8787）：/api/agent（派活）、/api/agent/abort、/api/models*（模型管理）、/api/events（SSE）、/api/session、/api/gates、/api/health
- `lib/` — harness.mjs（SDK 驱动 + 串行闸门）、stages.mjs（阶段/门控）、state.mjs（dsh_state.json）、bus.mjs（SSE 总线）、models.mjs（模型配置）
- `runtime-js/config/cordis.yml` — harness runtime 组合配置
- `model-config.json` — 模型目录（默认模型 + 列表）

**环境要求**：
- Node.js 18+
- DeepSeek Harness SDK（本地路径，见代码内 `RUNTIME_BIN` / `HARNESS_CWD` 常量）
- API key 经环境变量传递（`MINIMAX_CN_API_KEY` / `DEEPSEEK_API_KEY`），绝不入仓库

**启动**：
```bash
cd gateway
node server.mjs   # :8787
```

## studio/ — 前端

React/Vite + Tauri 桌面壳。对话驱动驾驶舱：流程驾驶舱、任务看板、审查中心、Pipeline 全景、模型管理。

**浏览器模式**（开发/演示）：
```bash
cd studio
npm install
npm run dev     # :1420
```

**Tauri 桌面模式**（生产）：
```bash
cd studio
npm run tauri dev
```

## 说明

- 网关内嵌了本机开发路径（`D:/AI/deepseek-harness-master` 等），在其他机器运行前需按环境调整。
- 模型 key 一律走环境变量，仓库内不含任何真实凭据。
