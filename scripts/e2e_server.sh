#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export TQ_MODE=demo TQ_API_PORT=8791 TQ_NEXT_DIST=.next-e2e PYTHONPATH="$ROOT/apps/api"
WEB_PORT=3004; TEST_DIR=e2e
if [[ "${TQ_E2E_DEV:-0}" == "1" ]]; then
 export TQ_API_PORT=8792 TQ_NEXT_DIST=.next-e2e-dev
 WEB_PORT=3005; TEST_DIR=e2e-dev
fi
export TQ_DATA_DIR="$ROOT/data/$TEST_DIR"
mkdir -p "$TQ_DATA_DIR"
rm -f "$TQ_DATA_DIR/demo.sqlite3" "$TQ_DATA_DIR/demo.sqlite3-wal" "$TQ_DATA_DIR/demo.sqlite3-shm"
apps/api/.venv/bin/python scripts/init_db.py
(cd apps/api && exec .venv/bin/uvicorn tradequest.main:app --host 127.0.0.1 --port "$TQ_API_PORT") & API_PID=$!
WEB_PID=""
cleanup(){ kill "$API_PID" 2>/dev/null || true; [[ -z "$WEB_PID" ]] || kill "$WEB_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
for i in {1..40}; do if curl -fsS "http://127.0.0.1:$TQ_API_PORT/health" >/dev/null 2>&1; then break; fi; sleep .25; done
apps/api/.venv/bin/python scripts/seed_replay_test_ticks.py
if [[ "${TQ_E2E_DEV:-0}" == "1" ]]; then
 (cd apps/web && exec pnpm exec next dev --hostname 127.0.0.1 --port "$WEB_PORT") & WEB_PID=$!
else
 (cd apps/web && pnpm exec next build)
 (cd apps/web && exec pnpm exec next start --hostname 127.0.0.1 --port "$WEB_PORT") & WEB_PID=$!
fi
wait "$API_PID" "$WEB_PID"
