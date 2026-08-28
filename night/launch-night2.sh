#!/usr/bin/env bash
# =============================================================================
# night/launch-night2.sh — 防重复启动器（守护式）
# 用 lockfile 保证同一时刻只有一个 runner；已在跑则跳过。
# 用法: bash night/launch-night2.sh    （Git bash 环境）
#       bash night/launch-night2.sh stop （写 stop-flag 优雅停止）
# =============================================================================
set -u
ROOT="D:/Work/04_Temp/yxspec-studio-release"
NIGHT="$ROOT/night"
LOCK="$NIGHT/.night2.lock"

if [ "${1:-}" = "stop" ]; then
  echo "[launch] 写 stop-flag，runner 当前轮结束后优雅停止"
  echo stop > "$NIGHT/stop-flag"
  exit 0
fi

# 已有 runner 在跑（lock 里记录 PID 且进程存活）→ 拒绝重复启动
if [ -f "$LOCK" ]; then
  OLD_PID=$(cat "$LOCK" 2>/dev/null | tr -d ' ')
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[launch] runner 已在运行 (PID $OLD_PID)，跳过。如需重启先: bash night/launch-night2.sh stop 再杀进程"
    exit 1
  fi
  rm -f "$LOCK"
fi

# 确保旧 stop-flag 清除
rm -f "$NIGHT/stop-flag"
# 记录自己 PID 到 lock，然后 exec runner（PID 不变，lock 有效）
echo $$ > "$LOCK"
echo "[launch] 启动 runner (PID $$)  →  log: night/night2-console.log"
exec bash "$NIGHT/runner-night2.sh"
