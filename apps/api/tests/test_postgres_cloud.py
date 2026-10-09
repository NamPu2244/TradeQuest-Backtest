"""Run on isolated PostgreSQL only via scripts/test_postgres.py, never a real Supabase URL."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
import os
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError
from tradequest import db as database, replay_routes
from tradequest.auth import Principal, get_principal
from tradequest.db import get_db
from tradequest.main import app
from test_tick_replay import tick_dataset

URL = os.getenv('TQ_TEST_POSTGRES_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Run scripts/test_postgres.py for isolated PostgreSQL/RLS proof')
A, B = str(uuid4()), str(uuid4())
BASE='/api/v1/replay'

@pytest.fixture
def pg(monkeypatch):
    assert URL and ('host=%2F' in URL or 'host=/' in URL), 'Only isolated Unix socket PostgreSQL permitted'
    engine = create_engine(URL.replace('postgresql://', 'postgresql+psycopg://', 1))
    with engine.begin() as c:
        for role in ('anon', 'authenticated'):
            c.execute(text(f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {role} NOLOGIN; END IF; END $$;"))
        c.execute(text('CREATE SCHEMA IF NOT EXISTS auth'))
        c.execute(text("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$"))
        c.execute(text('GRANT USAGE ON SCHEMA auth TO authenticated'))
    sql = (Path(__file__).resolve().parents[3] / 'docs/cloud-schema.sql').read_text()
    # Execute idempotently twice, preserving existing rows/policies.
    for _ in range(2):
        with engine.connect() as c:
            c.exec_driver_sql(sql); c.commit()
    with engine.begin() as c:
        for table in ('replay_trades', 'replay_sessions', 'settings', 'replay_datasets'):
            c.execute(text(f'DELETE FROM {table}'))  # isolated temporary server only
    monkeypatch.setattr(database, 'CLOUD', True)
    user = [A]
    def owned():
        with Session(engine, expire_on_commit=False) as db:
            db.info['owner_id'] = user[0]; yield db
    app.dependency_overrides[get_db] = owned
    app.dependency_overrides[get_principal] = lambda: Principal(user[0])
    try:
        with TestClient(app) as client: yield engine, user, client
    finally:
        app.dependency_overrides.clear(); engine.dispose()


def test_postgres_rls_works_for_raw_sql_after_commit_and_owns_parent_references(pg):
    engine, user, client = pg
    a = client.post(BASE+'/datasets/demo').json()
    assert 'id' in a, a
    user[0] = B
    b = client.post(BASE+'/datasets/demo').json()
    assert a['id'] != b['id']
    assert [x['id'] for x in client.get(BASE+'/datasets').json()] == [b['id']]
    with Session(engine) as db:
        db.info['owner_id'] = A
        # Raw SQL bypasses the ORM criteria: PostgreSQL RLS must still hide B.
        assert db.scalars(text('SELECT id FROM replay_datasets')).all() == [a['id']]
        assert db.scalar(text('SELECT current_user')) == 'authenticated'
        db.commit()
        assert db.scalar(text('SELECT current_user')) == 'authenticated'
        assert db.scalars(text('SELECT id FROM replay_datasets')).all() == [a['id']]
        with pytest.raises(DBAPIError):
            db.execute(text("INSERT INTO replay_sessions(owner_id,id,dataset_id,name,cursor,end_cursor,revision,status,config_json,drawings,indicators,created_at,updated_at) VALUES (:owner,:id,:foreign,'bad',20,40,0,'active','{}','[]','[]',now(),now())"),
                       {'owner': A, 'id': str(uuid4()), 'foreign': b['id']})
            db.commit()
        db.rollback()
    with engine.begin() as c:
        c.execute(text("INSERT INTO replay_datasets(owner_id,id,name,symbol,timeframe,source,synthetic,bars,metadata_json,created_at) VALUES ('shared','shared-demo','Shared','DEMO','M5','DEMO',true,'[]','{}',now())"))
    with Session(engine) as db:
        db.info['owner_id'] = A
        assert set(db.scalars(text('SELECT id FROM replay_datasets'))) == {a['id'], 'shared-demo'}
        assert db.execute(text("UPDATE replay_datasets SET name='cannot change' WHERE id='shared-demo'")).rowcount == 0
        db.commit()


def test_postgres_stale_revision_is_serialized_without_process_global_lock(pg, monkeypatch):
    engine, user, client = pg
    d = client.post(BASE+'/datasets/demo').json()
    s = client.post(BASE+'/sessions',json={'dataset_id':d['id'],'initial_balance':1000,'target_trades':20,'point_value':1,'goal':'authored race'}).json()
    assert 'id' in s, s
    # Simulate independent serverless instances by removing the in-process mutex.
    monkeypatch.setattr(replay_routes, 'lock', nullcontext())
    def move(_): return client.post(BASE+'/sessions/'+s['id']+'/step',json={'revision':s['revision']}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(move,range(2)))
    assert sorted(results) == [200,409]
    final = client.get(BASE+'/sessions/'+s['id']).json()
    assert final['revision'] == s['revision']+1
    assert final['cursor'] == s['cursor']+1


def test_cloud_copy_preserves_authored_frozen_state_and_refuses_overwrite(pg, tmp_path, monkeypatch):
    import importlib.util, json, sqlite3
    from tradequest.db import Base
    from tradequest.models import ReplayDataset, ReplaySession, Setting
    engine, user, client = pg
    with engine.begin() as c:
        c.execute(text('CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY)'))
        c.execute(text('INSERT INTO auth.users VALUES (:id) ON CONFLICT DO NOTHING'), {'id': A})
    source = tmp_path / 'local.sqlite3'
    local = create_engine('sqlite:///' + str(source))
    Base.metadata.create_all(local)
    with Session(local) as db:
        d = ReplayDataset(id='authored-local', name='Local authored', symbol='DEMO', timeframe='M5', source='AUTHORED', synthetic=True, bars=[], metadata_json={})
        db.add(d); db.flush()
        db.add(ReplaySession(id='frozen-local', dataset_id=d.id, name='Frozen authored', cursor=25, end_cursor=80, revision=7,
                            config_json={'workspace':'backtest','initial_balance':1000}, drawings=[{'id':'exact','kind':'trend','points':[]}], indicators=[]))
        db.add(Setting(key='pine-script:authored', value={'versions':[{'source':'authored source','version':3}]}))
        db.commit()
    local.dispose(); before = source.read_bytes()
    script = Path(__file__).resolve().parents[3] / 'scripts/import_cloud_state.py'
    spec = importlib.util.spec_from_file_location('cloud_copy', script); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    monkeypatch.setenv('DATABASE_URL', URL)
    counts = module.copy_state(source, A)
    assert counts['replay_sessions'] == 1 and counts['settings'] == 1
    assert source.read_bytes() == before
    with Session(engine) as db:
        db.info['owner_id'] = A
        s=db.get(ReplaySession,'frozen-local'); assert s.revision == 7 and s.cursor == 25 and s.drawings[0]['id'] == 'exact'
        assert db.get(Setting,'pine-script:authored').value['versions'][0]['source'] == 'authored source'
    with pytest.raises(ValueError, match='refusing to overwrite'): module.copy_state(source,A)
    assert source.read_bytes() == before


def test_market_publisher_uploads_verified_immutable_objects_and_registers_shared_catalog(pg, tick_dataset, tmp_path, monkeypatch):
    import importlib.util, shutil
    from types import SimpleNamespace
    from botocore.exceptions import ClientError
    from tradequest import tick_store
    from tradequest.db import Base
    from tradequest.models import ReplayDataset
    engine, _, _ = pg
    script=Path(__file__).resolve().parents[3]/'scripts/publish_market_cloud.py'
    spec=importlib.util.spec_from_file_location('market_publish',script);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    source=tmp_path/'data';source.mkdir()
    shutil.copytree(tick_store.folder(tick_dataset),source/'market-data'/tick_dataset.metadata_json['store_id'])
    local=create_engine('sqlite:///'+str(source/'backtest.sqlite3'));Base.metadata.create_all(local)
    with Session(local) as db:
        values={c.name:getattr(tick_dataset,c.name) for c in ReplayDataset.__table__.columns}
        db.add(ReplayDataset(**values));db.commit()
    local.dispose()
    objects={};writes=[]
    def head_object(Bucket, Key):
        if Key not in objects:raise ClientError({'Error':{'Code':'404'}},'HeadObject')
        value=objects[Key]
        return {'Metadata':value['metadata'],'ContentLength':len(value['bytes']),'ETag':'"authored-fixture"'}
    def upload_file(path,bucket,key,ExtraArgs):
        assert key not in objects
        objects[key]={'bytes':Path(path).read_bytes(),'metadata':ExtraArgs['Metadata']};writes.append(key)
    fake=SimpleNamespace(head_object=head_object,upload_file=upload_file,exceptions=SimpleNamespace(ClientError=ClientError))
    monkeypatch.setattr(module,'storage',lambda:fake);monkeypatch.setenv('R2_BUCKET','private-authored');monkeypatch.setenv('DATABASE_URL',URL)
    module.publish(source)
    assert len(writes)==8
    with Session(engine) as db:
        d=db.get(ReplayDataset,tick_dataset.id)
        assert d.owner_id=='shared' and d.metadata_json['cloud_ticks']['ticks']['sha256']==tick_dataset.metadata_json['sha256']
    module.publish(source);assert len(writes)==8  # resumable, no overwrites/repeated uploads
    first=writes[0];objects[first]['metadata']={'sha256':'changed'}
    with pytest.raises(ValueError,match='refusing overwrite'):module.publish(source)


def test_direct_auth_token_without_api_invitation_gate_cannot_access_tables(pg):
    engine, user, client = pg
    d=client.post(BASE+'/datasets/demo').json()
    with engine.begin() as c:
        # Supabase REST receives an ordinary authenticated JWT, not the verified API's transaction gate.
        c.execute(text("SELECT set_config('request.jwt.claims', :claims, true)"),{'claims':'{"sub":"'+A+'","role":"authenticated"}'})
        c.execute(text('SET LOCAL ROLE authenticated'))
        assert c.execute(text('SELECT id FROM replay_datasets')).all()==[]
        assert c.execute(text('UPDATE replay_datasets SET name=\'denied\' WHERE id=:id'),{'id':d['id']}).rowcount==0
