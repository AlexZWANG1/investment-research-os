@echo off
setlocal enabledelayedexpansion
:: hourly-wiki-loop.bat — Windows Task Scheduler 入口（每小时）
:: 实际逻辑委托给 bash 脚本（Git Bash）

set SCRIPT_DIR=%~dp0
set GIT_BASH=C:\Program Files\Git\bin\bash.exe

if not exist "%GIT_BASH%" (
    echo ERROR: Git Bash not found at %GIT_BASH%
    exit /b 1
)

"%GIT_BASH%" "%SCRIPT_DIR%hourly-wiki-loop.sh"
