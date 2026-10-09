#!/usr/bin/env python3
"""Copy Backtest-only local state from a TradeQuest directory. Never modify source."""
import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from sqlalchemy import create_engine
from tradequest.db import Base
from tradequest import models  # register only standalone tables


def import_local(source: Path, destination: Path):
    source, destination = source.resolve(), destination.resolve()
    source_db = source / 'data' / 'tradequest.sqlite3'
    if not source_db.is_file():
        raise ValueError('Source TradeQuest database not found')
    if destination == source / 'data' or source in destination.parents:
        raise ValueError('Destination must be separate from the source project')
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / 'backtest.sqlite3'
    if target.exists():
        with sqlite3.connect(target) as existing:
            if any(existing.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in Base.metadata.tables):
                raise ValueError('Destination already contains data; refusing to overwrite')
    with tempfile.TemporaryDirectory(prefix='.backtest-import-', dir=destination) as temp:
        staging = Path(temp)
        snapshot = staging / 'source.sqlite3'
        with sqlite3.connect(source_db.as_uri() + '?mode=ro', uri=True) as src, sqlite3.connect(snapshot) as out:
            src.backup(out)
        staged_db = staging / 'backtest.sqlite3'
        engine = create_engine('sqlite:///' + str(staged_db))
        Base.metadata.create_all(engine)
        engine.dispose()
        with sqlite3.connect(snapshot) as src, sqlite3.connect(staged_db) as out:
            src.row_factory = sqlite3.Row
            sessions = [r for r in src.execute('SELECT * FROM replay_sessions') if json.loads(r['config_json']).get('workspace') == 'backtest']
            session_ids = {r['id'] for r in sessions}
            datasets = list(src.execute('SELECT * FROM replay_datasets'))
            trades = [r for r in src.execute('SELECT * FROM replay_trades') if r['session_id'] in session_ids]
            settings = list(src.execute("SELECT * FROM settings WHERE key LIKE 'pine-script:%'"))
            tables = {'replay_datasets': datasets, 'replay_sessions': sessions, 'replay_trades': trades, 'settings': settings}
            stores = set()
            for row in datasets:
                metadata = json.loads(row['metadata_json'])
                if metadata.get('storage') != 'ticks-v1':
                    continue
                key = metadata.get('store_id', '')
                if not key or Path(key).name != key or key in ('.', '..'):
                    raise ValueError('Invalid tick store identifier')
                folder = (source / 'data' / 'market-data' / key).resolve()
                if folder.parent != (source / 'data' / 'market-data').resolve() or not folder.is_dir():
                    raise ValueError('Referenced tick store is missing or outside market-data')
                if (folder / 'ticks.bin').stat().st_size != metadata['tick_count'] * 24:
                    raise ValueError('Tick store size does not match dataset metadata')
                if key not in stores:
                    copied = staging / 'market-data' / key
                    copied.mkdir(parents=True)
                    for name in ('ticks.bin', 'bars.sqlite3', 'manifest.json'):
                        shutil.copy2(folder / name, copied / name)
                    stores.add(key)
            for table, rows in tables.items():
                columns = [c[1] for c in out.execute(f'PRAGMA table_info("{table}")')]
                names = ','.join('"' + c + '"' for c in columns)
                marks = ','.join('?' for _ in columns)
                out.executemany(f'INSERT INTO "{table}" ({names}) VALUES ({marks})', [tuple(r[c] for c in columns) for r in rows])
            out.commit()
            if out.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Imported database integrity check failed')
        market = destination / 'market-data'
        market.mkdir(exist_ok=True)
        if any((market / key).exists() for key in stores):
            raise ValueError('Tick store destination exists; refusing to overwrite')
        # Publish only after snapshot, referenced files, and rows have all passed validation.
        for key in stores:
            shutil.move(str(staging / 'market-data' / key), market / key)
        os.replace(staged_db, target)
        os.chmod(target, 0o600)
        return {t: len(rows) for t, rows in tables.items()} | {'tick_stores': len(stores)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='TradeQuest application directory')
    parser.add_argument('--destination', type=Path, default=Path(__file__).resolve().parents[1] / 'data')
    args = parser.parse_args()
    try:
        print(json.dumps(import_local(args.source, args.destination)))
    except (ValueError, OSError, sqlite3.Error) as exc:
        raise SystemExit(str(exc))
