#!/usr/bin/env bash
# YXSpec Studio - Phase 1 MVP 验收脚本
# 仅做静态文件结构检查，不执行真编译

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0

check_file() {
  if [ -f "$ROOT/$1" ]; then
    echo "[OK] $1"
    PASS=$((PASS + 1))
  else
    echo "[MISS] $1"
    FAIL=$((FAIL + 1))
  fi
}

echo "=========================================="
echo "YXSpec Studio Phase 1 MVP - 文件结构检查"
echo "=========================================="
echo ""

# 前端文件
echo "[前端 React/TypeScript]"
for f in \
  "src/main.tsx" \
  "src/App.tsx" \
  "src/components/cockpit/StageCockpit.tsx" \
  "src/components/cockpit/NextCommand.tsx" \
  "src/components/taskboard/TaskBoard.tsx" \
  "src/components/review/ReviewCenter.tsx" \
  "src/components/pipeline/PipelinePanel.tsx" \
  "src/store/projectStore.ts" \
  "src/store/stageStore.ts" \
  "src/store/taskStore.ts" \
  "src/store/reviewStore.ts" \
  "src/store/pipelineStore.ts" \
  "src/store/toastStore.ts" \
  "src/data/types.ts" \
  "src/data/stage-mapping.ts" \
  "src/utils/time.ts" \
  "src/utils/ipc.ts" \
  "src/styles/tailwind.css" \
  "index.html" \
  "package.json" \
  "tsconfig.json" \
  "tsconfig.node.json" \
  "vite.config.ts" \
  "tailwind.config.js" \
  "postcss.config.js" \
  "README.md" \
  ".gitignore"; do
  check_file "$f"
done

echo ""
echo "[后端 Rust/Tauri]"
for f in \
  "src-tauri/src/main.rs" \
  "src-tauri/src/models/mod.rs" \
  "src-tauri/src/models/stage_table.rs" \
  "src-tauri/src/parser/mod.rs" \
  "src-tauri/src/parser/progress.rs" \
  "src-tauri/src/parser/task.rs" \
  "src-tauri/src/parser/review.rs" \
  "src-tauri/src/parser/pipeline.rs" \
  "src-tauri/src/engine/mod.rs" \
  "src-tauri/src/engine/stage_status.rs" \
  "src-tauri/src/engine/task_machine.rs" \
  "src-tauri/src/engine/gate_check.rs" \
  "src-tauri/src/commands/mod.rs" \
  "src-tauri/src/commands/project.rs" \
  "src-tauri/src/commands/stage.rs" \
  "src-tauri/src/commands/task.rs" \
  "src-tauri/src/commands/pipeline.rs" \
  "src-tauri/src/commands/review.rs" \
  "src-tauri/Cargo.toml" \
  "src-tauri/build.rs" \
  "src-tauri/tauri.conf.json"; do
  check_file "$f"
done

echo ""
echo "=========================================="
echo "PASS: $PASS, FAIL: $FAIL"
echo "=========================================="

# 关键行数统计
echo ""
echo "[关键文件行数]"
for f in \
  "src/data/stage-mapping.ts" \
  "src/components/cockpit/StageCockpit.tsx" \
  "src/components/taskboard/TaskBoard.tsx" \
  "src/components/review/ReviewCenter.tsx" \
  "src/components/pipeline/PipelinePanel.tsx" \
  "src-tauri/src/models/stage_table.rs" \
  "src-tauri/src/engine/stage_status.rs"; do
  if [ -f "$ROOT/$f" ]; then
    LINES=$(wc -l < "$ROOT/$f")
    printf "  %-50s %5d 行\n" "$f" "$LINES"
  fi
done

if [ $FAIL -gt 0 ]; then
  exit 1
fi
echo ""
echo "✅ Phase 1 MVP 文件结构检查通过。"