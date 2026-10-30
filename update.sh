#!/usr/bin/env bash
# KyoRouter update — pull + build + install global + restart
set -e
cd "$(dirname "$0")"

echo "=========================================="
echo "  KyoRouter Update — pull + build + install"
echo "=========================================="

echo "[1/6] Pulling latest from GitHub..."
git fetch origin
git pull --rebase --autostash origin main || { echo "[ERROR] git pull failed. Check uncommitted changes / network."; exit 1; }

echo
echo "[2/6] Stopping running KyoRouter instance (frees cli/app for rebuild)..."
PIDS=$(netstat -ano 2>/dev/null | grep ":20128" | grep LISTENING | awk '{print $5}' | sort -u)
for p in $PIDS; do
  echo "  Killing PID $p on port 20128..."
  taskkill //F //PID "$p" >/dev/null 2>&1 || true
done
sleep 2

echo
echo "[3/6] Building Next.js app..."
npm run build

echo
echo "[4/6] Building CLI package..."
cd cli
npm run build

echo
echo "[5/6] Installing global package (force)..."
npm install -g . --force

echo
echo "[6/6] Starting KyoRouter in tray mode..."
cd ..
(nohup kyorouter --tray --skip-update >/dev/null 2>&1 &)

echo
echo "=========================================="
echo "  Update complete! Tray restarting."
echo "=========================================="
