#!/usr/bin/env bash
# =============================================================================
# night/audit-runner.sh — 全流程体检 + 修复（无人值守，用户不人工审核）
# 目标项目：D:/Work/01_Projects/Aima_X1_BCM（yxspec 流程执行侧，非 git 仓库！）
# 起因：swe_coding_verify_pc 阶段 agent 谎报完成（产物不存在、脚本语法错），
#       体检发现 27 阶段存在 CMD-MISSING(3) / NO-ARTIFACT(10) / NO-TRAJ(25)。
# 机制：
#   每轮体检 → 输出 audit-N.json → 有异常 → 起修复子代理（claude -p 无人值守）
#   → 语法自检 + 产物复查 → 仍异常 → 下一轮换方向（round2 修脚本/产物，
#   round3 汇总人工复核清单）；连续 3 轮无进展 → 停并写 SUMMARY。
#   子代理必须守红线：不碰 D:/AI/deepseek-harness-master、.dsh/vendor、
#   baselines/_monitor、dsh_state.json；Aima 非 git 仓库 → 备份后才改。
# =============================================================================
set -u
ROOT="D:/Work/04_Temp/yxspec-studio-release"
NIGHT="$ROOT/night"
PROJ="D:/Work/01_Projects/Aima_X1_BCM"
CLAUDE_BIN="/c/Users/Administrator/AppData/Roaming/npm/claude"
MAX_ROUNDS=3
MAX_MINUTES=240
MAX_CONSECUTIVE_STALL=3
START=$(date +%s)
STOP_FLAG="$NIGHT/audit-stop-flag"
SUMMARY="$NIGHT/AUDIT_SUMMARY.md"
BACKUP_ROOT="$NIGHT/audit-backups"

mkdir -p "$NIGHT/log" "$BACKUP_ROOT"
: > "$SUMMARY"
echo "# 全流程体检自动修复总结" >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo "启动: $(date '+%Y-%m-%d %H:%M:%S')  目标: $PROJ" >> "$SUMMARY"

log() {
  local msg="[$(date '+%H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$SUMMARY"
}

check_stop() {
  [ -f "$STOP_FLAG" ] && return 0
  [ $(( $(date +%s) - START )) -gt $((MAX_MINUTES * 60)) ] && return 0
  return 1
}

