#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export TQ_MODE="${TQ_MODE:-real}"
if [[ "${1:-}" == "--demo" ]]; then export TQ_MODE=demo; fi
export TQ_DATA_DIR="${TQ_DATA_DIR:-$ROOT/data}"
export TQ_API_PORT="${TQ_API_PORT:-8790}"
export PYTHONPATH="$ROOT/apps/api"
uv sync --project apps/api --extra dev --locked
if [[ ! -d apps/web/node_modules ]]; then pnpm install --frozen-lockfile; fi
apps/api/.venv/bin/python scripts/init_db.py
API_PID=""; WEB_PID=""
cleanup(){ [[ -z "$API_PID" ]] || kill "$API_PID" 2>/dev/null || true; [[ -z "$WEB_PID" ]] || kill "$WEB_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
(cd apps/api && exec .venv/bin/uvicorn tradequest.main:app --reload --reload-dir tradequest --host 127.0.0.1 --port "$TQ_API_PORT") & API_PID=$!
(cd apps/web && exec pnpm exec next dev --hostname 127.0.0.1 --port "${TQ_WEB_PORT:-3003}") & WEB_PID=$!
printf 'TradeQuest Backtest: http://localhost:%s · simulation only\n' "${TQ_WEB_PORT:-3003}"
wait "$API_PID" "$WEB_PID"
