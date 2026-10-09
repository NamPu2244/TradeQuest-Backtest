"""Generate reviewed, additive Supabase schema SQL (does not connect or reset data)."""
import os
import sys
from pathlib import Path
from sqlalchemy.schema import CreateTable, CreateIndex
from sqlalchemy.dialects.postgresql import dialect
os.environ.setdefault('TQ_DATA_DIR', '/tmp/tradequest-schema')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
from tradequest.db import Base
from tradequest import models

def sql():
    result = ['-- Backtest only. Additive schema; never DROP or TRUNCATE.\nBEGIN;']
    for table in Base.metadata.sorted_tables:
        result.append(str(CreateTable(table, if_not_exists=True).compile(dialect=dialect())) + ';')
        result.append(f"ALTER TABLE {table.name} ADD COLUMN IF NOT EXISTS owner_id VARCHAR(36) NOT NULL DEFAULT 'local';")
        for index in table.indexes:
            result.append(str(CreateIndex(index, if_not_exists=True).compile(dialect=dialect())) + ';')
        result += [f'ALTER TABLE {table.name} ENABLE ROW LEVEL SECURITY;',
                   f'REVOKE ALL ON TABLE {table.name} FROM anon;',
                   f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table.name} TO authenticated;']
        gate = "COALESCE((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tq_backtest') = 'true', false)"
        read = "owner_id = (SELECT auth.uid())::text"
        if table.name == 'replay_datasets': read += " OR owner_id = 'shared'"
        read = gate + ' AND (' + read + ')'
        write = gate + ' AND owner_id = (SELECT auth.uid())::text'
        if table.name == 'replay_sessions': write += ' AND EXISTS (SELECT 1 FROM replay_datasets d WHERE d.id = dataset_id)'
        if table.name == 'replay_trades': write += ' AND EXISTS (SELECT 1 FROM replay_sessions s WHERE s.id = session_id)'
        # Policy creation is idempotent; no old policy is removed or broadened.
        for command, expression in [('SELECT', 'USING (' + read + ')'),
                                    ('INSERT', 'WITH CHECK (' + write + ')'),
                                    ('UPDATE', 'USING (' + gate + ' AND owner_id = (SELECT auth.uid())::text) WITH CHECK (' + write + ')'),
                                    ('DELETE', 'USING (' + gate + ' AND owner_id = (SELECT auth.uid())::text)')]:
            name = table.name + '_owner_' + command.lower()
            result.append(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='{table.name}' AND policyname='{name}') THEN CREATE POLICY {name} ON {table.name} FOR {command} TO authenticated {expression}; END IF; END $$;")
    result.append('COMMIT;')
    return '\n'.join(line.rstrip() for line in '\n\n'.join(result).splitlines()) + '\n'
if __name__ == '__main__':
    print(sql(), end='')
