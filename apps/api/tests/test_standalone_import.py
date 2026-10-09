import importlib.util
import json
from pathlib import Path
import sqlite3
from sqlalchemy import create_engine
from tradequest.db import Base
import pytest


def test_import_is_backtest_only_preserves_frozen_notes_and_never_overwrites(tmp_path):
    script=Path(__file__).resolve().parents[3]/'scripts/import_tradequest.py'
    spec=importlib.util.spec_from_file_location('standalone_import',script)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    source=tmp_path/'source';(source/'data').mkdir(parents=True)
    source_db=source/'data/tradequest.sqlite3';engine=create_engine('sqlite:///'+str(source_db));Base.metadata.create_all(engine);engine.dispose()
    with sqlite3.connect(source_db) as db:
        # Build the previous schema to prove imports from journals without owner columns.
        for table in Base.metadata.tables:
            db.execute(f'DROP INDEX ix_{table}_owner_id')
            db.execute(f'ALTER TABLE {table} DROP COLUMN owner_id')
        db.execute('CREATE TABLE private_journal (secret TEXT)')
        db.execute('INSERT INTO private_journal VALUES (?)',('NOT_FOR_BACKTEST',))
        db.execute('INSERT INTO settings (key,value) VALUES (?,?)',('account-secret',json.dumps({'secret':'NOT_FOR_BACKTEST'})))
        db.execute('INSERT INTO settings (key,value) VALUES (?,?)',('pine-script:demo',json.dumps({'source':'original authored indicator'})))
        db.execute('INSERT INTO replay_datasets VALUES (?,?,?,?,?,?,?,?,?)',('data','DEMO','TEST','M5','DEMO',1,'[]','{}','2026-01-01'))
        for id,config in [('backtest',{'workspace':'backtest'}),('legacy',{'workspace':'legacy'})]:
            db.execute('INSERT INTO replay_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',(id,'data','DEMO',30,90,4,'active',json.dumps(config),'[]','[]','2026-01-01','2026-01-01'))
        db.commit()
    before=source_db.read_bytes()
    destination=tmp_path/'new-data';summary=module.import_local(source,destination)
    assert summary['replay_sessions']==1 and summary['settings']==1
    assert source_db.read_bytes()==before
    with sqlite3.connect(destination/'backtest.sqlite3') as db:
        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables==set(Base.metadata.tables)
        assert db.execute('SELECT id FROM replay_sessions').fetchall()==[('backtest',)]
        assert db.execute('SELECT key FROM settings').fetchall()==[('pine-script:demo',)]
        assert db.execute('SELECT revision FROM replay_sessions').fetchone()[0]==4
    with pytest.raises(ValueError,match='already contains data'):module.import_local(source,destination)
    assert source_db.read_bytes()==before
