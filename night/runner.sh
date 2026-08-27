#!/usr/bin/env bash
# =============================================================================
# night/runner.sh — 夜间自主任务总循环
# 顺序执行三块：fix（找问题修复）→ pm（产品视角优化）→ feat（发散新功能）
# 每块内多轮：claude -p 子代理改代码 → gates 验证 → 全绿则 commit+push → 下一轮
# 失败即停：同块连续 3 轮门禁不过停该块；三块全停写 SUMMARY 退出
# 防回滚：baseline-v2 tag + 每块起始 commit + 失败 reset --hard
# =============================================================================
set -u
ROOT="D:/Work/04_Temp/yxspec-studio-release"
NIGHT="$ROOT/night"
CLAUDE_BIN="/c/Users/Administrator/AppData/Roaming/npm/claude"
MAX_ROUNDS_PER_BLOCK=3          # 精简验证轮（确认稳定后改回 6 整晚跑）
MAX_CONSECUTIVE_FAIL=3          # 连续失败停块
MAX_TOTAL_MINUTES=360           # 总时长上限（6h）
START=$(date +%s)
STOP_FLAG="$NIGHT/stop-flag"
MANIFEST="$NIGHT/manifest.json"
SUMMARY="$NIGHT/SUMMARY.md"

mkdir -p "$NIGHT/log"
: > "$MANIFEST"
echo "# 夜间自主任务总结" > "$SUMMARY"
echo "" >> "$SUMMARY"
echo "启动: $(date '+%Y-%m-%d %H:%M:%S')" >> "$SUMMARY"

# ---------- 工具 ----------
now() { date +%s; }
elapsed() { echo $(( $(now) - START )); }

check_stop() {
  [ -f "$STOP_FLAG" ] && return 0
  [ "$(elapsed)" -gt $((MAX_TOTAL_MINUTES * 60)) ] && return 0
  return 1
}

log() {
  local msg="[$(date '+%H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$SUMMARY"
}

# 子代理提示词（每块替换 TASK 段）
# 注意：夜间无人值守用 --dangerously-skip-permissions 全自动（不弹权限批准）
run_agent() {
  local BLOCK="$1" ROUND="$2" PROMPT="$3" OUT="$NIGHT/log/$BLOCK-r$ROUND.out"
  log "  → 子代理 $BLOCK 第${ROUND}轮 (${OUT})"
  (cd "$ROOT" && "$CLAUDE_BIN" -p "$PROMPT" \
    --dangerously-skip-permissions \
    --output-format text \
    2>&1 | tee "$OUT")
  return ${PIPESTATUS[0]}
}

# 提交本轮改动（gates 全绿后）
# DESC 从子代理报告提取：报告首行通常是"改了 X"，截断到 50 字内
commit_and_push() {
  local BLOCK="$1" ROUND="$2"
  local REPORT="$NIGHT/log/$BLOCK-r$ROUND.out"
  local FIRST=$(grep -oE "改(了|动).{0,40}" "$REPORT" 2>/dev/null | head -1)
  local DESC="${PREFIX}夜间自动${BLOCK}第${ROUND}轮: ${FIRST:-自动修复}"
  DESC=$(echo "$DESC" | head -c 60)
  # guard 复查：无运行时产物
  if (cd "$ROOT" && git status --short | grep -E "\.db|\.jsonl|node_modules|\.dsh/vendor|dist/|target/|icons/" >/dev/null 2>&1); then
    log "    guard 拦截：运行时产物混入，放弃本轮 commit"
    (cd "$ROOT" && git reset --hard "$BLOCK_START" >/dev/null 2>&1)
    return 1
  fi
  (cd "$ROOT" && git add -A)
  (cd "$ROOT" && git commit -m "$DESC" >/dev/null 2>&1)
  local CR=$?
  if [ $CR -eq 0 ]; then
    (cd "$ROOT" && git push origin main >/dev/null 2>&1)
    log "    ✅ commit+push: $DESC"
    echo "- [$BLOCK 第${ROUND}轮] $DESC" >> "$SUMMARY"
    echo "  - commit: $(cd "$ROOT" && git rev-parse --short HEAD) @ $(date '+%H:%M')" >> "$SUMMARY"
    return 0
  else
    log "    ❌ commit 失败，reset 回块起始"
    (cd "$ROOT" && git reset --hard "$BLOCK_START" >/dev/null 2>&1)
    return 1
  fi
}

# ---------- 三块任务提示词 ----------
FIX_PROMPT='你是 yxspec-studio（React/Vite 前端 + Node 网关）的夜间自动修复代理，工作目录 D:/Work/04_Temp/yxspec-studio-release。任务：找出代码中的确定性问题并修复。
本轮只做 1 件自包含的小修复，优先选：
- tsc 未使用变量/import、类型错误（npx tsc --noEmit 已 0 error，找逻辑问题）
- 明显死代码/重复常量/console.log 残留
- vitest 脆弱断言
- gateway lib 死分支
- 空 catch 吞错、明显 off-by-one、错误的条件
- 前端 UI 质量问题：无 key 列表渲染、硬编码色值/间距（应收敛到 Tailwind v4 @theme token）、缺 aria-label/focus-visible、明显重渲染
约束：
- 只改 gateway/ 与 studio/ 下文件，绝不碰 .dsh/vendor、baselines、harness 主仓
- 一次一件，改动最小，单 commit 单主题
- 改完必须跑 cd studio && npx tsc --noEmit 和 cd studio && npm test，0 error 全过才算完成
- 报告：你改了哪个文件、什么问题、怎么验证的（200 字内）'

