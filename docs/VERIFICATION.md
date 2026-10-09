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
