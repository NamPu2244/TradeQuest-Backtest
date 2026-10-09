# Contributing

Run from this repository root. Install locked dependencies with `pnpm install --frozen-lockfile` and `uv sync --project apps/api --extra dev --locked`.

Before submitting changes:

```bash
bash scripts/test.sh
```

For chart, drawing, Pine worker, dialog or playback lifecycle changes also run:

```bash
TQ_E2E_DEV=1 pnpm --dir apps/web test:e2e
```

Browser fixtures create synthetic OHLC and Bid/Ask data under `data/e2e/` or `data/e2e-dev/`. The launcher resets **only** those isolated demo databases and stops its own servers. Tests must not touch the real local database or original TradeQuest checkout. Run production and development suites sequentially because they share report output paths.

Use authored/demo screenshots for UI evidence. Test desktop and a mobile viewport; emulator evidence is not physical iPhone/Safari validation. The simulator and PineTS runtime are not native broker or TradingView parity proofs.

Audit the staged diff before pushing. Do not commit `data/`, `.env`, credentials, SQLite files, private scripts, download archives, account IDs, logs, generated dependencies or reference screenshots belonging to external products. Preserve attribution and licenses.

Cloud changes also require the isolated PostgreSQL proof (never pass a production connection string):

```bash
uv run --directory /tmp --with pgserver python "$PWD/scripts/test_postgres.py"
```

This starts/deletes only its own temporary PostgreSQL cluster, checks RLS even for raw SQL, concurrent revision handling without an in-process lock, and a one-time frozen-state copy. The five PostgreSQL cases are skipped in the ordinary SQLite suite and exercised by this runner. `scripts/test.sh` includes GitHub Login/PKCE UI tests after the production build; the real OAuth consent, service binding and R2 credentials still require deployment verification.
