@echo off
REM YXSpec Studio - Phase 1 MVP 验收脚本
REM 仅做静态检查，不执行真编译（npm/cargo 需要在目标环境安装）

echo ==========================================
echo YXSpec Studio Phase 1 MVP - 文件结构检查
echo ==========================================

set ROOT=%~dp0
set PASS=0
set FAIL=0

REM 检查前端文件
for %%F in (
  "src\main.tsx"
  "src\App.tsx"
  "src\components\cockpit\StageCockpit.tsx"
  "src\components\cockpit\NextCommand.tsx"
  "src\components\taskboard\TaskBoard.tsx"
  "src\components\review\ReviewCenter.tsx"
  "src\components\pipeline\PipelinePanel.tsx"
  "src\store\projectStore.ts"
  "src\store\stageStore.ts"
  "src\store\taskStore.ts"
  "src\store\reviewStore.ts"
  "src\store\pipelineStore.ts"
  "src\store\toastStore.ts"
  "src\data\types.ts"
  "src\data\stage-mapping.ts"
  "src\utils\time.ts"
  "src\utils\ipc.ts"
  "src\styles\tailwind.css"
  "index.html"
  "package.json"
  "tsconfig.json"
  "vite.config.ts"
  "tailwind.config.js"
) do (
  if exist "%ROOT%%%F" (
    echo [OK] %%F
    set /a PASS+=1
  ) else (
    echo [MISS] %%F
    set /a FAIL+=1
  )
)

REM 检查后端文件
for %%F in (
  "src-tauri\src\main.rs"
  "src-tauri\src\models\mod.rs"
  "src-tauri\src\models\stage_table.rs"
  "src-tauri\src\parser\mod.rs"
  "src-tauri\src\parser\progress.rs"
  "src-tauri\src\parser\task.rs"
  "src-tauri\src\parser\review.rs"
  "src-tauri\src\parser\pipeline.rs"
  "src-tauri\src\engine\mod.rs"
  "src-tauri\src\engine\stage_status.rs"
  "src-tauri\src\engine\task_machine.rs"
  "src-tauri\src\engine\gate_check.rs"
  "src-tauri\src\commands\mod.rs"
  "src-tauri\src\commands\project.rs"
  "src-tauri\src\commands\stage.rs"
  "src-tauri\src\commands\task.rs"
  "src-tauri\src\commands\pipeline.rs"
  "src-tauri\src\commands\review.rs"
  "src-tauri\Cargo.toml"
  "src-tauri\build.rs"
  "src-tauri\tauri.conf.json"
) do (
  if exist "%ROOT%%%F" (
    echo [OK] %%F
    set /a PASS+=1
  ) else (
    echo [MISS] %%F
    set /a FAIL+=1
  )
)

echo.
echo ==========================================
echo PASS: %PASS%, FAIL: %FAIL%
echo ==========================================

if %FAIL% GTR 0 exit /b 1
echo Phase 1 MVP 文件结构检查通过。