# ---------- 1) 体检：生成 audit-N.json ----------
audit() {
  local ROUND="$1" OUT="$NIGHT/log/audit-$ROUND.json"
  log "== 体检 第${ROUND}轮 =="
  (cd "$ROOT/gateway" && node -e "
const { STAGES, scanStageArtifacts, stageGlobHit } = await import('./lib/stages.mjs');
const { existsSync, readdirSync, readFileSync, writeFileSync } = await import('node:fs');
const { join } = await import('node:path');
const PROJ = process.env.YXSPEC_PROJECT_ROOT || 'D:/Work/01_Projects/Aima_X1_BCM';
const CMDS = 'D:/Work/01_Projects/AI培训相关/yxspec_v4_tailg_linhanfei/ai_tbox/.claude/commands/yxspec';
const TRAJ_ROOTS = [
  'D:/Work/04_Temp/yxspec-studio-release/gateway/runtime-data/trajectory',
  'D:/Work/04_Temp/yxspec-studio-release/gateway/runtime-js/runtime-data/trajectory',
];
const cmdNameOf = (cmd) => { const a = (cmd||'').replace(/^\//,''); return a.includes(':') ? a.split(':')[1] : a; };
const rows = [];
for (const [token, s] of Object.entries(STAGES)) {
  const cmdName = cmdNameOf(s.command);
  const cmdFile = existsSync(join(CMDS, cmdName + '.md'));
  let artCount = 0, globHit = false;
  try { artCount = scanStageArtifacts(s).length; } catch {}
  try { globHit = stageGlobHit(s); } catch {}
  let trajCount = 0;
  for (const T of TRAJ_ROOTS) { try { trajCount += readdirSync(join(T, token)).filter(f=>f.endsWith('.jsonl')).length; } catch {} }
  const issue = [];
  if (!cmdFile) issue.push('CMD-MISSING');
  if (!globHit && artCount === 0) issue.push('NO-ARTIFACT');
  if (trajCount === 0) issue.push('NO-TRAJ');
  rows.push({ token, aspice: s.aspice, cmd: cmdName, cmdFile, artCount, globHit, trajCount, review: s.review_gate, issues: issue });
}
const abnormal = rows.filter(r => r.issues.length > 0);
writeFileSync('$OUT', JSON.stringify({ at: Date.now(), total: rows.length, abnormalCount: abnormal.length, abnormal }, null, 2));
console.log('abnormal:', abnormal.length, '/', rows.length);
for (const r of abnormal) console.log(' ', r.token, r.issues.join('+'));
" 2>&1 | tee "$NIGHT/log/audit-$ROUND.out")
  [ -s "$OUT" ] || return 1
  return 0
}

# 体检全绿（无异常）？
audit_clean() {
  local ROUND="${1:-1}"
  python -c "
import json, sys
d = json.load(open(r'$NIGHT/log/audit-$ROUND.json'))
sys.exit(0 if d.get('abnormalCount', 0) == 0 else 1)
" 2>/dev/null
}

# ---------- 2) 修复子代理 ----------
fix_agent() {
  local ROUND="$1" OUT="$NIGHT/log/fix-r$ROUND.out"
  log "== 修复代理 第${ROUND}轮 =="
  # 先备份将被改的项目文件（Aima 非 git 仓库！）
  local BK="$BACKUP_ROOT/round$ROUND-$(date +%H%M%S)"
  mkdir -p "$BK"
  cp -r "$PROJ/.dsh/verify" "$BK/verify" 2>/dev/null
  cp -r "$PROJ/project/source" "$BK/source" 2>/dev/null
  cp -r "$PROJ/project/tests/pc_twin" "$BK/pc_twin" 2>/dev/null
  cp "$PROJ/project/tasks/coding-verify-pc" "$BK/" -r 2>/dev/null
  log "  备份 → $BK"

  (cd "$PROJ" && "$CLAUDE_BIN" -p "$(fix_prompt $ROUND)" --dangerously-skip-permissions --output-format text 2>&1 | tee "$OUT")
  return ${PIPESTATUS[0]}
}

fix_prompt() {
  local ROUND="$1"
  cat <<'EOF'
你是 yxspec 流程的全流程体检修复代理。目标项目 D:/Work/01_Projects/Aima_X1_BCM（注意：不是 git 仓库！改动前必须先做文件级备份，你不需要自己备份——runner 已备份）。

任务（第 __ROUND__ 轮，轮次决定优先级）：
- 第 1 轮：修复已确认的 verify-pc 阶段三件事：
  1. 重写 .dsh/verify/verify_pc_build.py（当前语法错误无法运行，必须跑通）：
     - 修复全部语法错误（t =.sub → re.sub、os.path( → os.path.join、缩进、正则、bus_names→bus_api_names、
       EXTERN 正则、rfindings 拼接、反斜杠 转义、line.rstrip、$(OBJSn 等）
     - 保留其语义：只读源码 + 静态检查（host 构建性/纯化/契约/孪生定义）+ 生成 pc_twin_main.c 与 Makefile
     - 改完必须跑 python -m py_compile 自检语法（失败→继续改，直到通过）
  2. 修复源码缺陷（agent 发现的，已确认存在）：
     - project/source/app_src/src/bcm_sw_bus.c：BcmBus_ConsumePwr 实现名 → BcmBus_ConsumePwrEvent（对齐 bcm_sw_bus.h 声明）
     - g_busTickMs：app_src 里损坏行 uint16_busTickMs → 恢复为 uint16_t g_busTickMs;
  3. 跑通 verify_pc_build.py，把真实报告写入 project/tasks/coding-verify-pc/c-verify-pc-report.md（含逐模块检查表）
- 第 2 轮：修复体检发现的其余 NO-ARTIFACT 阶段（swe_detail / swe_integration_verify / 下游 release 阶段按顺序），
  并检查 hwe_analysis / comp / traceability 命令文件缺失（这些命令在框架 COMMANDS_ROOT 不存在，
  若确定是命令名映射问题就在报告里说明，不要凭空造命令文件）
- 第 3 轮：对仍无法自动修复的异常，输出《人工复核清单》到 night/audit-review-list.md
  （阶段、问题、建议动作、证据路径），不强行制造产物。

铁律（红线）：
- 绝不碰 D:/AI/deepseek-harness-master、.dsh/vendor、baselines/_monitor、.dsh/dsh_state.json
- 不伪造产物：报告必须是真实执行输出；跑不通的检查在报告里明说"未执行"
- 不修改模型配置/基线版本号；不提 P02 基线
- 每次改完必须自证：py 语法 python -m py_compile；产物文件存在且非空 ls -la
- 报告（300 字内）：本轮改了哪些文件、验证结果（含 py_compile 输出）、剩余异常
EOF
}

# ---------- 3) 复查：修复代理之后产物/语法复查 ----------
recheck() {
  local ROUND="$1" OUT="$NIGHT/log/recheck-r$ROUND.out"
  log "== 复查 第${ROUND}轮 =="
  local PYOK=0 REPORTOK=0
  if python -m py_compile "$PROJ/.dsh/verify/verify_pc_build.py" 2>"$NIGHT/log/recheck-py$ROUND.err"; then PYOK=1; fi
  if [ -s "$PROJ/project/tasks/coding-verify-pc/c-verify-pc-report.md" ]; then REPORTOK=1; fi
  echo "py_compile=$PYOK report_exists=$REPORTOK" | tee "$OUT"
  # 语法坏→强制下一轮（自证要求）；报告缺→标记
  if [ "$PYOK" -eq 1 ]; then return 0; fi
  return 1
}

# ---------- 主循环 ----------
ROUND=1
STALL=0
while [ "$ROUND" -le "$MAX_ROUNDS" ]; do
  check_stop && { log "stop-flag/超时，终止"; exit 0; }

  # 体检
  if ! audit "$ROUND"; then
    log "❌ 体检脚本失败（引擎问题），停"
    exit 1
  fi

  # 体检全绿 → 收工（后续轮次由轮询触发，这里只跑一轮；加看门狗外层即可多轮）
  if [ "$ROUND" -gt 1 ] && audit_clean "$ROUND"; then
    log "✅ 体检全绿，收工"
    exit 0
  fi

  # 修复代理
  fix_agent "$ROUND"

  # 复查
  if recheck "$ROUND"; then
    log "✅ 第${ROUND}轮复查通过"
    STALL=0
  else
    STALL=$((STALL + 1))
    log "⚠️ 第${ROUND}轮复查未过（连续停摆 $STALL/$MAX_CONSECUTIVE_STALL）"
  fi

  # 再体检：异常是否减少
  if [ "$ROUND" -gt 1 ]; then
    audit "$((ROUND + 1))" >/dev/null 2>&1
    python - "$ROUND" "$NIGHT/log" <<'PYEOF' || true
import json, sys
r, logdir = sys.argv[1], sys.argv[2]
a1 = json.load(open(f'{logdir}/audit-{r}.json'))
a2 = json.load(open(f'{logdir}/audit-{int(r)+1}.json'))
print(f'异常: {a1["abnormalCount"]} → {a2["abnormalCount"]}')
PYEOF
  fi

  if [ "$STALL" -ge "$MAX_CONSECUTIVE_STALL" ]; then
    log "⚠️ 连续 ${MAX_CONSECUTIVE_STALL} 轮无进展，停；写复核清单"
    log "  建议人工看 night/audit-review-list.md（第3轮代理产出）"
    exit 2
  fi
  ROUND=$((ROUND + 1))
done

echo "---" >> "$SUMMARY"
echo "结束: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SUMMARY"
log "3 轮跑完，总结见 night/AUDIT_SUMMARY.md"
