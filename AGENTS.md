# Standalone Backtest scope

This repository owns a manual trading simulator with independent local storage and per-user cloud storage. Keep Journal, MT5 bridge, broker execution and the shared study repository outside this application.

- Preserve frozen decisions, indicator versions, drawing coordinates, trade accounting and imported historical evidence.
- User-requested changes to simulator UX must not add broker order paths.
- Test only isolated authored/demo datasets. Do not reset or modify `data/backtest.sqlite3` during tests.
- Follow `CONTRIBUTING.md` for locked installs and checks. Use `bash scripts/test.sh`; exercise development/StrictMode for chart lifecycle changes.
- Never commit credentials, databases, private Pine code, market archives, logs, personal screenshots or account identifiers.
- New UI controls must work; label simulated money and independent market feeds accurately. Do not add fictional broker margin/deposit values.
- Retain AGPL-3.0-only source licensing and dependency notices; do not change another project's license.
