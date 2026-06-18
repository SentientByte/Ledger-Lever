#!/usr/bin/env bash
# dev.sh — start Ledger Lever in development mode
# Usage:
#   ./dev.sh          normal mode
#   ./dev.sh --debug  debug mode (verbose logging + /api/debug endpoint)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${LEDGER_DB_PATH:-/tmp/ledger-data/portfolio.db}"
DEBUG_MODE=0

for arg in "$@"; do
  [[ "$arg" == "--debug" ]] && DEBUG_MODE=1
done

mkdir -p "$(dirname "$DB_PATH")"

# Kill any previous instances
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite.*3000"            2>/dev/null || true
sleep 1

echo "Starting backend on :8000 (DB: $DB_PATH)..."
BACKEND_ENV="LEDGER_DB_PATH=$DB_PATH"
[[ "$DEBUG_MODE" == "1" ]] && BACKEND_ENV="$BACKEND_ENV DEBUG=1"

LOG_LEVEL="info"
[[ "$DEBUG_MODE" == "1" ]] && LOG_LEVEL="debug"

cd "$ROOT/backend"
env $BACKEND_ENV uvicorn app.main:app \
  --host 0.0.0.0 --port 8000 \
  --log-level "$LOG_LEVEL" \
  --reload \
  > /tmp/backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend
for i in $(seq 1 15); do
  if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "  Backend ready (PID $BACKEND_PID)"
    break
  fi
  sleep 1
done

echo "Starting frontend on :3000..."
cd "$ROOT/frontend"
npm install --silent 2>/dev/null
npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!

for i in $(seq 1 15); do
  if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo "  Frontend ready (PID $FRONTEND_PID)"
    break
  fi
  sleep 1
done

echo ""
echo "Ledger Lever is running:"
echo "  App:     http://localhost:3000"
echo "  API:     http://localhost:8000/api"
echo "  API docs: http://localhost:8000/docs"
[[ "$DEBUG_MODE" == "1" ]] && echo "  Debug:   http://localhost:8000/api/debug"
echo ""
echo "Logs: /tmp/backend.log  /tmp/frontend.log"
echo "Stop: pkill -f 'uvicorn app.main:app'; pkill -f 'vite'"
