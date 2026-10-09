#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd apps/api && .venv/bin/pytest -q)
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
pnpm --dir apps/web test:e2e
python3 scripts/audit_read_only.py
