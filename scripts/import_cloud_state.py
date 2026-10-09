"""Copy a consistent local Backtest snapshot into ONE Supabase user's account.
Explicit one-time copy, not automatic sync. Never edits the local source or overwrites cloud records.
Run only after publishing tick catalogs and applying cloud-schema.sql.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from uuid import UUID
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
from tradequest.models import Setting, ReplayDataset, ReplaySession, ReplayTrade


def attributes(model, row, owner):
    result = {}
    for column in model.__table__.columns:
        name = column.name
        if name == 'owner_id': result[name] = owner; continue
        value = row[name]
        if name in ('value', 'bars', 'metadata_json', 'config_json', 'drawings', 'indicators', 'playbook_snapshot', 'decision', 'review'):
            value = json.loads(value) if value is not None else None
        elif name in ('created_at', 'updated_at'):
            value = datetime.fromisoformat(value)
            if value.tzinfo is None: value = value.replace(tzinfo=timezone.utc)
        elif name in ('synthetic', 'ambiguous'): value = bool(value)
        result[name] = value
    return result


def copy_state(source, owner):
    UUID(owner)
    url = os.environ['DATABASE_URL'].replace('postgres://', 'postgresql+psycopg://', 1).replace('postgresql://', 'postgresql+psycopg://', 1)
    if not url.startswith('postgresql+psycopg://'): raise ValueError('Destination must be PostgreSQL')
    target = create_engine(url, connect_args={'prepare_threshold': None, 'sslmode': 'require'})
    with target.connect() as connection:
        if not connection.scalar(text('SELECT id FROM auth.users WHERE id = :id'), {'id': owner}):
            raise ValueError('Owner is not an existing Supabase Authentication user')
    with tempfile.TemporaryDirectory(prefix='backtest-cloud-copy-') as temporary:
        snapshot = Path(temporary) / 'snapshot.sqlite3'
        with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as local, sqlite3.connect(snapshot) as out: local.backup(out)
        with sqlite3.connect(snapshot) as local, Session(target) as cloud:
            local.row_factory = sqlite3.Row
            counts = {}
            for model in (ReplayDataset, Setting, ReplaySession, ReplayTrade):
                rows = local.execute('SELECT * FROM ' + model.__tablename__).fetchall()
                counts[model.__tablename__] = 0
                for row in rows:
                    if model is Setting and not row['key'].startswith('pine-script:'): continue
                    values = attributes(model, row, owner)
                    pk = row['key'] if model is Setting else row['id']
                    existing = cloud.get(model, pk)
                    if model is ReplayDataset and values['metadata_json'].get('storage') == 'ticks-v1':
                        if not existing or existing.owner_id != 'shared' or not existing.metadata_json.get('cloud_ticks'):
                            raise ValueError('Publish referenced tick datasets before importing profiles')
                        if existing.metadata_json.get('sha256') != values['metadata_json'].get('sha256'):
                            raise ValueError('Cloud market data differs from local source')
                        continue
                    if existing:
                        raise ValueError('Destination already contains this ID; refusing to overwrite')
                    cloud.add(model(**values)); counts[model.__tablename__] += 1
                cloud.flush()
            cloud.commit()
    target.dispose()
    return counts

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-db', type=Path, default=Path(__file__).resolve().parents[1] / 'data/backtest.sqlite3')
    parser.add_argument('--owner-id', required=True, help='Your verified Supabase Authentication user UUID')
    args = parser.parse_args()
    print(json.dumps(copy_state(args.source_db, args.owner_id)))
