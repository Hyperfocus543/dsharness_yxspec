#!/usr/bin/env bash
# =============================================================================
# night/runner-night2.sh — 夜间自主任务（无限轮，跑到 END_AT 为止）
# 复用 runner.sh 的 gates/guard/commit/patch 保护逻辑，改为：
#   1. 无限轮直到到点（END_AT=13:00 明天中午），每轮任务类型轮换
#   2. 穿插「新能力验证」轮：git 插件 / self-iteration / subagent 真实验证
#   3. 每轮固定：子代理改代码 → gates 全绿 → commit+push → 记录
# 防回滚：night-baseline-20260828-2049 tag + 每轮起始 commit + 失败 reset --hard
# =============================================================================
set -u
ROOT="D:/Work/04_Temp/yxspec-studio-release"
NIGHT="$ROOT/night"
CLAUDE_BIN="/c/Users/Administrator/AppData/Roaming/npm/claude"
MAX_CONSECUTIVE_FAIL=3          # 连续失败停轮（不是停整晚，换下一任务类型）
END_AT="${END_AT:-13:00}"        # 到点自动停（24h HH:MM）
START=$(date +%s)
STOP_FLAG="$NIGHT/stop-flag"
# END_AT=HH:MM（24h）→ 绝对 epoch。若目标时刻已过（如 20:53 启动、END_AT=13:00），
# 视为明天该时刻。只在启动时算一次，避免跨午夜后重新解析成"今天"而提前/推迟停。
END_EPOCH=0
if [ -n "$END_AT" ] && date -d "$END_AT" +%s >/dev/null 2>&1; then
  END_EPOCH=$(date -d "$END_AT" +%s)
  if [ "$END_EPOCH" -le "$START" ]; then
    END_EPOCH=$((END_EPOCH + 86400))
  fi
  echo "END_EPOCH=$END_EPOCH ($(date -d @$END_EPOCH '+%F %H:%M:%S'))"
fi
SUMMARY="$NIGHT/SUMMARY-night2.md"
LOG_DIR="$NIGHT/log-night2"
mkdir -p "$LOG_DIR"
: > "$SUMMARY"
echo "# 夜间自主任务总结（night2）" > "$SUMMARY"
echo "" >> "$SUMMARY"
echo "启动: $(date '+%Y-%m-%d %H:%M:%S')  到点: $END_AT" >> "$SUMMARY"
echo "基线: $(cd "$ROOT" && git rev-parse --short HEAD)（night-baseline-20260828-2049）" >> "$SUMMARY"

now() { date +%s; }
elapsed() { echo $(( $(now) - START )); }

check_stop() {
  [ -f "$STOP_FLAG" ] && return 0
  # 到点自动停：用启动时算好的绝对 END_EPOCH 做 epoch 比较（避免字典序/跨午夜坑）
  if [ "$END_EPOCH" -gt 0 ] && [ "$(date +%s)" -ge "$END_EPOCH" ]; then
    return 0
  fi
  return 1
}

log() {
  local msg="[$(date '+%H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$SUMMARY"
}

# 子代理执行（无人值守全自动，带超时保护防卡死）
run_agent() {
  local TASK="$1" ROUND="$2" PROMPT="$3" OUT="$LOG_DIR/$TASK-r$ROUND.out"
  local TIMEOUT_S="${4:-1800}"   # 默认 30 分钟；verify 传短超时
  log "  → 子代理 $TASK 第${ROUND}轮 (${OUT##*/}) 超时=${TIMEOUT_S}s"
  (cd "$ROOT" && timeout "$TIMEOUT_S" "$CLAUDE_BIN" -p "$PROMPT" \
    --dangerously-skip-permissions \
    --output-format text \
    2>&1 | tee "$OUT")
  local RC=${PIPESTATUS[0]}
  if [ "$RC" -eq 124 ]; then
    log "    ⚠️ 子代理 $TASK 超时(${TIMEOUT_S}s)被 kill，标记失败"
    return 124
  fi
  return "$RC"
}

