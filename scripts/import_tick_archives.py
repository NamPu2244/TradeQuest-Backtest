#!/usr/bin/env python3
"""Build immutable quote stores from checked daily archives; register practice datasets."""
import argparse
import hashlib
import json
import lzma
import math
import sqlite3
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps'/'api'))
from tradequest.db import DATA,SessionLocal
from tradequest.models import ReplayDataset
from tradequest.tick_store import RECORD,INTERVALS

# Explicit scales from Dukascopy-node instrument metadata, cross-checked against
# provider raw quotes on 2025-01-02. Never use an FX default for BTC/gold.
SCALES={'BTCUSD':10,'XAUUSD':1000}
SCALE_SOURCE='https://github.com/Leo4815162342/dukascopy-node/blob/master/src/utils/instrument-meta-data/generated/raw-meta-data-2026-07-13.json'


def build_store(root,records,output,symbol,year):
    output.mkdir(parents=True,exist_ok=True)
    binary=output/'ticks.partial';index=output/'bars.partial'
    if index.exists():index.unlink()
    count=0;first_time=None;last_time=None;minute=None;minute_rows=[]
    digest=hashlib.sha256()
    def finish_minute():
        if minute is not None:minute_rows.append(tuple(minute))
    with sqlite3.connect(index) as db, binary.open('wb') as file:
        db.execute('CREATE TABLE minutes(time INTEGER PRIMARY KEY,open REAL,high REAL,low REAL,close REAL,volume INTEGER,first_idx INTEGER,last_idx INTEGER)')
        for record in records:
            if record['status']!='ok':continue
            key=record['key'];parts=key.split('/');day=datetime(int(parts[1]),int(parts[2])+1,int(parts[3][:2]),tzinfo=timezone.utc)
            base=int(day.timestamp()*1000);content=(root/key).read_bytes()
            if hashlib.sha256(content).hexdigest()!=record['sha256']:raise ValueError(f'archive checksum mismatch: {key}')
            raw=lzma.decompress(content,memlimit=256*1024*1024)
            previous_ms=-1
            for ms,ask_int,bid_int,ask_volume,bid_volume in struct.iter_unpack('>IIIff',raw):
                bid=bid_int/SCALES[symbol];ask=ask_int/SCALES[symbol];stamp=base+ms
                if ms>=86400000 or ms<previous_ms or last_time is not None and stamp<last_time:raise ValueError(f'non-chronological timestamp: {key}')
                if not all(math.isfinite(v) for v in (bid,ask,ask_volume,bid_volume)) or not 0<bid<=ask or min(ask_volume,bid_volume)<0:raise ValueError(f'invalid quote: {key}')
                previous_ms=ms
                data=RECORD.pack(stamp,bid,ask);file.write(data);digest.update(data)
                bucket=stamp//60000*60
                if minute is None or minute[0]!=bucket:
                    finish_minute();minute=[bucket,bid,bid,bid,bid,1,count,count]
                else:
                    minute[2]=max(minute[2],bid);minute[3]=min(minute[3],bid);minute[4]=bid;minute[5]+=1;minute[7]=count
                first_time=stamp if first_time is None else first_time;last_time=stamp;count+=1
            if len(minute_rows)>10000:
                db.executemany('INSERT INTO minutes VALUES(?,?,?,?,?,?,?,?)',minute_rows);minute_rows=[];db.commit()
            print(f'{symbol} {key}: {count:,} quotes indexed',flush=True)
        finish_minute();db.executemany('INSERT INTO minutes VALUES(?,?,?,?,?,?,?,?)',minute_rows)
        if count==0:raise ValueError('No tick data')
        db.execute('CREATE TABLE frames(tf TEXT,time INTEGER,open REAL,high REAL,low REAL,close REAL,volume INTEGER,first_idx INTEGER,last_idx INTEGER,PRIMARY KEY(tf,time)) WITHOUT ROWID')
        # Aggregate minute indexes once; no year-sized JSON or client downloads.
        for tf,interval in INTERVALS.items():
            rows=[];frame=None
            for r in db.execute('SELECT * FROM minutes ORDER BY time'):
                stamp=r[0]//interval*interval
                if frame is None or stamp!=frame[1]:
                    if frame is not None:rows.append(tuple(frame))
                    frame=[tf,stamp,*r[1:]]
                else:
                    frame[3]=max(frame[3],r[2]);frame[4]=min(frame[4],r[3]);frame[5]=r[4];frame[6]+=r[5];frame[8]=r[7]
            if frame is not None:rows.append(tuple(frame))
            db.executemany('INSERT INTO frames VALUES(?,?,?,?,?,?,?,?,?)',rows)
        db.commit()
        bar_count=db.execute("SELECT COUNT(*) FROM frames WHERE tf='M5'").fetchone()[0]
        gaps=db.execute('SELECT COUNT(*) FROM (SELECT time-LAG(time) OVER(ORDER BY time) AS gap FROM minutes) WHERE gap>60').fetchone()[0]
    binary.replace(output/'ticks.bin');index.replace(output/'bars.sqlite3')
    manifest={'storage':'ticks-v1','store_id':output.name,'tick_count':count,'count':bar_count,'first_time':first_time//1000,'last_time':last_time//1000,'first_time_ms':first_time,'last_time_ms':last_time,'gaps':gaps,'year':year,'provider':'Dukascopy','source_url':'https://www.dukascopy.com/wiki/en/development/data-export/','quote_basis':'BID_ASK','volume_basis':'quote_count','timeframes':list(INTERVALS),'sha256':digest.hexdigest(),'price_scale':SCALES[symbol],'scale_source':SCALE_SOURCE,'calendar_days_checked':len(records),'days_with_quotes':sum(x['status']=='ok' for x in records),'no_data_days':[x['key'] for x in records if x['status']=='no_data'],'complete_calendar_scan':len(records)==(datetime(year+1,1,1)-datetime(year,1,1)).days}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2))
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--year',type=int,default=2025);parser.add_argument('--archives',type=Path,default=DATA/'tick-archives');parser.add_argument('--symbols',nargs='+',choices=list(SCALES),default=list(SCALES));parser.add_argument('--manifest',type=Path);args=parser.parse_args()
    download=json.loads((args.manifest or args.archives/f'{args.year}-download.json').read_text())
    for symbol in args.symbols:
        records=[x for x in download['days'] if x['key'].startswith(symbol+'/')];records.sort(key=lambda x:x['key'])
        expected=(datetime(args.year+1,1,1)-datetime(args.year,1,1)).days
        if len(records)!=expected or any(x['status']=='error' for x in records):raise SystemExit(f'{symbol}: calendar scan not complete; rerun downloader')
        output=DATA/'market-data'/f'dukascopy-{symbol.lower()}-{args.year}'
        if (output/'manifest.json').exists():manifest=json.loads((output/'manifest.json').read_text())
        else:manifest=build_store(args.archives,records,output,symbol,args.year)
        with SessionLocal() as db:
            identifier=output.name
            existing=db.get(ReplayDataset,identifier)
            if existing:
                if existing.metadata_json.get('sha256')!=manifest['sha256']:raise SystemExit('Existing dataset differs; create a new immutable store version')
            else:
                db.add(ReplayDataset(id=identifier,name=f'{symbol} · 2025 · Real ticks · Dukascopy',symbol=symbol,timeframe='M5',source='DUKASCOPY_REAL_TICKS',synthetic=False,bars=[],metadata_json=manifest));db.commit()
        print('REGISTERED',identifier,manifest['tick_count'],flush=True)

if __name__=='__main__':main()
