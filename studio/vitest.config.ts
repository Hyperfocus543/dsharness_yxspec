// =============================================================================
// Vitest 测试配置（单测专用）
//
// 为什么独立一份 vitest.config.ts 而不是让 vitest 直接吃 vite.config.ts：
//   1. vite.config.ts 里的 `ssr: { noExternal: false }` 会让 vite-node 2.1.9
//      （vitest 2.x 内置）的 externalize 判定出错（`ex.test is not a function`），
//      测试连 worker 都起不来。vitest.config.ts 优先于 vite.config.ts 被加载
//      （vitest 的 configFiles 搜索顺序为 vitest.config.* → vite.config.*），
//      天然规避该问题，且不污染 Vite dev/build 配置。
//   2. 单测只测 src/utils/ipc.ts 的纯逻辑，不需要 vite.config.ts 里的
//      /yxspec/* dev-server 中间件与 Tauri/浏览器构建参数。
//
// 默认环境用 node（无需 jsdom/happy-dom）；ipc.ts 顶层的 `typeof window !==
// 'undefined'` 守卫在 node 下自动判定为非 Tauri，`import.meta.env` 由 vitest
// 提供，未设 VITE_EXEC_GATEWAY 时 GATEWAY_BASE 回退默认值。
// =============================================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
