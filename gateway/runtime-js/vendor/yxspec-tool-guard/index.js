// =============================================================================
// @yxspec/tool-guard — YXSpec 工具守卫 + 门控结构性化（方向 A：全 25 阶段）
// =============================================================================
// 目标：把「阶段工具面」+「跳级派活禁止」从 prompt 软约束 → 结构性硬约束。
//
// 两个硬约束（guard 回调每次工具调用实时解析阶段后生效）：
//   1. 工具裁剪：每个阶段按大类专属白名单，白名单外工具调用直接 deny
//      （模型拿到失败反馈，自主改用白名单工具）。
//   2. 门控检查：当前阶段上游阶段未完成（dsh_state 里非 done）→ 结构性
//      拒绝该阶段全部工具调用（禁行），模型被迫停下，无法跳过上游。
//
// 叠加约束（git 命令级守卫，只作用于 bash 工具的命令内容）：
//   3. bash 工具命令若含破坏性 git 操作（push/reset/clean/checkout -f/rm -rf/
//      cherry-pick/rebase/merge/stash drop/remote add 等）→ deny；只读 git 命令
//      放行。与 1/2 相互独立，bash 过阶段白名单后再按命令内容判定。
//
// 当前阶段来源（实时解析，guard 回调每次调用时读取）：
//   1. 环境变量 YXSPEC_STAGE（测试/显式指定，网关可经 launch.env 注入）
//   2. dsh_state.current（动态，真实全流程每轮阶段自动变化，主推）
//   3. 插件 config stage 字段（cordis.yml，静态兜底）
//   都无 → 守卫空转（不影响非受限流程）。
//
// 红线：不动 harness 主仓源码；只读 dsh_state（门控判定）；不写 baselines/_monitor。
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';

/** 阶段 → 白名单工具。全 25 阶段，按阶段大类分面（与网关 stages.mjs 语义一致）。 */

/** subagent 委派相关全局工具名（@deepseek-ai/dsh-tool-subagent / -control 装配注册）。
 *  report 是 child-scope 工具（仅可继续子 agent 可见），不在此列表；
 *  send_message / interrupt_agent 用于后台/可继续子 agent 管理，一并放行。 */
const SUBAGENT_TOOLS = ['subagent', 'subagent_fork', 'send_message', 'interrupt_agent'];

const STAGE_ALLOWED = {
  // 分析/需求类（PRD/SYS/SWE/SQT 需求分析、架构、策略）：检索 + 状态 + 只读
  init: ['fs', 'read', 'bash'],
  sys_elicitation: ['fs', 'read', 'bash', 'weknora_ask'],
  sys_analysis: ['fs', 'read', 'bash', 'weknora_ask'],
  sys_arch: ['fs', 'read', 'bash', 'weknora_ask'],
  hwe_analysis: ['fs', 'read', 'bash', 'weknora_ask'],
  swe_analysis: ['fs', 'read', 'bash', 'weknora_ask'],
  swe_arch: ['fs', 'read', 'bash', 'weknora_ask'],
  swe_arch_if: ['fs', 'read', 'bash', 'weknora_ask'],
  swe_coding_plan: ['fs', 'read', 'bash'],
  // 编码/验证类：只读 + 写（write/fs/bash），不做外部检索
  swe_coding_do: ['fs', 'read', 'write', 'bash'],
  // 验证/评审类：放开 subagent 并行委派（并行 reviewer；子 agent 在同一阶段白名单内工作，
  // 且被 toolFilter 禁掉再委派/agent 控制，只读 review + bash 只读命令）
  swe_static_verify: ['fs', 'read', 'write', 'bash', ...SUBAGENT_TOOLS],
  swe_coding_verify: ['fs', 'read', 'write', 'bash', ...SUBAGENT_TOOLS],
  swe_coding_verify_pc: ['fs', 'read', 'write', 'bash', ...SUBAGENT_TOOLS],
  swe_unit_verify: ['fs', 'read', 'bash', ...SUBAGENT_TOOLS],
  swe_integration_verify: ['fs', 'read', 'bash', ...SUBAGENT_TOOLS],
  // 测试类
  sqt_strategy: ['fs', 'read', 'bash', 'weknora_ask'],
  sqt_tr: ['fs', 'read', 'bash', 'weknora_ask'],
  sqt_case_design: ['fs', 'read', 'bash', 'weknora_ask'],
  sqt_script_gen: ['fs', 'read', 'write', 'bash'],
  sqt_auto_test: ['fs', 'read', 'write', 'bash'],
  sqt_defect_feedback: ['fs', 'read', 'bash', 'weknora_ask'],
  // 发布/合规/追溯类
  comp: ['fs', 'read', 'bash'],
  traceability: ['fs', 'read', 'bash'],
  swe_sdk_release: ['fs', 'read', 'bash'],
  swe_release: ['fs', 'read', 'bash'],
  swe_release_promote: ['fs', 'read', 'bash'],
};

