@echo off
REM =============================================================================
REM open-lan-firewall.bat — 放行 yxspec-studio 局域网入站端口（8787 网关 / 1420 Vite）
REM 用法：右键"以管理员身份运行"。添加后其他电脑可经 http://172.16.31.157:8787 与 :1420 访问。
REM 幂等：已存在的同名规则会被 /f 覆盖重建。
REM =============================================================================
netsh advfirewall firewall add rule name="yxspec-studio-8787" dir=in action=allow protocol=TCP localport=8787 /f
netsh advfirewall firewall add rule name="yxspec-studio-1420" dir=in action=allow protocol=TCP localport=1420 /f
echo.
echo 已尝试放行 8787 / 1420。验证：
netsh advfirewall firewall show rule name="yxspec-studio-8787" | findstr /i "规则名称 启用 方向 协议 本地端口"
netsh advfirewall firewall show rule name="yxspec-studio-1420" | findstr /i "规则名称 启用 方向 协议 本地端口"
echo.
echo 若上方显示"没有匹配标准"，说明仍被拒（需管理员运行本脚本）。
pause
