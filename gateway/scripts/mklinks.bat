@echo off
chcp 65001 >nul
rem 基础 16 个 junction（examples/node_modules 源）。
rem 路径可经环境变量覆盖：YXSPEC_GATEWAY_NODE_MODULES / HARNESS_HOME（缺省回落本机开发路径）
if "%YXSPEC_GATEWAY_NODE_MODULES%"=="" set "YXSPEC_GATEWAY_NODE_MODULES=D:\Work\01_Projects\Aima_X1_BCM\.dsh\gateway\runtime-js\node_modules"
if "%HARNESS_HOME%"=="" set "HARNESS_HOME=D:\AI\deepseek-harness-master"
set "GW=%YXSPEC_GATEWAY_NODE_MODULES%"
set "SRC=%HARNESS_HOME%\examples\node_modules\@deepseek-ai"

if not exist "%GW%\@deepseek-ai" mkdir "%GW%\@deepseek-ai"

for %%p in (
  dsh-sdk-jsonrpc-server
  dsh-llm-pi-ai
  dsh-settings-file
  dsh-credentials-local
  dsh-agent-spine-demo
  dsh-session-persistence-jsonl
  dsh-session-checkpoint-policy
  dsh-subprocess-local
  dsh-bash-local
  dsh-fs-local
  dsh-fs-observation-policy
  dsh-tool-fs
  dsh-tool-todo
  dsh-tool-goal
  dsh-token-meter
  dsh-compaction-basic
) do (
  if not exist "%GW%\@deepseek-ai\%%p" (
    mklink /J "%GW%\@deepseek-ai\%%p" "%SRC%\%%p" >nul 2>&1
  )
)
echo DONE
