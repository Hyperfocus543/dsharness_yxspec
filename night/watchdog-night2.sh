#!/usr/bin/env bash
# =============================================================================
# night/watchdog-night2.sh — 崩溃自愈看门狗（守护 runner-night2）
# 用途：runner-night2 崩溃/被杀时自动重启，保证「一直跑」连崩溃都自愈。
# 逻辑：每 N 秒检查 launch-night2 的 lock 是否失效（无 lock 或 lock 里 PID 已死）
#       → 失效则用 launch-night2.sh start 重启；存活则跳过。
#       launch 的 start 子命令会清掉旧 lock 与旧 stop-flag 再 exec runner
#       （详见 launch-night2.sh：lock 里 PID = runner 自身 PID，exec 后不变），
#       因此看门狗重启天然不带上次的 stop-flag —— 只有手动 stop 才真正停。
# 用法（Windows Git Bash）：
#   前台跑：  bash night/watchdog-night2.sh
#   设间隔：  WATCHDOG_INTERVAL=60 bash night/watchdog-night2.sh
# 防双跑：看门狗建议只注册一个（计划任务只挂一次）。简单防双锁：
#         若 .watchdog.lock 里 PID 存活则直接退出（第二次手动跑会拒绝）。
# 停止 runner 的正确姿势：先 bash night/launch-night2.sh stop（写 stop-flag，
#         runner 优雅停）→ 再杀看门狗/停计划任务（否则看门狗会马上把它重启）。
# =============================================================================
set -u
ROOT="D:/Work/04_Temp/yxspec-studio-release"
NIGHT="$ROOT/night"
LAUNCH="$NIGHT/launch-night2.sh"
LOCK="$NIGHT/.night2.lock"          # launch 写的 runner lock（PID = runner 自身）
WD_LOCK="$NIGHT/.watchdog.lock"     # 本看门狗的简单防双锁
INTERVAL="${WATCHDOG_INTERVAL:-300}"  # 默认每 300s 检查一次

# ---- 简单防双跑：已有存活看门狗则退出 ----
if [ -f "$WD_LOCK" ]; then
  WD_PID=$(head -1 "$WD_LOCK" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$WD_PID" ] && [ "$WD_PID" != "$$" ] && kill -0 "$WD_PID" 2>/dev/null; then
    echo "[watchdog] 已有看门狗在跑 (PID $WD_PID)，本实例退出。如需重启先杀旧进程。"
    exit 0
  fi
fi
echo $$ > "$WD_LOCK"
# 进程退出时清理自身防双锁
trap 'rm -f "$WD_LOCK"' EXIT

echo "[watchdog] 启动（PID $$），每 ${INTERVAL}s 检查一次。runner lock: $LOCK"
echo "[watchdog] 停止 runner 的正确顺序：先 bash night/launch-night2.sh stop，再杀本看门狗。"

while :; do
  # lock 存在且进程存活 → runner 在跑，跳过
  if [ -f "$LOCK" ]; then
    PID=$(head -1 "$LOCK" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      sleep "$INTERVAL"
      continue
    fi
  fi
  # runner 不在跑（无 lock 或进程已死）→ 重启
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') runner 未在运行，调用 launch-night2.sh start 重启..."
  "$LAUNCH" start || true
  sleep "$INTERVAL"
done
