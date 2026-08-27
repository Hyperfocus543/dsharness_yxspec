#!/usr/bin/env pwsh
# =============================================================
# mk-all-junctions.ps1 — 重建 runtime-js/node_modules 全部 junction
# 目标路径由 $env:HARNESS_HOME 参数化（缺省本机 D:/AI/deepseek-harness-master）
# 覆盖: @deepseek-ai 45 个 + @yxspec 3 个 + graph-memory 1 个（只读指向）
# 用法: pwsh mk-all-junctions.ps1   （幂等，已存在跳过）
# =============================================================
$ErrorActionPreference = "Stop"
$HARNESS_HOME = if ($env:HARNESS_HOME) { $env:HARNESS_HOME } else { "D:/AI/deepseek-harness-master" }
$NM = Join-Path $PSScriptRoot "..\runtime-js\node_modules"
if (!(Test-Path (Join-Path $NM "@deepseek-ai"))) { New-Item -ItemType Directory -Path (Join-Path $NM "@deepseek-ai") -Force | Out-Null }
if (!(Test-Path (Join-Path $NM "@yxspec"))) { New-Item -ItemType Directory -Path (Join-Path $NM "@yxspec") -Force | Out-Null }

# ---- @deepseek-ai: packages/ 源 ----
$packagesPairs = @(
  ,@('dsh-agent-presets', 'packages/preset/agent-presets')
  ,@('dsh-anonymous-user-id', 'packages/identity/anonymous-user-id')
  ,@('dsh-command-feedback', 'packages/feedback/command-feedback')
  ,@('dsh-commands', 'packages/interaction/commands')
  ,@('dsh-invariants', 'packages/runtime-diagnostics/invariants')
  ,@('dsh-message-feedback', 'packages/feedback/message-feedback')
  ,@('dsh-schedule', 'packages/schedule/schedule')
  ,@('dsh-session-persistence', 'packages/session/session-persistence')
  ,@('dsh-session-projection', 'packages/session/session-projection')
  ,@('dsh-session-query-sqlite', 'packages/session-query/session-query-sqlite')
  ,@('dsh-storage', 'packages/storage/storage')
  ,@('dsh-storage-domain', 'packages/storage/storage-domain')
  ,@('dsh-storage-json', 'packages/storage/storage-json')
  ,@('dsh-subagent', 'packages/subagent/subagent')
  ,@('dsh-subagent-fork-in-process', 'packages/subagent/subagent-fork-in-process')
  ,@('dsh-subagent-in-process-driver', 'packages/subagent/subagent-in-process-driver')
  ,@('dsh-subagent-spawn-in-process', 'packages/subagent/subagent-spawn-in-process')
  ,@('dsh-tool-ralph', 'packages/workflow/tool-ralph')
  ,@('dsh-tool-session-query', 'packages/session-query/tool-session-query')
  ,@('dsh-tool-subagent', 'packages/subagent/tool-subagent')
  ,@('dsh-tool-subagent-control', 'packages/subagent/tool-subagent-control')
  ,@('dsh-tool-subagent-report', 'packages/subagent/tool-subagent-report')
  ,@('dsh-tool-workflow', 'packages/workflow/tool-workflow')
  ,@('dsh-typert-protocol', 'packages/typert/protocol')
  ,@('dsh-workflow', 'packages/workflow/workflow')
  ,@('dsh-workflow-worker-thread', 'packages/workflow/workflow-worker-thread')
)
foreach ($p in $packagesPairs) {
  $dst = Join-Path $NM ("@deepseek-ai\" + $p[0])
  if (Test-Path $dst) { Write-Output "SKIP(exists) @deepseek-ai/$($p[0])"; continue }
  New-Item -ItemType Junction -Path $dst -Target (Join-Path $HARNESS_HOME $p[1]) | Out-Null
  Write-Output "CREATED @deepseek-ai/$($p[0]) -> $($p[1])"
}

# ---- @deepseek-ai: examples/node_modules 源 ----
$examplesPairs = @(
  ,@('dsh-agent-spine-demo', 'examples/node_modules/@deepseek-ai/dsh-agent-spine-demo')
  ,@('dsh-bash-local', 'examples/node_modules/@deepseek-ai/dsh-bash-local')
  ,@('dsh-compaction-basic', 'examples/node_modules/@deepseek-ai/dsh-compaction-basic')
  ,@('dsh-credentials-local', 'examples/node_modules/@deepseek-ai/dsh-credentials-local')
  ,@('dsh-fs-local', 'examples/node_modules/@deepseek-ai/dsh-fs-local')
  ,@('dsh-fs-observation-policy', 'examples/node_modules/@deepseek-ai/dsh-fs-observation-policy')
  ,@('dsh-llm-pi-ai', 'examples/node_modules/@deepseek-ai/dsh-llm-pi-ai')
  ,@('dsh-sdk-jsonrpc-server', 'examples/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server')
  ,@('dsh-session-checkpoint-policy', 'examples/node_modules/@deepseek-ai/dsh-session-checkpoint-policy')
  ,@('dsh-session-persistence-jsonl', 'examples/node_modules/@deepseek-ai/dsh-session-persistence-jsonl')
  ,@('dsh-settings-file', 'examples/node_modules/@deepseek-ai/dsh-settings-file')
  ,@('dsh-skill', 'examples/node_modules/@deepseek-ai/dsh-skill')
  ,@('dsh-skill-filesystem', 'examples/node_modules/@deepseek-ai/dsh-skill-filesystem')
  ,@('dsh-subprocess-local', 'examples/node_modules/@deepseek-ai/dsh-subprocess-local')
  ,@('dsh-token-meter', 'examples/node_modules/@deepseek-ai/dsh-token-meter')
  ,@('dsh-tool-fs', 'examples/node_modules/@deepseek-ai/dsh-tool-fs')
  ,@('dsh-tool-goal', 'examples/node_modules/@deepseek-ai/dsh-tool-goal')
  ,@('dsh-tool-skill', 'examples/node_modules/@deepseek-ai/dsh-tool-skill')
  ,@('dsh-tool-todo', 'examples/node_modules/@deepseek-ai/dsh-tool-todo')
)
foreach ($p in $examplesPairs) {
  $dst = Join-Path $NM ("@deepseek-ai\" + $p[0])
  if (Test-Path $dst) { Write-Output "SKIP(exists) @deepseek-ai/$($p[0])"; continue }
  New-Item -ItemType Junction -Path $dst -Target (Join-Path $HARNESS_HOME $p[1]) | Out-Null
  Write-Output "CREATED @deepseek-ai/$($p[0]) -> $($p[1])"
}

# ---- @yxspec: 指向 runtime-js/vendor/ ----
$vendorPairs = @(
  ,@("commands", "yxspec-commands")
  ,@("invariants", "yxspec-invariants")
  ,@("tool-guard", "yxspec-tool-guard")
)
foreach ($p in $vendorPairs) {
  $dst = Join-Path $NM ("@yxspec\" + $p[0])
  $src = Join-Path $PSScriptRoot ("..\runtime-js\vendor\" + $p[1])
  if (Test-Path $dst) { Write-Output "SKIP(exists) @yxspec/$($p[0])"; continue }
  New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
  Write-Output "CREATED @yxspec/$($p[0]) -> $src"
}

# ---- graph-memory: 只读指向项目 .dsh/vendor（本机开发路径，换机需改） ----
$gmTarget = "D:/Work/01_Projects/Aima_X1_BCM/.dsh/vendor/graph-memory"
$gmDst = Join-Path $NM "graph-memory"
if (!(Test-Path $gmDst)) {
  if (Test-Path $gmTarget) { New-Item -ItemType Junction -Path $gmDst -Target $gmTarget | Out-Null; Write-Output "CREATED graph-memory -> $gmTarget" }
  else { Write-Warning "graph-memory 目标不存在（$gmTarget），跳过。换机需先配置 .dsh/vendor" }
} else { Write-Output "SKIP(exists) graph-memory" }

# ---- @wxg-prc-cpg/dsh-weknora: 只读指向项目 .dsh/vendor ----
$wekNm = Join-Path $NM "@wxg-prc-cpg"
if (!(Test-Path $wekNm)) { New-Item -ItemType Directory -Path $wekNm -Force | Out-Null }
$wekTarget = "D:/Work/01_Projects/Aima_X1_BCM/.dsh/vendor/dsh-weknora"
$wekDst = Join-Path $wekNm "dsh-weknora"
if (!(Test-Path $wekDst)) {
  if (Test-Path $wekTarget) { New-Item -ItemType Junction -Path $wekDst -Target $wekTarget | Out-Null; Write-Output "CREATED @wxg-prc-cpg/dsh-weknora -> $wekTarget" }
  else { Write-Warning "weknora 目标不存在（$wekTarget），跳过。换机需先配置 .dsh/vendor" }
} else { Write-Output "SKIP(exists) @wxg-prc-cpg/dsh-weknora" }
Write-Output "DONE"
