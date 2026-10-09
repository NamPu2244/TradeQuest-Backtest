"""Cloud identity, tenant boundaries and immutable range parity using authored fixtures only."""
import copy
import io
import os
import struct
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from sqlalchemy import select
from tradequest import auth, tick_store, cloud_ticks
from tradequest.auth import Principal, get_principal
from tradequest.main import app
from tradequest.models import ReplayDataset, ReplaySession, Setting
from test_tick_replay import tick_dataset

BASE = '/api/v1/replay'
A, B = str(uuid4()), str(uuid4())


def test_tenant_boundaries_include_id_lookups_and_pine_versions(client, db):
    user = [A]
    app.dependency_overrides[get_principal] = lambda: Principal(user[0])
    try:
        a = client.post(BASE + '/datasets/demo').json()
        profile = client.post(BASE + '/sessions', json={'dataset_id': a['id'], 'name': 'A private', 'initial_balance': 1000,
                    'target_trades': 20, 'goal': 'authored test', 'point_value': 100}).json()
        pine = client.post(BASE + '/pine-scripts', json={'name': 'A private', 'source': '//@version=6\nindicator("A")\nplot(close)'}).json()
        user[0] = B
        assert client.get(BASE + '/datasets').json() == []
        assert client.get(BASE + '/sessions').json() == []
        assert client.get(BASE + '/pine-scripts').json() == []
        assert client.get(BASE + '/sessions/' + profile['id']).status_code == 404
        assert client.post(BASE + '/sessions', json={'dataset_id': a['id'], 'initial_balance': 1000, 'target_trades': 20,
                     'goal': 'guess', 'point_value': 1}).status_code == 404
        for action in ('advance', 'step', 'rewind', 'finish', 'close', 'close-all'):
            assert client.post(f"{BASE}/sessions/{profile['id']}/{action}", json={'revision': 0}).status_code == 404
        assert client.put(f"{BASE}/sessions/{profile['id']}/timeframe", json={'revision': 0, 'timeframe': 'M15'}).status_code == 404
        assert client.put(f"{BASE}/sessions/{profile['id']}/visuals", json={'revision': 0, 'drawings': [], 'indicators': []}).status_code == 404
        assert client.put(f"{BASE}/pine-scripts/{pine['id']}", json={'name': 'guess', 'source': '//@version=6\nindicator("B")', 'base_version': 1}).status_code == 404
        assert client.delete(f"{BASE}/pine-scripts/{pine['id']}?base_version=1").status_code == 404
        b = client.post(BASE + '/datasets/demo').json()
        assert b['id'] != a['id']
        user[0] = A
        assert [s['id'] for s in client.get(BASE + '/sessions').json()] == [profile['id']]
        assert client.get(BASE + '/pine-scripts').json()[0]['latest_version'] == 1
        assert db.get(ReplaySession, profile['id']).owner_id == A
        assert db.get(Setting, 'pine-script:' + pine['id']).owner_id == A
    finally:
        app.dependency_overrides.clear()


def test_shared_market_is_read_only_and_writes_reject_foreign_owner(db):
    d = ReplayDataset(name='Shared authored', symbol='DEMO', timeframe='M5', source='DEMO', synthetic=True, bars=[], metadata_json={}, owner_id='shared')
    db.add(d); db.commit()
    db.info['owner_id'] = A
    assert db.get(ReplayDataset, d.id) is not None
    d.name = 'cannot edit shared'
    with pytest.raises(HTTPException) as error: db.commit()
    assert error.value.status_code == 403
    db.rollback()
    db.add(Setting(key='foreign', value={}, owner_id=B))
    with pytest.raises(HTTPException): db.commit()
    db.rollback()


def test_verified_jwt_not_email_or_metadata_from_client(monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setenv('SUPABASE_URL', 'https://example.supabase.co')
    monkeypatch.setenv('TQ_ALLOWED_USER_IDS', A)
    monkeypatch.delenv('TQ_ALLOWED_EMAILS', raising=False)
    monkeypatch.setattr(auth, 'jwks', lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())))
    now = int(datetime.now(timezone.utc).timestamp())
    claims = {'sub': A, 'email': 'authored@example.com', 'role': 'authenticated', 'aud': 'authenticated',
              'iss': 'https://example.supabase.co/auth/v1', 'iat': now, 'exp': now + 300}
    def token(overrides=None, signing=key): return jwt.encode(claims | (overrides or {}), signing, algorithm='ES256', headers={'kid': 'fixture'})
    assert auth.verify_token(token()).id == A
    for change, status in [({'exp': now - 10}, 401), ({'aud': 'other'}, 401), ({'iss': 'https://evil.example'}, 401),
                           ({'sub': B}, 403), ({'role': 'service_role'}, 403)]:
        with pytest.raises(HTTPException) as error: auth.verify_token(token(change))
        assert error.value.status_code == status
    with pytest.raises(HTTPException) as error: auth.verify_token(token(signing=ec.generate_private_key(ec.SECP256R1())))
    assert error.value.status_code == 401
    monkeypatch.setattr(auth, 'CLOUD', True)
    with pytest.raises(HTTPException): auth.get_principal('', auth.LOCAL_KEY)


