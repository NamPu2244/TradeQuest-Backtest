#!/usr/bin/env python3
"""Small deterministic quote fixture exclusively for isolated browser test state."""
import hashlib
import lzma
import struct
from import_tick_archives import build_store
from tradequest.db import DATA,SessionLocal,MODE
from tradequest.models import ReplayDataset
if MODE!='demo' or DATA.name not in ('e2e','e2e-dev'):raise SystemExit('Refusing to seed outside isolated browser-test data')
root=DATA/'test-archives';key='XAUUSD/2025/00/02_ticks.bi5';path=root/key;path.parent.mkdir(parents=True,exist_ok=True)
raw=bytearray()
for minute in range(180):
    for offset,price in [(0,100),(15000,101),(15000,110),(45000,95)]:
        raw.extend(struct.pack('>IIIff',minute*60000+offset,(price+1)*1000,price*1000,.001,.001))
content=lzma.compress(bytes(raw));path.write_bytes(content)
metadata=build_store(root,[{'key':key,'status':'ok','sha256':hashlib.sha256(content).hexdigest()}],DATA/'market-data'/'demo-tick-e2e','XAUUSD',2025)
metadata.update(provider='DEMO DATA',complete_calendar_scan=False)
with SessionLocal() as db:
    db.add(ReplayDataset(id='demo-tick-e2e',name='DEMO DATA · synthetic ticks',symbol='DEMO-TICK',timeframe='M5',source='SYNTHETIC_TEST_TICKS',synthetic=True,bars=[],metadata_json=metadata));db.commit()
