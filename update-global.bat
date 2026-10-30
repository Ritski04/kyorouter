@echo off
setlocal enabledelayedexpansion
title KyoRouter Update Global
cd /d "%~dp0"

set "LOGFILE=%~dp0update-global.log"
call :log "=== KyoRouter Update start %date% %time% ==="

echo.
echo ==================================================
echo    KyoRouter Update — global from GitHub
echo ==================================================
echo.

rem --- 1. Pull latest from GitHub ---
echo [1/6] Pulling latest from GitHub...
call :log "[1/6] git fetch origin"
git fetch origin >>"%LOGFILE%" 2>&1
call :log "fetch exit=%errorlevel%"
git pull --rebase --autostash origin main >>"%LOGFILE%" 2>&1
call :log "pull exit=%errorlevel%"
if errorlevel 1 (
  echo.
  echo [ERROR] git pull failed. See %LOGFILE%
  pause
  exit /b 1
)

rem --- 2. Stop the running instance (port 20128) so cli/app is not
rem          locked during the rebuild. Tray parent is also killed (tree) so
rem          it does not respawn the server mid-build. ---
echo.
echo [2/6] Stopping KyoRouter on port 20128...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":20128" ^| findstr "LISTENING"') do (
  echo   Killing PID %%P (server child) on port 20128...
  taskkill /F /PID %%P >nul 2>&1
  call :log "killed child PID %%P"
)
rem Also kill the tray parent process tree if it spawned that listener.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":20128" ^| findstr "LISTENING"') do (
  taskkill /F /T /PID %%P >nul 2>&1
  call :log "killed tree PID %%P"
)
timeout /t 2 /nobreak >nul
echo   Done.
call :log "[2/6] server stopped"

rem --- 3. Build the Next.js app (folder project) ---
echo.
echo [3/6] Building Next.js app...
call :log "[3/6] npm run build"
call npm run build >>"%LOGFILE%" 2>&1
call :log "app build exit=%errorlevel%"
if errorlevel 1 (
  echo [ERROR] App build failed. See %LOGFILE%
  pause
  exit /b 1
)

rem --- 4. Build the CLI package (bundles app into cli/ on disk) ---
echo.
echo [4/6] Building CLI package...
call :log "[4/6] npm run build (cli)"
cd cli
call npm run build >>"%LOGFILE%" 2>&1
call :log "cli build exit=%errorlevel%"
if errorlevel 1 (
  echo [ERROR] CLI build failed. See %LOGFILE%
  pause
  exit /b 1
)

rem --- 5. Force reinstall global. This also BREAKS the hardlink so the
rem         global package becomes a free-standing copy (no longer sharing
rem         files with the project), so future updates touch the global only. ---
echo.
echo [5/6] Installing global package (uninstall + fresh install)...
call :log "[5/6] npm uninstall -g + install -g . --force"
call npm uninstall -g kyorouter >>"%LOGFILE%" 2>&1
call npm install -g . --force >>"%LOGFILE%" 2>&1
call :log "global install exit=%errorlevel%"
if errorlevel 1 (
  echo [ERROR] Global install failed. See %LOGFILE%
  pause
  exit /b 1
)

rem --- 6. Restart KyoRouter from the GLOBAL package (so it runs the new build). ---
echo.
echo [6/6] Starting KyoRouter on port 20128 (from global)...
cd ..
call :log "[6/6] starting kyorouter --tray -p 20128"
start "" cmd /c "kyorouter --tray -p 20128"

echo.
echo ==================================================
echo    Update complete!
echo    - Global package refreshed from GitHub
echo    - 20128 restarted from the global build
echo    (open http://localhost:20128/dashboard to check)
echo ==================================================
call :log "=== update DONE ==="
echo.
pause
exit /b 0

:log
echo %~1 >>"%LOGFILE%"
exit /b 0
