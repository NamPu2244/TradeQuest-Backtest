"""Temporary PostgreSQL/RLS test runner; requires `uv run --with pgserver`.
Never connects to production or modifies local trading data.
"""
def main():
    import os
    from pathlib import Path
    import subprocess
    import tempfile
    from pgserver import get_server
    root=Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='backtest-pg-') as temp:
        server=get_server(Path(temp)/'pgdata',cleanup_mode='delete')
        try:
            env={**os.environ,'TQ_TEST_POSTGRES_URL':server.get_uri(),'TQ_DEPLOYMENT':'local'}
            for key in ('VERCEL','DATABASE_URL'):env.pop(key,None)
            result=subprocess.run([str(root/'apps/api/.venv/bin/python'),'-m','pytest','tests/test_postgres_cloud.py','-q','--tb=short'],cwd=root/'apps/api',env=env)
        finally: server.cleanup()
        return result.returncode
if __name__ == '__main__': raise SystemExit(main())
