// 启动包装：注入 credentials 的 key + 必要的 DSH_HOME，然后起 server.mjs
// 用法：node start-gateway.mjs [port]
import { readFileSync, existsSync } from 'node:fs';
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

const port = process.argv[2] ?? '8787';
const child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env, stdio: 'inherit' });
child.on('exit', (code) => { console.log(`[start-gateway] server.mjs 退出 code=${code}`); process.exit(code ?? 1); });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