# 提交本轮改动（gates 全绿后）
commit_and_push() {
  local TASK="$1" ROUND="$2"
  local REPORT="$LOG_DIR/$TASK-r$ROUND.out"
  local FIRST=$(grep -oE "改(了|动).{0,40}" "$REPORT" 2>/dev/null | head -1)
  local DESC="night2-${TASK}第${ROUND}轮: ${FIRST:-自动修复}"
  DESC=$(echo "$DESC" | head -c 60)
  # guard 复查：无运行时产物
  if (cd "$ROOT" && git status --short | grep -E "\.db|\.jsonl|node_modules|\.dsh/vendor|dist/|target/|icons/" >/dev/null 2>&1); then
    log "    guard 拦截：运行时产物混入，放弃本轮 commit"
    (cd "$ROOT" && git reset --hard "$TASK_START" >/dev/null 2>&1)
    return 1
  fi
  # 子代理可能已自行 commit（HEAD 已推进）——此时只 push，不二次 commit
  local HEAD_NOW=$(cd "$ROOT" && git rev-parse HEAD)
  if [ "$HEAD_NOW" != "$TASK_START" ]; then
    log "    🔀 子代理已自行 commit（$HEAD_NOW），只 push 不重复 commit"
    (cd "$ROOT" && git push origin main >/dev/null 2>&1)
    if [ $? -eq 0 ]; then
      log "    ✅ push 成功: $(cd "$ROOT" && git log -1 --format='%s' | head -c 50)"
      echo "- [$TASK 第${ROUND}轮] $(cd "$ROOT" && git log -1 --format='%s' | head -c 50)" >> "$SUMMARY"
      echo "  - commit: $(cd "$ROOT" && git rev-parse --short HEAD) @ $(date '+%H:%M')" >> "$SUMMARY"
      return 0
    else
      log "    ❌ push 失败，改动在本地 HEAD 未丢，reset 回块起始"
      (cd "$ROOT" && git reset --hard "$TASK_START" >/dev/null 2>&1)
      return 1
    fi
  fi
  (cd "$ROOT" && git add -A)
  (cd "$ROOT" && git commit -m "$DESC" >/dev/null 2>&1)
  local CR=$?
  if [ $CR -eq 0 ]; then
    (cd "$ROOT" && git push origin main >/dev/null 2>&1)
    log "    ✅ commit+push: $DESC"
    echo "- [$TASK 第${ROUND}轮] $DESC" >> "$SUMMARY"
    echo "  - commit: $(cd "$ROOT" && git rev-parse --short HEAD) @ $(date '+%H:%M')" >> "$SUMMARY"
    return 0
  else
    local PATCH="$LOG_DIR/$TASK-r$ROUND-$(date +%H%M%S).patch"
    (cd "$ROOT" && git diff HEAD > "$PATCH" 2>/dev/null)
    if [ -s "$PATCH" ]; then
      log "    ❌ commit 失败，改动已存 ${PATCH##*/}，reset 回块起始"
      echo "  - 改动存: ${PATCH##*/}（次日 git apply 接回）" >> "$SUMMARY"
    else
      log "    ❌ commit 失败（无改动可存），reset 回块起始"
      rm -f "$PATCH"
    fi
    (cd "$ROOT" && git reset --hard "$TASK_START" >/dev/null 2>&1)
    return 1
  fi
}

# ---------- 任务提示词 ----------

# fix：找问题修复
FIX_PROMPT='你是 yxspec-studio（React/Vite 前端 + Node 网关）的夜间自动修复代理，工作目录 D:/Work/04_Temp/yxspec-studio-release。任务：找出代码中的确定性问题并修复，一次一件。
优先选：
- gateway/lib/git.mjs、gateway/runtime-js/vendor/@yxspec/git-workspace/index.js、@yxspec/self-iteration/index.js 里的逻辑问题（路径解析、降级分支、边界条件）
- tool-guard 的 git 命令级守卫漏网/误伤（正则健壮性）
- tsc 未使用变量/import、类型错误、明显死代码、空 catch 吞错
- 前端 UI 质量问题：缺 aria-label/focus-visible、硬编码色值/间距应收敛到 @theme token、明显重渲染
约束：只改 gateway/ 与 studio/ 下文件，绝不碰 .dsh/vendor、baselines、harness 主仓。一次一件最小改动单 commit。改完必须 cd studio && npx tsc --noEmit 和 cd studio && npm test 全过。报告改了什么文件什么问题怎么验证（200字内）。'

# pm：产品视角优化
PM_PROMPT='你是 yxspec-studio（车载 ASPICE 驾驶舱）产品经理视角优化代理，工作目录 D:/Work/04_Temp/yxspec-studio-release。任务：找 1 处体验问题并优化，一次一件。
优先检查（结合新功能）：
- 新加的「Git 工作区管控」功能卡（GitWorkspaceCard）交互：空态/加载态/错误态/回滚确认流程
- StageCockpit 空态/加载态/错误态
- 状态条/进度展示可读性
- 组件交互（按钮 disabled、loading、空列表提示）
- 驾驶舱整体视觉一致性（zinc/emerald 配色，硬编码色值收敛 @theme，动效 CSS transition，补 aria-label/focus-visible）
约束：只改 studio/src/ 下文件，一次一件最小改动单 commit。改完 cd studio && npx tsc --noEmit + cd studio && npm test 全过。报告（200字内）。'

# feat：发散新功能
FEAT_PROMPT='你是 yxspec-studio 的创意代理，工作目录 D:/Work/04_Temp/yxspec-studio-release。任务：发散想该加什么小功能，挑 1 个高价值低风险实现。
候选方向（可发散但保持小而美，优先和 git 插件/轨迹/自迭代联动）：
- 工作区管控卡增强：脏文件 diff 预览、tag 列表展示
- 阶段留痕 timeline 增强（git tag 与轨迹融合展示）
- 成本估算角标（本周 token/费用趋势）
- 门控徽标 tooltip 详情（hover 显示门控证据）
- 自迭代打分结果展示卡（读 self-iteration 轨迹）
约束：前后端都可改，一次只做 1 个单 commit。改完 cd studio && npx tsc --noEmit + cd studio && npm test + cd studio && npm run build 全过；涉及 gateway 的 node --check。报告（200字内）。'