/** 通用允许工具（goal/todo 状态更新必须放行，否则阶段执行卡死）。 */
const ALWAYS_ALLOWED = ['create_goal', 'update_goal', 'get_goal', 'todo_write', 'todo_read', 'skill'];

/** 阶段 → 上游阶段（与网关 stages.mjs upstream 一致，门控判定用）。 */
const STAGE_UPSTREAM = {
  sys_elicitation: ['init'],
  sys_analysis: ['sys_elicitation'],
  sys_arch: ['sys_analysis'],
  hwe_analysis: ['sys_arch'],
  swe_analysis: ['sys_arch'],
  swe_arch: ['swe_analysis'],
  swe_arch_if: ['swe_arch'],
  swe_detail: ['swe_arch_if'], // 废弃节点，保留门控定义
  swe_coding_plan: ['swe_arch_if'],
  swe_coding_do: ['swe_coding_plan'],
  swe_static_verify: ['swe_coding_do'],
  swe_coding_verify: ['swe_static_verify'],
  swe_coding_verify_pc: ['swe_static_verify'], // 变体节点（补漏）
  swe_unit_verify: ['swe_coding_verify'],
  swe_integration_verify: ['swe_unit_verify'],
  sqt_strategy: ['swe_integration_verify'],
  sqt_tr: ['sqt_strategy'],
  sqt_case_design: ['sqt_tr'],
  sqt_script_gen: ['sqt_case_design'],
  sqt_auto_test: ['sqt_script_gen'],
  sqt_defect_feedback: ['sqt_auto_test'],
  comp: ['sqt_defect_feedback'],
  traceability: ['comp'],
  swe_sdk_release: ['traceability'],
  swe_release: ['swe_sdk_release'],
  swe_release_promote: ['swe_release'],
};

// =============================================================================
// git 命令级守卫（bash 工具命令内容判定，叠加在阶段白名单之上，二者独立生效）
// 策略：只读白名单放行；非只读 git 子命令一律拒绝（默认拒绝，宁可误伤不放过）。
// 复合命令（&& || ; | 换行）按 shell 分隔符切段逐段判定，任一段命中破坏性
// git 操作即整体拒绝。核心拦截：push / reset / clean / checkout -f /
//   checkout -- / rm -rf / cherry-pick / rebase / merge / stash drop / remote add 等。
// =============================================================================

/** 只读/安全 git 子命令（无 flag 争议，直接放行）。 */
const GIT_READONLY_SUBS = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'blame',
  'ls-files', 'ls-tree', 'describe', 'shortlog', 'whatchanged',
  'grep', 'count-objects', 'help', 'version',
]);

/** 需要带值 token 的 git 全局选项（-C/-c 双 token 形态占 2 个，`=` 连写形态占 1 个）。
 *  跳过其值 token，否则 `git -C <dir> status` 会把目录误判为子命令名。 */
const GIT_GLOBAL_VALUE_OPTS = new Set(['-C', '--git-dir', '--work-tree']);

/** 从一段 shell 命令中提取 git 子命令名（跳过 git 全局选项，如 -C/-c/--no-pager）。
 *  边界用 `(?:^|\s)…(?=\s|$)` 而非 `\b…\b`：`\b` 只要求「非词字符」前后，
 *  会误伤 `pip install git+https://…`（git 后接 `+`）与 `import git;`（git 后接
 *  `.`/`;`）这类非 git 命令。git CLI 调用必然独立成词（前导空白/段首 + 后随
 *  空白/段尾），用空白边界才不会把 URL 片段/属性访问当成本命令。
 *
 *  git 可执行名支持路径形态（防漏网）：`/usr/bin/git`、`C:\…\git.exe`、
 *  `git.cmd`/`git.bat`（Windows）以及引号包裹的完整路径都算 git 调用——
 *  此前只认裸 `git`/`git.exe`，`/usr/bin/git reset --hard` 这类全路径调用
 *  整段漏过守卫（sub=null → deny:false）。分支设计：
 *    · 引号包裹完整路径（`"C:\Program Files\Git\bin\git.exe" reset`）——引号内
 *      必须含路径分隔符 + git basename，杜绝把 `echo "git status"` 这类引号串
 *      （无分隔符）误判为调用；
 *    · 未引号形态：裸 git 可执行名（`git`/`git.exe`/`git.cmd`/`git.bat`）或带路径
 *      前缀的完整路径（`/usr/bin/git`、`C:\…\git.exe`）——路径形态必须紧邻 basename
 *      前有分隔符（`[\\/]git`），避免把 `mygit` 这类「以 git 结尾的非 git 命令」
 *      误判为调用。
 *  前边界认 段首/空白/shell 包装符（非引号）：`"git status"`（引号串非调用）不命中；
 *  但 `(git …)` / `$(git …)` / `` `git …` ``（子 shell/命令替换）紧贴包装符也是合法调用。 */
