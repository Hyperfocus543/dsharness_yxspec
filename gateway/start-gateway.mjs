// 启动包装：注入 credentials 的 key + 必要的 DSH_HOME，然后起 server.mjs
// 用法：node start-gateway.mjs [port]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// 从 ~/.dsh/.credentials.yaml 解析 key
const credPath = 'C:/Users/Administrator/.dsh/.credentials.yaml';
let credRaw = '';
try { if (existsSync(credPath)) credRaw = readFileSync(credPath, 'utf8'); } catch {}

const env = { ...process.env, DSH_HOME: 'C:/Users/Administrator/.dsh' };
const keyMatch = (name) => credRaw.match(new RegExp(`^${name}:\s*(.+)`, 'm'))?.[1]?.trim();
const DEEPSEEK = keyMatch('DEEPSEEK_API_KEY');
const MINIMAX = keyMatch('MINIMAX_CN_API_KEY');
if (DEEPSEEK) env.DEEPSEEK_API_KEY = DEEPSEEK;
if (MINIMAX) env.MINIMAX_CN_API_KEY = MINIMAX;

// 轨迹根统一：插件（vendor junction 在仓库）与网关 DEFAULT_ROOT 各自按文件位置
// 解析会落到不同目录（插件→runtime-js/runtime-data，网关→runtime-data）。
// 显式 env 让两边写读同一处，轨迹与项目同生命周期。
const base = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
if (!env.YXSPEC_TRAJECTORY_ROOT) {
  env.YXSPEC_TRAJECTORY_ROOT = join(base, 'runtime-data', 'trajectory');
}

const port = process.argv[2] ?? '8787';
// 端口经 env 传给子进程：server.mjs 读 GATEWAY_PORT（见 server.mjs:40）。修复：副本冒烟需指定端口
if (!env.GATEWAY_PORT) env.GATEWAY_PORT = port;
const child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env, stdio: 'inherit' });
child.on('exit', (code) => { console.log(`[start-gateway] server.mjs 退出 code=${code}`); process.exit(code ?? 1); });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