# verify：新能力快速回归（不 commit，只验证 + 记录）——不做真实 LLM turn（那是慢活会卡死整轮）
VERIFY_PROMPT='你是 yxspec-studio 的夜间回归验证代理，工作目录 D:/Work/04_Temp/yxspec-studio-release。任务：对新能力做快速静态回归，发现确定性 bug 直接修复（一次一件），没 bug 就记录验证结果。禁止启动网关副本、禁止跑真实 LLM turn——只做静态/轻量检查。
要验证：
1. gateway/lib/git.mjs 语法与关键逻辑：node --check 通过；getStatus() 的 recentCommits 含 message 字段（用 node -e 快速 import 断言，不启动 server）
2. @yxspec/git-workspace 插件的审计 JSONL 写入逻辑：读 runtime-js/vendor/@yxspec/git-workspace/index.js 检查 tag 打点/审计路径拼接/降级分支（静态审阅）
3. @yxspec/self-iteration 插件：读 index.js 检查 run-state 状态机推进、self_iter_score 注册、优雅降级三档（静态审阅）；检查 runtime-data/self-iteration/ 现有 run-state.json 的 schema 一致性
4. plugins.mjs 装配：getPluginMap() 应含 git-workspace/yxspec-self-iteration（node -e 快速 import 断言）
约束：只改 gateway/ 下文件，绝不碰 .dsh/vendor、baselines、harness 主仓。验证完清理临时文件。报告：每项验证结果（通过/失败+修复了什么）。'

# ---------- 主循环：无限轮直到到点 ----------
# 任务类型轮换：fix → verify → pm → feat → fix → ...
TASKS="fix verify pm feat"
ROUND_NUM=0
while true; do
  check_stop && { log "到点/stop-flag，终止全循环"; break; }
  for TASK in $TASKS; do
    ROUND_NUM=$((ROUND_NUM + 1))
    ROUND=$ROUND_NUM
    check_stop && { log "到点/stop-flag，终止全循环"; break 2; }
    case $TASK in
      fix)   PROMPT="$FIX_PROMPT" ;;
      verify) PROMPT="$VERIFY_PROMPT" ;;
      pm)    PROMPT="$PM_PROMPT" ;;
      feat)  PROMPT="$FEAT_PROMPT" ;;
    esac
    log "=== 轮次 ${ROUND_NUM}: $TASK ==="
    TASK_START=$(cd "$ROOT" && git rev-parse HEAD)
    CONSECUTIVE_FAIL=0
    ATTEMPTS=0
    while [ $ATTEMPTS -lt 3 ]; do
      ATTEMPTS=$((ATTEMPTS + 1))
      check_stop && { log "到点，终止"; break 2; }
      log "--- $TASK 第${ROUND}轮 (attempt $ATTEMPTS) ---"
      # verify 轮 10 分钟短超时（静态回归快），其余 30 分钟
      if [ "$TASK" = "verify" ]; then
        run_agent "$TASK" "$ROUND" "$PROMPT" 600
      else
        run_agent "$TASK" "$ROUND" "$PROMPT" 1800
      fi
      # verify 轮不强制 commit（子代理可能无改动），但 gates 要过
      if ! bash "$NIGHT/gates.sh"; then
        CONSECUTIVE_FAIL=$((CONSECUTIVE_FAIL + 1))
        log "  ❌ gates 失败（连续 $CONSECUTIVE_FAIL）"
        if [ $CONSECUTIVE_FAIL -ge $MAX_CONSECUTIVE_FAIL ]; then
          log "  ⚠️ $TASK 连续 ${MAX_CONSECUTIVE_FAIL} 失败，跳过此任务类型"
          (cd "$ROOT" && git reset --hard "$TASK_START" >/dev/null 2>&1)
          break
        fi
        (cd "$ROOT" && git reset --hard "$TASK_START" >/dev/null 2>&1)
        continue
      fi
      # 有改动才 commit；verify 轮子代理通常只验证不改，允许无改动
      if [ "$(cd "$ROOT" && git status --short | wc -l)" -gt 0 ]; then
        if commit_and_push "$TASK" "$ROUND"; then
          :
        else
          log "  ⚠️ commit 失败，跳过 $TASK"
        fi
      else
        log "  ✅ $TASK 轮无改动（验证通过或无需修复），跳过 commit"
      fi
      CONSECUTIVE_FAIL=0
      echo "  (checkpoint @ $(date '+%H:%M') elapsed=$(elapsed)s)" >> "$SUMMARY"
      break
    done
  done
done

echo "---" >> "$SUMMARY"
echo "结束: $(date '+%Y-%m-%d %H:%M:%S') 总耗时 $(elapsed)s" >> "$SUMMARY"
log "全部完成，总结见 night/SUMMARY-night2.md"
