"""Standalone simulation API; local key or verified per-user cloud identity."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .db import Base, engine, MODE, migrate_local
from .auth import LOCAL_KEY, CLOUD
from . import models
from .replay_routes import router

@asynccontextmanager
async def lifespan(app):
    if not CLOUD:
        migrate_local()
        Base.metadata.create_all(engine)
    # Cloud schema is applied explicitly by the deployment migration, not each cold start.
    yield

app = FastAPI(title='TradeQuest Backtest', lifespan=lifespan)
@app.get('/health')
def health():
    return {'status': 'ok', 'application': 'TradeQuest Backtest', 'mode': MODE,
            'deployment': 'cloud' if CLOUD else 'local', 'simulation_only': True}
app.include_router(router)
