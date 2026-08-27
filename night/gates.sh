#!/usr/bin/env bash
# =============================================================================
# night/gates.sh — 验证门禁（全绿才允许 commit）
# 用法: gates.sh [--gateway]   （--gateway 额外做网关副本冒烟）
# 返回 0 = 全绿；非 0 = 有失败
# =============================================================================
set -u
ROOT="D:/Work/04_Temp/yxspec-studio-release"
STUDIO="$ROOT/studio"
GATEWAY="$ROOT/gateway"
FAIL=0

log() { echo "[gates] $*"; }

# 1. studio 类型检查
log "tsc --noEmit ..."
if ! (cd "$STUDIO" && npx tsc --noEmit >/dev/null 2>&1); then
  log "FAIL tsc"; FAIL=1
fi

# 2. studio 单元测试
log "vitest run ..."
if ! (cd "$STUDIO" && npm test >/tmp/gates-vitest.log 2>&1); then
  log "FAIL vitest（tail）"; tail -15 /tmp/gates-vitest.log; FAIL=1
fi

# 3. studio build
log "vite build ..."
if ! (cd "$STUDIO" && npm run build >/tmp/gates-build.log 2>&1); then
  log "FAIL build（tail）"; tail -10 /tmp/gates-build.log; FAIL=1
fi

# 4. gateway 语法
log "node --check gateway ..."
for f in "$GATEWAY"/server.mjs "$GATEWAY"/lib/*.mjs; do
  if ! node --check "$f" >/dev/null 2>&1; then
    log "FAIL syntax $f"; FAIL=1
  fi
done

# 5. git diff 空白检查
if ! (cd "$ROOT" && git diff --check >/dev/null 2>&1); then
  log "FAIL git diff --check"; FAIL=1
fi

# 6. guard 扫描：无运行时产物/凭据入库
if (cd "$ROOT" && git status --short | grep -qE "\.db|\.jsonl|node_modules|\.dsh/vendor|dist/|target/|icons/|community-plugins"); then
  log "FAIL guard: 运行时产物混入"; (cd "$ROOT" && git status --short | grep -E "\.db|\.jsonl|node_modules|\.dsh/vendor|dist/|target/|icons/|community-plugins" | head); FAIL=1
fi
if (cd "$ROOT" && git diff | grep -qE "AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}"); then
  log "FAIL guard: 疑似凭据"; FAIL=1
fi

# 7. （可选）gateway 副本冒烟：8789 起一个 turn
if [ "${1:-}" = "--gateway" ]; then
  log "gateway 副本冒烟 (8789) ..."
  (cd "$GATEWAY" && HARNESS_HOME="D:/AI/deepseek-harness-master" \
    YXSPEC_WORKSPACE_CWD="$ROOT" \
    YXSPEC_CORDIS_CONFIG="file:///D:/Work/04_Temp/yxspec-studio-release/gateway/runtime-js/config/cordis.yml" \
    YXSPEC_GRAPH_MEMORY_DB="$ROOT/.dsh/graph-memory/graph-memory.db" \
    GATEWAY_PORT=8789 node server.mjs >/tmp/gates-gw.log 2>&1) &
  GWPID=$!
  sleep 4
  OK=$(curl -s -m 3 http://127.0.0.1:8789/api/plugins 2>/dev/null | grep -c '"ok": true' || true)
  if [ "$OK" -lt 1 ]; then log "FAIL gateway /api/plugins"; FAIL=1; fi
  kill $GWPID 2>/dev/null
fi

if [ "$FAIL" -eq 0 ]; then log "ALL GREEN"; else log "GATES FAILED"; fi
exit $FAIL
