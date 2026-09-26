@echo off
title Stop Dota 2 AI Assistant
cd /d "%~dp0"

echo [*] Stopping Dota 2 AI Assistant and background services...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000,8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*vision_service*' -or $_.CommandLine -like '*laya_service*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo [OK] All services stopped.
ping 127.0.0.1 -n 2 >nul
