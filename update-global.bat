@echo off
setlocal enabledelayedexpansion
title KyoRouter Update Global
cd /d "%~dp0"

echo.
echo ==================================================
echo    KyoRouter Update — global from GitHub
echo ==================================================
echo.

rem --- 1. Pull latest from GitHub ---
echo [1/6] Pulling latest from GitHub...
git fetch origin
git pull --rebase --autostash origin main
if errorlevel 1 (
  echo.
  echo [ERROR] git pull failed. Aborting.
  echo Possible causes: uncommitted local changes that conflict.
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
)
rem Also kill the tray parent process tree if it spawned that listener.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":20128" ^| findstr "LISTENING"') do (
  taskkill /F /T /PID %%P >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo   Done.

rem --- 3. Build the Next.js app (folder project) ---
echo.
echo [3/6] Building Next.js app...
call npm run build
if errorlevel 1 (
  echo [ERROR] App build failed.
  pause
  exit /b 1
)

rem --- 4. Build the CLI package (bundles app into cli/ on disk) ---
echo.
echo [4/6] Building CLI package...
cd cli
call npm run build
if errorlevel 1 (
  echo [ERROR] CLI build failed.
  pause
  exit /b 1
)

rem --- 5. Force reinstall global. This also BREAKS the hardlink so the
rem         global package becomes a free-standing copy (no longer sharing
rem         files with the project), so future updates touch the global only. ---
echo.
echo [5/6] Installing global package (uninstall + fresh install)...
call npm uninstall -g kyorouter >nul 2>&1
call npm install -g . --force
if errorlevel 1 (
  echo [ERROR] Global install failed.
  pause
  exit /b 1
)

rem --- 6. Restart KyoRouter from the GLOBAL package (so it runs the new build). ---
echo.
echo [6/6] Starting KyoRouter on port 20128 (from global)...
cd ..
start "" cmd /c "kyorouter --tray -p 20128"

echo.
echo ==================================================
echo    Update complete!
echo    - Global package refreshed from GitHub
echo    - 20128 restarted from the global build
echo    (open http://localhost:20128/dashboard to check)
echo ==================================================
echo.
pause
