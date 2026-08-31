import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as fs from "fs";
import * as path from "path";
import { rewriteTaskStatus } from "./vite.task-writer";

// =============================================================================
// 项目管理 helper（新建/复制/删除项目共用）
// =============================================================================

// 项目根：与 /yxspec/projects 扫描同源（环境变量可覆盖）
function getProjectsRoot(): string {
  return process.env.YXSPEC_PROJECTS_ROOT || "D:/Work/01_Projects";
}

function getTemplateDir(): string {
  return path.join(getProjectsRoot(), "_Templates", "Standard_Project_Template");
}

// 项目名校验：对齐 /yxspec/projects 扫描器的跳过规则（_ / . 开头、baselines/_monitor 保留名）
// 返回错误串（不合法）或 null（合法）。
function isSafeProjectName(name: string): string | null {
  if (!name || !name.trim()) return "项目名为空";
  const n = name.trim();
  if (n.length > 120) return "项目名过长（≤120 字符）";
  if (n.includes("..")) return "项目名不能包含 ..";
  if (/[/\\:*?"<>|]/.test(n)) return "项目名不能包含 / \\ : * ? \" < > |";
  if (n.startsWith("_") || n.startsWith(".")) return "项目名不能以 _ 或 . 开头";
  if (/^(baselines?|_monitor)$/i.test(n)) return "项目名不能使用保留名 baselines/_monitor";
  return null;
}

// 防逃逸：path.resolve 折叠 ../ 后必须仍在该根下（白名单层）
function assertInsideRoot(abs: string, root: string): boolean {
  const normAbs = path.resolve(abs);
  const normRoot = path.resolve(root);
  return normAbs.startsWith(normRoot + path.sep) && normAbs !== normRoot;
}

// 从模板造骨架 → dest（3 文件 + 9 空子目录），并在 PROGRESS.md 末尾补 ## 项目元信息 占位表
// （模板 PROGRESS.md 缺此表，前端 parseProgressMeta 依赖它显示项目元信息）
function copySkeletonFromTemplate(dest: string): void {
  const tpl = getTemplateDir();
  if (!fs.existsSync(tpl)) throw new Error(`模板目录不存在: ${tpl}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ["PROGRESS.md", "_README.md", "PROJECT_LINKS.md"]) {
    const src = path.join(tpl, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, f));
  }
  for (const d of [
    "00_Admin", "01_Input", "02_Design", "03_Documents", "04_Communication",
    "05_Schedule", "06_Quality", "07_Deliverables", "99_Working",
  ]) {
    fs.mkdirSync(path.join(dest, d), { recursive: true });
  }
  const meta = [
    "",
    "## 项目元信息",
    "",
    "| 项 | 值 |",
    "|----|-----|",
    "| spec_id | 待填写 |",
    "| 产品 | 待填写 |",
    "| git 分支 | 待填写 |",
    "| 团队仓远端 | 待填写 |",
    "| 个人备份远端 | 待填写 |",
    "| 基线分支 | 待填写 |",
    "| 工期目标 | 待填写 |",
    "",
  ].join("\n");
  fs.appendFileSync(path.join(dest, "PROGRESS.md"), meta, "utf-8");
}

// 完整复制：递归逐文件复制，跳过运行时产物；.git 仅在 includeGit 时保留
const SKIP_COPY_DIRS = new Set([
  "node_modules", "dist", "target", ".next", "__pycache__", ".dsh",
]);
function copyTree(src: string, dest: string, includeGit: boolean): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === ".git" && !includeGit) continue;
    if (SKIP_COPY_DIRS.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      copyTree(s, d, includeGit);
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

// 攒 body 再统一处理（POST 端点公共模式）
function readBody(req: { on: (ev: string, cb: (chunk: any) => void) => void }): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

function sendJson(res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }, status: number, obj: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// 浏览器模式下，通过 ?project=<path> 参数代理访问 yxspec 项目文件
// 实现方式：Vite configureServer 中间件，拦截 /yxspec/* 请求，从本地文件系统读取
// 示例：http://localhost:1420/?project=D:/Work/.../ai_tbox
// 然后页面中 fetch('/yxspec/PROGRESS.md') 会被中间件拦截并返回对应文件内容

// 后缀匹配（简化 glob，仅支持 **、*、{} 展开）
function globFiles(baseDir: string, pattern: string): string[] {
  const results: string[] = [];
  const segments = pattern.replace(/\\/g, "/").split("/");
  walk(baseDir, segments, 0, "", results);
  return results;
}
function walk(
  currentDir: string,
  segments: string[],
  idx: number,
  prefix: string,
  out: string[],
): void {
  if (idx >= segments.length) {
    if (fs.existsSync(currentDir)) {
      // 找到文件
      out.push(prefix);
    }
    return;
  }
  const seg = segments[idx];
  if (!fs.existsSync(currentDir)) return;

  if (seg.includes("*")) {
    // 通配段：枚举当前目录条目
    const regexStr = seg
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "__DOUBLESTAR__")
      .replace(/\*/g, "[^/]*")
      .replace(/__DOUBLESTAR__/g, ".*");
    const re = new RegExp(`^${regexStr}$`);
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const e of entries) {
      if (re.test(e.name)) {
        walk(path.join(currentDir, e.name), segments, idx + 1, prefix ? `${prefix}/${e.name}` : e.name, out);
      }
    }
  } else {
    walk(path.join(currentDir, seg), segments, idx + 1, prefix ? `${prefix}/${seg}` : seg, out);
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "yxspec-proxy",
      configureServer(server) {
        let projectPath = "";

        // 中间件：/yxspec/projects — 扫描 01_Projects 下的项目目录，返回可用项目列表
        // 供前端"选择项目路径"下拉使用。
        server.middlewares.use("/yxspec/projects", (req, res, next) => {
          if (req.method === "GET") {
            try {
              const projectsRoot = process.env.YXSPEC_PROJECTS_ROOT || "D:/Work/01_Projects";
              const projects: { name: string; path: string; hasProgress: boolean }[] = [];

              // 递归深扫：从 root 起，最多下钻 3 层，找到含 PROGRESS.md 的项目即止。
              // yxspec 项目常嵌套在培训/客户目录下（如 AI培训相关/yxspec_v4_tailg_linhanfei/ai_tbox）。
              const seen = new Set<string>();
              const walk = (dir: string, depth: number, prefix: string) => {
                if (depth > 3) return;
                let entries;
                try {
                  entries = fs.readdirSync(dir, { withFileTypes: true });
                } catch {
                  return; // 无权限/异常目录跳过
                }
                for (const e of entries) {
                  if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith("."))
                    continue;
                  if (/^(baselines?|_monitor)$/i.test(e.name)) continue; // 保密红线
                  const full = path.join(dir, e.name);
                  if (seen.has(full)) continue;
                  seen.add(full);
                  const name = prefix ? `${prefix}/${e.name}` : e.name;
                  if (fs.existsSync(path.join(full, "PROGRESS.md"))) {
                    projects.push({ name, path: full.replace(/\\/g, "/"), hasProgress: true });
                    continue; // 已是项目根，不再下钻
                  }
                  walk(full, depth + 1, name);
                }
              };
              walk(projectsRoot, 1, "");

              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true, projects }));
            } catch (e: any) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
            }
          } else {
            next();
          }
        });

        // 中间件：/yxspec/set-project — 前端调用此端点设置 project 路径
        server.middlewares.use("/yxspec/set-project", (req, res, next) => {
          if (req.method === "POST" || req.method === "GET") {
            // 当挂载到 /yxspec/set-project 时，req.url 是 ?path=... 部分
            const queryPart = (req.url || "").split("?")[1] || "";
            const params = new URLSearchParams(queryPart);
            const p = params.get("path");
            if (p) {
              projectPath = p;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true, projectPath }));
            } else {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "Missing 'path' param" }));
            }
          } else {
            next();
          }
        });

        // 中间件：/yxspec/glob — 服务端 glob 匹配产物（M5 产物图谱用）
        // 返回 { pattern, matched: string[], count } 列表
        server.middlewares.use("/yxspec/glob", (req, res, next) => {
          if (req.method === "POST") {
            // body: { patterns: string[] }
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
              if (!projectPath) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "project not set" }));
                return;
              }
              try {
                const { patterns } = JSON.parse(body || "{}");
                const result = (patterns || []).map((pat: string) => {
                  const matches = globFiles(projectPath, pat);
                  return { pattern: pat, matched: matches, count: matches.length };
                });
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true, results: result }));
              } catch (e: any) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
              }
            });
          } else {
            next();
          }
        });
        // 中间件：/yxspec/task-status — 浏览器模式写回任务状态到 project/tasks/*.md
        // （必须在通用 /yxspec 兜底之前注册，否则被兜底吞掉）
        server.middlewares.use("/yxspec/task-status", (req, res, next) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
            return;
          }
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            if (!projectPath) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "project not set" }));
              return;
            }
            try {
              const { taskFile, taskId, newStatus, timestamp } = JSON.parse(body || "{}");
              if (!taskFile || !taskId || !newStatus) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "taskFile/taskId/newStatus required" }));
                return;
              }
              // 路径白名单：仅 project/tasks/*.md，basename 净化防穿越/越权
              const tasksRoot = path.resolve(projectPath, "project", "tasks");
              const safeName = path.basename(String(taskFile));
              const abs = path.resolve(tasksRoot, safeName);
              if (!abs.startsWith(tasksRoot) || !abs.endsWith(".md")) {
                res.statusCode = 403;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "路径越权" }));
                return;
              }
              if (!fs.existsSync(abs)) {
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: `任务文件不存在: ${safeName}` }));
                return;
              }
              const content = fs.readFileSync(abs, "utf-8");
              const updated = rewriteTaskStatus(content, String(taskId), String(newStatus), String(timestamp || ""));
              fs.writeFileSync(abs, updated, "utf-8");
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true, file: safeName, taskId, newStatus }));
            } catch (e: any) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
            }
          });
        });

        // 中间件：/yxspec/create-project — 新建项目（从模板造骨架）
        // （必须在通用 /yxspec 兜底之前注册，否则被兜底吞掉——兜底是前缀匹配）
        server.middlewares.use("/yxspec/create-project", async (req, res, next) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          try {
            const body = JSON.parse((await readBody(req)) || "{}");
            const name = String(body?.name ?? "");
            const root = getProjectsRoot();
            if (!fs.existsSync(root)) throw new Error(`项目根不存在: ${root}`);
            const nameErr = isSafeProjectName(name);
            if (nameErr) {
              sendJson(res, 400, { ok: false, error: nameErr });
              return;
            }
            const dest = path.resolve(root, name.trim());
            if (!assertInsideRoot(dest, root)) {
              sendJson(res, 403, { ok: false, error: "路径越权" });
              return;
            }
            if (fs.existsSync(dest)) {
              sendJson(res, 409, { ok: false, error: `同名项目已存在: ${name.trim()}` });
              return;
            }
            copySkeletonFromTemplate(dest);
            sendJson(res, 200, { ok: true, path: dest.replace(/\\/g, "/"), name: name.trim(), created: true });
          } catch (e: any) {
            sendJson(res, 400, { ok: false, error: String(e?.message || e) });
          }
        });

        // 中间件：/yxspec/copy-project — 复制项目（full 完整 / skeleton 仅骨架）
        server.middlewares.use("/yxspec/copy-project", async (req, res, next) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          try {
            const body = JSON.parse((await readBody(req)) || "{}");
            const source = String(body?.source ?? "");
            const name = String(body?.name ?? "");
            const scope = String(body?.scope ?? "skeleton");
            const includeGit = Boolean(body?.includeGit);
            const root = getProjectsRoot();
            if (!fs.existsSync(root)) throw new Error(`项目根不存在: ${root}`);
            if (!source) throw new Error("source 为空");
            const src = path.resolve(root, source);
            if (!assertInsideRoot(src, root)) {
              sendJson(res, 403, { ok: false, error: "源路径越权" });
              return;
            }
            const srcName = path.basename(src);
            if (srcName.startsWith("_") || srcName.startsWith(".")) {
              sendJson(res, 403, { ok: false, error: "禁止复制保留目录" });
              return;
            }
            if (!fs.existsSync(path.join(src, "PROGRESS.md"))) {
              sendJson(res, 404, { ok: false, error: `源项目不存在: ${source}` });
              return;
            }
            const nameErr = isSafeProjectName(name);
            if (nameErr) {
              sendJson(res, 400, { ok: false, error: nameErr });
              return;
            }
            const dest = path.resolve(root, name.trim());
            if (!assertInsideRoot(dest, root)) {
              sendJson(res, 403, { ok: false, error: "路径越权" });
              return;
            }
            if (fs.existsSync(dest)) {
              sendJson(res, 409, { ok: false, error: `同名项目已存在: ${name.trim()}` });
              return;
            }
            if (scope === "full") {
              copyTree(src, dest, includeGit);
            } else {
              copySkeletonFromTemplate(dest);
            }
            sendJson(res, 200, { ok: true, path: dest.replace(/\\/g, "/"), name: name.trim(), scope });
          } catch (e: any) {
            sendJson(res, 400, { ok: false, error: String(e?.message || e) });
          }
        });

        // 中间件：/yxspec/delete-project — 删除项目（includeFiles=false 只校验不写，由前端移除加载项）
        server.middlewares.use("/yxspec/delete-project", async (req, res, next) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          try {
            const body = JSON.parse((await readBody(req)) || "{}");
            const target = String(body?.target ?? "");
            const includeFiles = Boolean(body?.includeFiles);
            const root = getProjectsRoot();
            if (!fs.existsSync(root)) throw new Error(`项目根不存在: ${root}`);
            if (!target) throw new Error("target 为空");
            const abs = path.resolve(root, target);
            if (!assertInsideRoot(abs, root)) {
              sendJson(res, 403, { ok: false, error: "路径越权" });
              return;
            }
            if (abs === path.resolve(root)) {
              sendJson(res, 403, { ok: false, error: "禁止删除项目根目录" });
              return;
            }
            if (!fs.existsSync(abs)) {
              sendJson(res, 404, { ok: false, error: `目标项目不存在: ${target}` });
              return;
            }
            if (!fs.existsSync(path.join(abs, "PROGRESS.md"))) {
              sendJson(res, 400, { ok: false, error: "目标不是项目目录（无 PROGRESS.md），拒绝删除" });
              return;
            }
            if (includeFiles) {
              fs.rmSync(abs, { recursive: true, force: true });
            }
            sendJson(res, 200, { ok: true, deleted: includeFiles, path: abs.replace(/\\/g, "/") });
          } catch (e: any) {
            sendJson(res, 400, { ok: false, error: String(e?.message || e) });
          }
        });

        server.middlewares.use("/yxspec", (req, res, next) => {
          if (!projectPath) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("YXSpec Studio: 未指定 project 路径。请先调用 /yxspec/set-project?path=...");
            return;
          }

          // req.url 是 /yxspec/PROGRESS.md 的形式，去掉前导 /
          // 注意：中文字符文件名会被 URL 编码，需 decodeURIComponent 还原后再拼路径
          // （此前缺这步导致中文文件名产物读取 404）
          const rawPath = (req.url || '').replace(/^\//, '');
          const relativePath = decodeURIComponent(rawPath);
          const filePath = path.resolve(projectPath, relativePath);

          if (!fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(`File not found: ${filePath}`);
            return;
          }

          // 判断文件类型：JSON 返回 application/json，Markdown 返回 text/plain
          const ext = path.extname(filePath).toLowerCase();
          const contentType =
            ext === ".json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";

          const content = fs.readFileSync(filePath, "utf-8");
          res.setHeader("Content-Type", contentType);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(content);
        });
      },
    },
  ],
  clearScreen: false,
  server: {
    // 绑定所有网卡，使 IPv4(127.0.0.1/局域网IP) 与 IPv6(::1) 都能访问
    // 此前默认只绑了 [::1]，导致 127.0.0.1 和 172.16.31.157 访问被拒
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2020",
    minify: "esbuild",
    sourcemap: true,
    rollupOptions: {
      external: [/@tauri-apps\/api/],
    },
  },
  // 浏览器模式下，@tauri-apps/api 不会被安装，Vite 不应尝试解析它
  optimizeDeps: {
    exclude: ["@tauri-apps/api"],
  },
  ssr: {
    noExternal: false,
  },
});