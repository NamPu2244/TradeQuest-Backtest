import os
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session, with_loader_criteria
from sqlalchemy.pool import NullPool
from fastapi import Depends, HTTPException
from .auth import CLOUD, LOCAL, SHARED, get_principal

ROOT = Path(__file__).resolve().parents[3]
DATA = Path(os.getenv("TQ_DATA_DIR", ROOT / "data")).resolve()
if not CLOUD:
    DATA.mkdir(parents=True, exist_ok=True)
MODE = os.getenv("TQ_MODE", "real")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DATA / ('demo.sqlite3' if MODE == 'demo' else 'backtest.sqlite3')}",
)
if CLOUD and not DATABASE_URL.startswith(('postgresql://', 'postgresql+psycopg://', 'postgres://')):
    raise RuntimeError('Cloud requires a persistent PostgreSQL DATABASE_URL')
if DATABASE_URL.startswith(('postgresql://', 'postgres://')):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql+psycopg://', 1).replace('postgresql://', 'postgresql+psycopg://', 1)
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30} if DATABASE_URL.startswith("sqlite") else
                 {"prepare_threshold": None, "sslmode": "require"},
    **({"poolclass": NullPool} if CLOUD else {}),
)
if DATABASE_URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def sqlite_config(conn, record):
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")


SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def now():
    return datetime.now(timezone.utc)


def utc(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("Timestamp must include UTC offset")
    return value.astimezone(timezone.utc)


def aware(value):
    return (
        value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value
    )


@event.listens_for(Session, 'do_orm_execute')
def scope_reads(state):
    owner = state.session.info.get('owner_id')
    if not owner:
        return
    from .models import Setting, ReplayDataset, ReplaySession, ReplayTrade
    for model in (Setting, ReplaySession, ReplayTrade):
        state.statement = state.statement.options(with_loader_criteria(model, model.owner_id == owner, include_aliases=True))
    state.statement = state.statement.options(with_loader_criteria(
        ReplayDataset, ReplayDataset.owner_id.in_([owner, SHARED]), include_aliases=True))

@event.listens_for(Session, 'after_begin')
def database_identity(db, transaction, connection):
    owner = db.info.get('owner_id')
    if CLOUD and owner and connection.dialect.name == 'postgresql':
        import json
        connection.execute(text("SELECT set_config('request.jwt.claims', :claims, true)"),
                           {'claims': json.dumps({'sub': owner, 'role': 'authenticated', 'tq_backtest': True})})
        connection.execute(text('SET LOCAL ROLE authenticated'))

@event.listens_for(Session, 'before_flush')
def scope_writes(db, context, instances):
    owner = db.info.get('owner_id')
    if not owner:
        return
    from .models import Setting, ReplayDataset, ReplaySession, ReplayTrade
    for item in db.new | db.dirty | db.deleted:
        if isinstance(item, (Setting, ReplayDataset, ReplaySession, ReplayTrade)):
            if item in db.new:
                if item.owner_id not in (None, owner):
                    raise HTTPException(403, 'Owner mismatch')
                item.owner_id = owner
            elif item.owner_id != owner:
                raise HTTPException(403, 'Read-only dataset or owner mismatch')

def get_db(principal=Depends(get_principal)):
    with SessionLocal() as db:
        db.info['owner_id'] = principal.id
        yield db


def migrate_local():
    # Additive migration; frozen JSON, IDs and trades are untouched.
    from sqlalchemy import inspect, text
    if not DATABASE_URL.startswith('sqlite'):
        return
    with engine.begin() as conn:
        inspector = inspect(conn)
        for table in ('settings', 'replay_datasets', 'replay_sessions', 'replay_trades'):
            if table in inspector.get_table_names() and 'owner_id' not in {c['name'] for c in inspector.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN owner_id VARCHAR(36) NOT NULL DEFAULT 'local'"))
