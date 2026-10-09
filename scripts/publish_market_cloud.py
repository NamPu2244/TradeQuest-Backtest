"""Upload immutable source ticks + compact indexes to a PRIVATE R2 bucket and register the cloud catalog.
Run with a dedicated write token locally, never with secrets as command-line arguments.
Only market data is read; no sessions, trade history or private Pine source is uploaded.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
from tradequest.models import ReplayDataset
from tradequest.cloud_ticks import BAR, storage
from tradequest.auth import SHARED
from tradequest.tick_store import INTERVALS


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        for part in iter(lambda: file.read(4 * 1024 * 1024), b''): value.update(part)
    return value.hexdigest()

def upload(client, bucket, key, path):
    sha = digest(path)
    try:
        old = client.head_object(Bucket=bucket, Key=key)
    except client.exceptions.ClientError as exc:
        if exc.response['Error']['Code'] not in ('404', 'NoSuchKey', 'NotFound'): raise
        old = None
    if old:
        if old.get('Metadata', {}).get('sha256') != sha or old['ContentLength'] != path.stat().st_size:
            raise ValueError('Existing immutable object differs; refusing overwrite: ' + key)
    else:
        client.upload_file(str(path), bucket, key, ExtraArgs={'Metadata': {'sha256': sha}, 'ContentType': 'application/octet-stream'})
    head = client.head_object(Bucket=bucket, Key=key)
    if head['ContentLength'] != path.stat().st_size or head.get('Metadata', {}).get('sha256') != sha:
        raise ValueError('Cloud object verification failed')
    return {'size': head['ContentLength'], 'etag': head['ETag'], 'sha256': sha}


def publish(source):
    client = storage(); bucket = os.environ['R2_BUCKET']
    url = os.environ['DATABASE_URL'].replace('postgres://', 'postgresql+psycopg://', 1).replace('postgresql://', 'postgresql+psycopg://', 1)
    if not url.startswith('postgresql+psycopg://'): raise ValueError('Destination must be PostgreSQL')
    target = create_engine(url, connect_args={'prepare_threshold': None, 'sslmode': 'require'})
    with sqlite3.connect((source / 'backtest.sqlite3').resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute('SELECT * FROM replay_datasets').fetchall()
    for row in rows:
        meta = json.loads(row['metadata_json'])
        if meta.get('storage') != 'ticks-v1': continue
        import re
        store_id = meta['store_id']
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', store_id): raise ValueError('Invalid store ID')
        folder = source / 'market-data' / store_id
        ticks = folder / 'ticks.bin'
        if ticks.stat().st_size != meta['tick_count'] * 24: raise ValueError('Tick size mismatch')
        sha = digest(ticks)
        expected = meta.get('sha256_ticks') or meta.get('ticks_sha256') or meta.get('sha256')
        if expected and sha != expected: raise ValueError('Source tick hash mismatch')
        prefix = 'markets/' + store_id + '/' + sha
        indexes = {}
        with tempfile.TemporaryDirectory(prefix='backtest-index-') as temporary:
            with sqlite3.connect((folder / 'bars.sqlite3').resolve().as_uri() + '?mode=ro', uri=True) as index:
                for tf in INTERVALS:
                    path = Path(temporary) / (tf + '.idx')
                    last_time = -1; last_idx = -1
                    with path.open('wb') as out:
                        for bar in index.execute('SELECT time,open,high,low,close,volume,first_idx,last_idx FROM frames WHERE tf=? ORDER BY time', (tf,)):
                            if bar[0] <= last_time or bar[6] <= last_idx or bar[7] < bar[6] or bar[7] >= meta['tick_count']:
                                raise ValueError('Invalid source index ordering')
                            last_time = bar[0]; last_idx = bar[7]
                            out.write(BAR.pack(*bar))
                    indexes[tf] = upload(client, bucket, prefix + '/' + path.name, path)
            ticks_info = upload(client, bucket, prefix + '/ticks.bin', ticks)
        meta['cloud_ticks'] = {'version': 1, 'prefix': prefix, 'ticks': ticks_info, 'indexes': indexes}
        with Session(target) as cloud:
            existing = cloud.get(ReplayDataset, row['id'])
            if existing:
                if existing.owner_id != SHARED or existing.metadata_json.get('cloud_ticks') != meta['cloud_ticks']:
                    raise ValueError('Existing cloud dataset differs; refusing overwrite')
            else:
                cloud.add(ReplayDataset(id=row['id'], owner_id=SHARED, name=row['name'], symbol=row['symbol'], timeframe=row['timeframe'],
                    source=row['source'], synthetic=bool(row['synthetic']), bars=[], metadata_json=meta))
                cloud.commit()
        print('Verified cloud market dataset:', row['symbol'])
    target.dispose()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-data', type=Path, default=Path(__file__).resolve().parents[1] / 'data')
    args = parser.parse_args()
    publish(args.source_data.resolve())
