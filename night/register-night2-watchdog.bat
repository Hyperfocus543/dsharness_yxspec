@echo off
:: =============================================================================
:: register-night2-watchdog.bat — 以管理员身份注册 yxspec-night2-watchdog 计划任务
:: 让看门狗每 5 分钟检查 night2 runner，崩溃自动重启（持续一直跑不人工审核）。
::
:: 用法：右键本文件 →「以管理员身份运行」（需要 UAC 提权）
:: 注册后立即跑一次看门狗验证任务可启动。
:: 已注册过会覆盖（/f）。
:: =============================================================================
setlocal

:: Git Bash 绝对路径（本机装于 D 盘；若路径变了自行改这两行）
set "BASH=D:\Program Files\Git\usr\bin\bash.exe"
set "WATCHDOG=D:\Work\04_Temp\yxspec-studio-release\night\watchdog-night2.sh"

if not exist "%BASH%" (
  echo [错误] 找不到 Git Bash: %BASH%
  echo 请检查 Git 安装路径，修改本文件顶部 BASH 变量。
  pause
  exit /b 1
)
if not exist "%WATCHDOG%" (
  echo [错误] 找不到看门狗脚本: %WATCHDOG%
  pause
  exit /b 1
)

echo === 注册计划任务 yxspec-night2-watchdog（每 5 分钟）===
schtasks /create /tn yxspec-night2-watchdog ^
  /tr "\"%BASH%\" \"%WATCHDOG%\"" ^
  /sc minute /mo 5 /f
if errorlevel 1 (
  echo.
  echo [失败] 计划任务注册失败（确认本窗口是「以管理员身份运行」）。
  pause
  exit /b 1
)

echo.
echo [成功] 已注册。立即触发一次验证：
schtasks /run /tn yxspec-night2-watchdog
echo.
echo [提示] 停用:     schtasks /end /tn yxspec-night2-watchdog
echo [提示] 删除:     schtasks /delete /tn yxspec-night2-watchdog /f
echo [提示] 查询:     schtasks /query /tn yxspec-night2-watchdog
echo.
echo 验证方式：等 1 分钟后看 night2-console.log 时间戳是否在推进。
pause
