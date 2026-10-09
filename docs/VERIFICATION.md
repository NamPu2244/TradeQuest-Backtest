# Standalone extraction verification

Validated locally on macOS on 2026-10-09. Extracted from TradeQuest commit `1f53b04`; the shared source checkout remains clean at that commit.

- Backend: **60 tests passed** on the standalone runtime. Price/volume rules, multi-position and partial accounting, real-quote fills, random-start/resume, rewind, indicator versions and backtest-only import are covered.
- Production Chrome: **25 tests passed**, including terminal Buy/Sell without entry notes, Open/Pending/Closed tabs, per-position exits, partial volume, toast-only TP/SL/manual notifications, optional Review from toast/history, expiry and persistence.
- Development Chrome / React StrictMode: **the same 25 tests passed**.
- TypeScript, ESLint, production build and simulation-boundary audit passed.
- Desktop and 390px mobile viewport exercised. Drawings retain preview, body/endpoint movement, eight box handles, undo/redo, lock/delete, Fibonacci settings and legacy persistence. Pine workers retain isolation, timeout, plots, supported drawing objects and native input controls.
- Playback preserves chart canvases and uses a fresh revision when manual close waits for an in-flight tick. Closed-table prices show the actual exit price.
- Local Backtest migration: all copied rows and both market stores matched the source; each tick/index/manifest file was compared by SHA-256. Journal, account settings and MT5 routes are outside the standalone schema and routes.

The chart's old inline height setter was removed so CSS owns responsive terminal height. Opening a profile restores scroll to the terminal top. Drawing tests measure settled chart coordinates rather than stale bounds from the previous profile form.

Tests use isolated synthetic fixtures. They do not validate broker execution, profitability, native TradingView parity or a physical iPhone/Safari. The app remains local only; cloud hosting/login were outside this extraction.

A FastAPI/Starlette test-client deprecation warning remains in the installed dependencies; tests still pass. No user trading state or tick data is committed. Repository screenshots contain authored demo data only.

## Vercel cloud preparation (2026-10-09)

- Backend: **67 passed**; five PostgreSQL cases skipped by the SQLite runner and run separately.
- Real temporary PostgreSQL: **5 passed**. Raw SQL RLS hides another owner's data after commits, shared datasets are read-only, foreign-owner parent references are rejected, identical revision races yield exactly one success, and state copy preserves source bytes/frozen revisions and refuses overwrite. A fixture S3 upload proves immutable object/catalog registration and repeat upload behavior. Direct authenticated Supabase REST claims without the API invitation gate cannot access tables.
- Production Chrome Replay: **25 passed** after the cloud changes. TypeScript, ESLint, production build and simulation-boundary audit passed.
- Cloud Login Chrome: **3 passed**, covering desktop/mobile GitHub-only UI, no authenticated session/API denial, cross-origin mutations, forged browser headers and PKCE with a fixed callback. The provider handoff uses an intercepted authored fixture; no real OAuth consent was performed.
- Remote tick reader parity covers each TF, duplicate timestamps, forming-bar causality, auto exits, bounded/reused range cache and changed archive rejection using authored quotes, not real R2 access.
- `vercel.json` instance validated against Vercel's official schema. The upstream schema's own meta-schema contains a mixed-draft inconsistency, so validation used the instance validator directly.

**Live deployment remains pending configuration:** Supabase OAuth provider/database credentials, user allowlist and private R2 bucket/token/upload. Tests do not prove an actual Vercel service binding, production Supabase pooler or R2 bucket until those are configured and exercised. Local–Cloud automatic sync is not implemented; the provided import is a one-time copy. Original local Backtest state and the shared repository were not modified.
