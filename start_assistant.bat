@echo off
title Dota 2 AI Assistant + Laya System-1
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_all.ps1"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Launcher encountered an error (Code %ERRORLEVEL%).
)
echo.
echo [INFO] Assistant session finished. Press any key to close this window...
pause >nul
