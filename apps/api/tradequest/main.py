"""Local-only standalone simulation API. No accounts, journal or broker routes."""
import hmac,os,secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI,Depends,Header,HTTPException
from .db import DATA,Base,engine,MODE
from . import models
from .replay_routes import router

def secret_file():
    path=DATA/'local.key'
    try:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(48))
    except FileExistsError:pass
    return path.read_text().strip()
LOCAL_KEY=os.getenv('TQ_LOCAL_KEY') or secret_file()
def local_auth(x_tradequest_local:str=Header(default='')):
    if not hmac.compare_digest(x_tradequest_local,LOCAL_KEY):raise HTTPException(401,'Open the local frontend')
@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(engine)
    yield
app=FastAPI(title='TradeQuest Backtest',lifespan=lifespan)
@app.get('/health')
def health():return {'status':'ok','application':'TradeQuest Backtest','mode':MODE,'simulation_only':True}
app.include_router(router,dependencies=[Depends(local_auth)])