/** 解析段内 git 调用 → { sub, args }；无 git 调用 → null。
 *  sub  = 子命令名（token，非引号且不以 `-` 开头）；
 *  args = 子命令名之后到段尾的参数串（trimmed，用于 branch/tag/remote 的 flag 细分）。
 *  token 切分把引号包裹片段（含空格/反斜杠）整体当一个 token：
 *    · `git -C "C:\Program Files\p" status` —— 引号路径不拆散，-C 正确跳过一个
 *      token，status 才能被识别为子命令（按 \S+ 裸拆会把路径片段当子命令名，
 *      导致只读 status 被默认拒绝误伤）；
 *    · 子命令定位与 gitArgsAfter 同源：不再用 `\bsub\b` 全文搜索定位子命令——
 *      `git -C D:\Work\tag-scripts tag` 这类「-C 路径里含 tag/remote/branch 字样」
 *      的命令，旧写法会先匹配到路径里的子串，把路径当参数串 → 只读列出被误伤。
 *  前 8 个 token 内找不到子命令（纯 flag/全局选项）→ null。 */
function gitSubAndArgs(segment) {
  let m =
    /(?:^|\s)"([^"\r\n]+?[\\/]git(?:\.(?:exe|cmd|bat))?)"(?=\s|$)/i.exec(segment) ||
    /(?:^|\s)'([^'\r\n]+?[\\/]git(?:\.(?:exe|cmd|bat))?)'(?=\s|$)/i.exec(segment) ||
    // 前边界除 段首/空白 外，再认 shell 包装符（`(` 子 shell、`$(`/`$( )` 命令替换、
    // `{` 花括号组、`&` 后台、`` ` `` 反引号）：`(git reset --hard)` / `$(git push)`
    // / `` `git clean -fd` `` 都是真实调用，此前只认 段首/空白，这些形态整段漏过守卫。
    // 尾边界仍只认 空白/段尾（防 `import git;`、`pip install git+https://…` 误伤）。
    // 反引号：`\s` 不含它，故另开独立分支（与引号路径分支并列，尾边界保持一致）。
    /(?:^|\s)`([^`\r\n]+?[\\/]git(?:\.(?:exe|cmd|bat))?)`(?=\s|$)/i.exec(segment) ||
    // 裸 git/路径形态：前边界为 段首/空白 或 shell 包装符（`(` 子 shell/`$(…)` 命令替换、
    // `` ` `` 反引号、`{` 花括号组、`&` 后台、`;` 连排）——这些包装符后紧贴 git 词
    // 都是真实调用；尾边界仍只认 空白/段尾（防 `import git;` / `pip install git+…` 误伤）。
    /(?:^|[\s(&;`{])(?:git(?:\.(?:exe|cmd|bat))?|[^\s"'`]*[\\/]git(?:\.(?:exe|cmd|bat))?)(?=\s|$)/i.exec(segment)
  if (!m) return null
  // 子命令名后到段尾的参数串：先剥掉尾部 shell 包装闭合符（`)` 子 shell/命令替换、
  // `}` 花括号组、反引号）——`(git status)` 的 `status)`、`` `git status` `` 的
  // `status`` 若原样进 token 切分，子命令会带后缀（`status)` ∉ 只读集）→ 只读误伤。
  // 剥闭合符只删尾部包装字符，不影响参数内容判定。
  const after = segment
    .slice(m.index + m[0].length)
    .replace(/[)\]}]$/, '')
    .replace(/`$/, '')
    .trim()
  const re = /"[^"\r\n]*"|'[^'\r\n]*'|\S+/g
  const tokens = []
  let tok
  while ((tok = re.exec(after)) && tokens.length < 8) {
    tokens.push({ text: tok[0], index: tok.index })
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i].text;
    if (!t.startsWith('-')) {
      return { sub: t, args: after.slice(tokens[i].index + t.length).trim() };
    }
    if (GIT_GLOBAL_VALUE_OPTS.has(t)) i += 1; // -C <dir> 占两个 token（带 = 连写的 -C=<dir> 已被前一行判为值，不落到此处）
    if (t === '-c') i += 1; // git -c key=val 占两个 token
  }
  return null;
}

function gitSubcommandOf(segment) {
  const r = gitSubAndArgs(segment);
  return r ? r.sub : null;
}

/** 取段内子命令名之后的参数串（用于 branch/tag/remote 的 flag 细分）。 */
function gitArgsAfter(sub, segment) {
  const r = gitSubAndArgs(segment);
  return r && r.sub === sub ? r.args : '';
}

/** 判定某个 git 子命令在该段内是否破坏性（返回 true = 应拒绝）。 */
function gitSubUnsafe(sub, segment) {
  if (GIT_READONLY_SUBS.has(sub)) return false;
  if (sub === 'branch') {
    // 破坏性：-d/-D 删除、-m/-M 重命名、-c/-C 复制、-u 改 upstream、-f/--force
    // 强制覆盖、--delete/--move/--copy/--edit-description/--set-upstream。
    // 长 flag 必须完整词 + 边界 `(?:=|\s|$)`——等号连写形态（`--set-upstream-to=origin/main`、
    // `--move=foo`）与空格/结尾等价，此前只认 `(?:\s|$)`，`=` 连写漏网。
    // 完整词边界仍由该后缀保证（`--move` 后接 `-`/字母不命中，不误伤）。
    // 只读的 --list/--remotes/--all/--no-color 不进白名单 → 默认拒绝（与 tag 的
    // 「pattern 以 - 开头按不匹配」同策略：宁可误伤不放过）。
    const after = gitArgsAfter('branch', segment);
    // 短 flag 用 `(?:^|\s)-(?!-)[a-zA-Z]*[dDmMcCuuf]`：破坏性字母出现在「单连字符
    // flag 簇」任意位置即拦截（d/D 删除、m/M 重命名、c/C 复制、u 改 upstream、
    // f 强覆盖）。旧 `(?:^|-)X(?:\s|$)` 只认后跟空白/结尾，漏掉 git 支持的「短 flag
    // 值连写」形态——`-uorigin/main` ≡ `-u origin/main`（实测 git 会解析 -u 并吞掉
    // 连写值 → 改 upstream 漏网），与长 flag `--set-upstream-to=` 等号连写同源。
    //   前缀 `(?:^|\s)` + `(?!-)`：只认单连字符短 flag——长 flag 第二个 `-`（--merged
    // 的 -m、--format 的 -f）与分支名内嵌 `-`（feature-del 的 -d）前导都不是空白/行首，
    // 不落匹配，防误伤；`[a-zA-Z]*` 使簇内多 flag（-aD）与连写值（-uorigin/…）都能命中。
    return /(?:^|\s)-(?!-)[a-zA-Z]*[dDmMcCuuf]|--(?:delete|move|copy|force|edit-description|set-upstream|unset-upstream|set-upstream-to|unset-upstream-to)(?:=|\s|$)/.test(
      after,
    );
  }
  if (sub === 'tag') {
    // 只读：无参（列出）、-l/--list [pattern]（列出过滤，如 `git tag -l 'v1.*'`）。
    // pattern 是列出参数不是子命令，此前 ^(?:-l|--list)?$ 把带 pattern 的只读列出
    // 误判为拒绝（误伤）；pattern 以 - 开头的一律按不匹配处理（宁可误伤不放过，
    // 防 `-l -d`/`-l --delete` 这类 flag 混排）。其余（打标签/删标签/带 flag）拒绝。
    const after = gitArgsAfter('tag', segment);
    if (after === '' || /^-l(?:[ \t]+[^-]\S*)?$/.test(after) || /^--list(?:[ \t]+[^-]\S*)?$/.test(after)) return false;
    return true;
  }
  if (sub === 'remote') {
    // 只读：无参（列出）、-v/--verbose、show；其余（add/remove/rm/set-url/...）拒绝
    const first = (gitArgsAfter('remote', segment).split(/\s+/)[0] || '').replace(/^[\s"'`]+/, '');
    return !(first === '' || first === '-v' || first === '--verbose' || first === 'show');
  }
  return true; // 非只读白名单内的 git 子命令，默认拒绝
}