@pytest.fixture
def remote_dataset(tick_dataset, monkeypatch):
    d = tick_dataset
    folder = tick_store.folder(d)
    objects = {'ticks.bin': (folder / 'ticks.bin').read_bytes()}
    with tick_store.open_index(d) as index:
        for tf in tick_store.INTERVALS:
            objects[tf + '.idx'] = b''.join(cloud_ticks.BAR.pack(*index.at(tf, i)) for i in range(index.count(tf)))
    prefix = 'markets/demo/' + 'a' * 64
    def info(name): return {'size': len(objects[name]), 'etag': '"fixture"'}
    d.metadata_json = d.metadata_json | {'cloud_ticks': {'version': 1, 'prefix': prefix, 'ticks': info('ticks.bin'),
                           'indexes': {tf: info(tf + '.idx') for tf in tick_store.INTERVALS}}}
    calls = []
    def get_object(**kw):
        assert kw['Bucket'] == 'private-test' and kw['IfMatch'] == '"fixture"'
        name = kw['Key'].removeprefix(prefix + '/')
        data = objects[name]; start, end = map(int, kw['Range'][6:].split('-'))
        calls.append((name, start, end))
        return {'Body': io.BytesIO(data[start:end+1]), 'ETag': '"fixture"', 'ContentRange': f'bytes {start}-{end}/{len(data)}'}
    monkeypatch.setenv('R2_BUCKET', 'private-test')
    monkeypatch.setattr(cloud_ticks, 'storage', lambda: SimpleNamespace(get_object=get_object))
    cloud_ticks._cache.clear(); cloud_ticks._bytes = 0
    return d, calls


def test_remote_range_parity_no_future_ohlc_duplicate_times_and_cached_reads(remote_dataset, monkeypatch):
    d, calls = remote_dataset
    cursors = [0, 1, 2, 80, 399, 400, 402, 719]
    expected = {(cursor, tf): tick_store.view(d, cursor, tf) for cursor in cursors for tf in tick_store.INTERVALS}
    with tick_store.quotes(d) as local:
        stamps = [tick_store.tick_at(local, i)['time_ms'] + offset for i in cursors for offset in (-1, 0, 1)]
        bounds = {(stamp, upper): tick_store.find_index(local, stamp, upper) for stamp in stamps for upper in (True, False)}
    monkeypatch.setattr(auth, 'CLOUD', True)
    monkeypatch.setattr(tick_store, 'CLOUD', True)
    for key, result in expected.items(): assert tick_store.view(d, *key) == result
    with tick_store.quotes(d) as remote:
        for key, result in bounds.items(): assert tick_store.find_index(remote, *key) == result
    first = len(calls)
    tick_store.view(d, 402, 'M5')
    assert len(calls) == first
    assert first <= 8  # one small immutable block per index + tick block for this fixture
    assert cloud_ticks._bytes <= cloud_ticks.LIMIT


def test_remote_changed_archive_fails_closed(remote_dataset, monkeypatch):
    d, _ = remote_dataset
    monkeypatch.setattr(cloud_ticks, 'storage', lambda: SimpleNamespace(get_object=lambda **kw: {
        'Body': io.BytesIO(b'wrong'), 'ETag': '"changed"', 'ContentRange': 'bytes 0-4/5'}))
    with pytest.raises(HTTPException) as error: cloud_ticks.RemoteQuotes(d).tick(0)
    assert error.value.status_code == 409


def test_tick_advance_remote_matches_local_clock_and_auto_exit(remote_dataset, monkeypatch):
    d, _ = remote_dataset
    from tradequest.models import ReplayTrade
    def run(remote):
        monkeypatch.setattr(auth, 'CLOUD', remote); monkeypatch.setattr(tick_store, 'CLOUD', remote)
        s = SimpleNamespace(cursor=399, end_cursor=719, config_json={'timeframe': 'M5', 'commission_r': 0})
        t = ReplayTrade(side='BUY', status='pending', order_type='MARKET', requested_entry=100, stop_price=90, target_price=105,
                        decision={'lot': 1, 'point_value': 1}, playbook_snapshot={})
        for _ in range(3): tick_store.advance(d, s, [t], milliseconds=15000)
        return s.cursor, s.config_json, t.status, t.entry_price, t.exit_price, t.decision, t.net_r
    expected = run(False)
    assert run(True) == expected


def test_additive_local_migration_keeps_legacy_json_and_extra_tables(tmp_path, monkeypatch):
    from sqlalchemy import create_engine, text, inspect
    from tradequest import db as database
    engine = create_engine('sqlite:///' + str(tmp_path / 'legacy.sqlite3'))
    original = '{"source":"authored legacy", "frozen": [1,2,3]}'
    with engine.begin() as c:
        c.execute(text('CREATE TABLE settings(key VARCHAR(100) PRIMARY KEY, value JSON NOT NULL)'))
        c.execute(text('CREATE TABLE untouched_evidence(id INTEGER PRIMARY KEY)'))
        c.execute(text('INSERT INTO settings VALUES (:key, :value)'), {'key': 'pine-script:demo', 'value': original})
    monkeypatch.setattr(database, 'engine', engine)
    monkeypatch.setattr(database, 'DATABASE_URL', 'sqlite:///legacy')
    database.migrate_local(); database.migrate_local()
    with engine.connect() as c:
        row = c.execute(text('SELECT key,value,owner_id FROM settings')).one()
        assert tuple(row) == ('pine-script:demo', original, 'local')
        assert set(inspect(c).get_table_names()) == {'settings', 'untouched_evidence'}
    engine.dispose()
