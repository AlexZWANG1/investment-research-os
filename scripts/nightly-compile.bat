@echo off
setlocal enabledelayedexpansion
:: nightly-compile.bat — Windows Task Scheduler 入口
:: 触发时间：每天 04:00
:: 实际逻辑委托给 bash 脚本（Git Bash）

set SCRIPT_DIR=%~dp0
set GIT_BASH=C:\Program Files\Git\bin\bash.exe

if not exist "%GIT_BASH%" (
    echo ERROR: Git Bash not found at %GIT_BASH%
    exit /b 1
)

:: Run the bash script via Git Bash
"%GIT_BASH%" "%SCRIPT_DIR%nightly-compile.sh"