/** git 命令级守卫入口：返回中文 deny 文案；放行返回 null。 */
function gitGuardDeny(command) {
  if (typeof command !== 'string' || command.trim() === '') return null;
  const denied = [];
  for (const seg of command.split(/(?:&&|\|\||\n|;|\|)/)) {
    const sub = gitSubcommandOf(seg);
    if (sub && gitSubUnsafe(sub, seg)) denied.push(sub);
  }
  if (denied.length === 0) return null;
  return `[yxspec-tool-guard] git 命令级拦截：${denied.join('/')} 被禁止。当前工作区受 git 管控，仅允许只读命令（status/diff/log/branch/rev-parse/show/tag -l 等），禁止 push/reset/clean/checkout -f/rm -rf/cherry-pick/rebase/merge/stash drop 等破坏性操作，请改用只读命令`;
}

export const name = 'yxspec-tool-guard';

/** 导出白名单表（单测/驾驶舱诊断复用）。 */
export { STAGE_ALLOWED };
/** 导出 git 命令级守卫判定（单测/驾驶舱诊断复用）。 */
export { gitGuardDeny, gitSubcommandOf };

/** 声明对 tools 服务的依赖（cordis 注入检查）。 */
export const inject = ['tools'];

/** dsh_state.json 路径（与网关 state.mjs 同源，env 优先）。 */
function statePath() {
  const ws = process.env.YXSPEC_PROJECT_ROOT || process.env.YXSPEC_WORKSPACE_CWD || 'D:/Work/01_Projects/Aima_X1_BCM';
  return `${ws.replace(/[\\/]+$/, '')}/.dsh/dsh_state.json`;
}