PM_PROMPT='你是 yxspec-studio（车载 ASPICE 驾驶舱，React/Vite + Tailwind v4 前端）的产品经理视角优化代理，工作目录 D:/Work/04_Temp/yxspec-studio-release。任务：从产品经理角度审视网页使用逻辑，找 1 处体验问题并优化。
优先检查：
- App.tsx 导航流/信息层级
- StageCockpit 空态/加载态/错误态
- NextCommand 建议排序/可达性
- 状态条/进度展示的可读性
- 组件交互（按钮 disabled、loading、空列表提示）
- 驾驶舱整体视觉一致性（沿用 zinc/emerald 配色，硬编码色值收敛到 @theme token；动效用 CSS transition transform/opacity 200-300ms；关键交互补 aria-label 与 focus-visible）
约束：
- 只改 studio/src/ 下文件
- 一次一件，视觉改动最小（沿用 zinc/emerald 配色），单 commit 单主题
- 改完必须 cd studio && npx tsc --noEmit + cd studio && npm test 全过
- 报告：你发现什么体验问题、怎么改的（200 字内）'

FEAT_PROMPT='你是 yxspec-studio（车载 ASPICE 驾驶舱，React/Vite 前端 + Node 网关）的创意代理，工作目录 D:/Work/04_Temp/yxspec-studio-release。任务：发散思考该加什么新功能，挑 1 个高价值低风险的小功能实现。
候选方向（可自行发散但保持小而美）：
- 网关连接状态指示条（前端探活 /api/health）
- 阶段概览导出（当前阶段/进度/产物数一键复制）
- 成本估算角标（显示本周已用 token/费用趋势）
- 会话历史「最近 5 个」快捷切换（已做，可做排序/分组增强）
- 轨迹面板增强（阶段回放/筛选/摘要）
- 门控徽标 tooltip 详情（hover 显示门控证据细节）
约束：
- 前后端都可改（gateway/ 加端点需同步前端调用）
- 一次只做 1 个功能，单 commit 单主题
- 改完必须 cd studio && npx tsc --noEmit + cd studio && npm test + cd studio && npm run build 全过
- 涉及 gateway 的必须 cd gateway && node --check server.mjs
- 报告：做了什么功能、价值、怎么验证（200 字内）'

# ---------- 主循环 ----------
for BLOCK in fix pm feat; do
  case $BLOCK in
    fix)  PROMPT="$FIX_PROMPT"; PREFIX="fix:" ;;
    pm)   PROMPT="$PM_PROMPT"; PREFIX="opt:" ;;
    feat) PROMPT="$FEAT_PROMPT"; PREFIX="feat:" ;;
  esac
  log "=== 块: $BLOCK 开始 ==="
  BLOCK_START=$(cd "$ROOT" && git rev-parse HEAD)
  CONSECUTIVE_FAIL=0
  for ROUND in $(seq 1 $MAX_ROUNDS_PER_BLOCK); do
    check_stop && { log "  stop-flag/超时，终止全循环"; exit 0; }
    log "--- $BLOCK 第${ROUND}/${MAX_ROUNDS_PER_BLOCK} 轮 ---"
    # 子代理改代码
    run_agent "$BLOCK" "$ROUND" "$PROMPT"
    # 验证门禁（feat 块做 gateway 冒烟）
    GW_FLAG=""; [ "$BLOCK" = "feat" ] && GW_FLAG="--gateway"
    if ! bash "$NIGHT/gates.sh" $GW_FLAG; then
      CONSECUTIVE_FAIL=$((CONSECUTIVE_FAIL + 1))
      log "  ❌ gates 失败（连续 $CONSECUTIVE_FAIL/$MAX_CONSECUTIVE_FAIL）"
      if [ $CONSECUTIVE_FAIL -ge $MAX_CONSECUTIVE_FAIL ]; then
        log "  ⚠️  $BLOCK 连续 ${MAX_CONSECUTIVE_FAIL} 轮失败，停块"
        (cd "$ROOT" && git reset --hard "$BLOCK_START" >/dev/null 2>&1)
        break
      fi
      # 未到上限：reset 回块起始再试
      (cd "$ROOT" && git reset --hard "$BLOCK_START" >/dev/null 2>&1)
      continue
    fi
    # 全绿：commit + push（描述从子代理报告提取）
    CONSECUTIVE_FAIL=0
    if commit_and_push "$BLOCK" "$ROUND"; then
      :
    else
      log "  ⚠️ commit 失败，停 $BLOCK"
      break
    fi
    # 每轮结束写 checkpoint
    echo "  (checkpoint @ $(date '+%H:%M') elapsed=$(elapsed)s)" >> "$SUMMARY"
    sleep 2
  done
  log "=== 块: $BLOCK 结束 ==="
done

echo "---" >> "$SUMMARY"
echo "结束: $(date '+%Y-%m-%d %H:%M:%S') 总耗时 $(elapsed)s" >> "$SUMMARY"
log "全部完成，总结见 night/SUMMARY.md"
