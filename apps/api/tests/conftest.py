import os,tempfile
os.environ['TQ_DATA_DIR']=tempfile.mkdtemp(prefix='backtest-pytest-')
os.environ['TQ_MODE']='demo'
import pytest
from fastapi.testclient import TestClient
from tradequest.main import app,LOCAL_KEY
from tradequest.db import Base,engine,SessionLocal
@pytest.fixture(autouse=True)
def fresh_db():
 Base.metadata.drop_all(engine);Base.metadata.create_all(engine)
 yield
@pytest.fixture
def client():
 with TestClient(app) as c:
  c.headers['X-TradeQuest-Local']=LOCAL_KEY
  yield c
@pytest.fixture
def db():
 with SessionLocal() as s:yield s