/** 读 dsh_state 里各阶段状态（only done 视为满足门控）。 */
function readStageStates() {
  try {
    const p = statePath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return raw?.stages ?? raw ?? null;
  } catch {
    return null;
  }
}

/** 读 dsh_state.current（当前进行中的阶段，动态阶段来源）。 */
function readCurrentStage() {
  try {
    const p = statePath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const cur = raw?.current;
    return typeof cur === 'string' && cur.length > 0 ? cur : null;
  } catch {
    return null;
  }
}

export function apply(ctx, input = {}) {
  ctx.logger?.info?.('[yxspec-tool-guard] apply: 全阶段守卫激活');

  // 注册结构性守卫：返回字符串 = 拒绝执行；返回 undefined = 放行
  // 阶段每次调用实时解析（优先级）：
  //   1. env YXSPEC_STAGE（测试/显式指定，网关可注入）
  //   2. dsh_state.current（动态，真实全流程每轮阶段自动变化）
  //   3. config stage（静态兜底）
  // 这样 runtime 进程复用（单例 harness）也能按当前阶段正确裁剪。
  const dispose = ctx.tools.guard((exec) => {
    const name = exec?.name;
    if (!name) return undefined;
    // 状态更新工具永远放行
    if (ALWAYS_ALLOWED.includes(name)) return undefined;

    // 阶段实时解析
    const stage = process.env.YXSPEC_STAGE || readCurrentStage() || input.stage || null;
    if (!stage) return undefined;

    const allowed = STAGE_ALLOWED[stage] ?? null;
    const upstream = STAGE_UPSTREAM[stage] ?? null;
    const gated = !!upstream;

    // 门控检查：上游未完成 → 禁行该阶段全部工具（init 无上游，始终放行）
    if (gated) {
      const states = readStageStates();
      if (states) {
        const unmet = upstream.filter((u) => states[u]?.state !== 'done');
        if (unmet.length > 0) {
          return `[yxspec-tool-guard] 阶段 ${stage} 被门控拦截：上游 ${unmet.join(',')} 未完成（dsh_state 非 done）。请先完成上游阶段，禁止跳级执行`;
        }
      }
    }

    // 工具裁剪：该阶段白名单外 deny
    if (allowed && !allowed.includes(name)) {
      return `[yxspec-tool-guard] 阶段 ${stage} 仅允许 ${allowed.join('/')}，工具 ${name} 被结构性拦截`;
    }

    // git 命令级守卫：仅对 bash 工具叠加（命令级判定，不触碰其他工具/命令）。
    // 放在阶段裁剪之后，阶段白名单判定优先级不变；bash 过阶段后再查命令内容。
    if (name === 'bash' && exec.arguments?.command) {
      const deny = gitGuardDeny(String(exec.arguments.command));
      if (deny) return deny;
    }
    return undefined;
  });

  // 插件卸载时注销守卫
  ctx.effect(() => {
    ctx.logger?.info?.('[yxspec-tool-guard] 卸载');
    return dispose;
  });
}
