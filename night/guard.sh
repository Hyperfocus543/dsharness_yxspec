#!/usr/bin/env bash
# =============================================================================
# night/guard.sh — 安全边界守卫
# 检查 git 状态：禁改路径黑名单 + 凭据扫描 + 运行时产物
# 用法: guard.sh   返回 0 = 安全；非 0 = 违规
# =============================================================================
ROOT="D:/Work/04_Temp/yxspec-studio-release"
FAIL=0

# 1. 禁改路径黑名单（git add/commit 前检查工作树与暂存区）
BLOCKED_PATTERNS="
node_modules
\.dsh/vendor
baselines
_monitor
\.db$
\.jsonl$
dist/
src-tauri/target/
src-tauri/icons/
\.workbuddy
community-plugins
"

for pat in $BLOCKED_PATTERNS; do
  if (cd "$ROOT" && git status --short | grep -E "$pat" >/dev/null 2>&1); then
    echo "[guard] 违规: 命中黑名单 '$pat'"
    (cd "$ROOT" && git status --short | grep -E "$pat" | head -5)
    FAIL=1
  fi
done

# 2. 凭据扫描（暂存区 diff）
if (cd "$ROOT" && git diff --cached | grep -E "AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}" | grep -vE "^[+-].*(env|示例|example|dummy)" >/dev/null 2>&1); then
  echo "[guard] 违规: 疑似凭据进入暂存区"
  FAIL=1
fi

# 3. 关键版本号未改
if (cd "$ROOT" && git diff | grep -E "^[+-].*(deepseek-v4-flash-vision-exp|MiniMax-M3)" | grep -v "model-config" >/dev/null 2>&1); then
  echo "[guard] 注意: 模型默认值被改动（需人工确认）"
fi

[ $FAIL -eq 0 ] && echo "[guard] OK" || echo "[guard] VIOLATION"
exit $FAIL
