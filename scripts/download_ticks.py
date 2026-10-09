#!/usr/bin/env python3
"""Resumable public daily Dukascopy archives. No broker credentials or orders."""
import argparse
import concurrent.futures
import hashlib
import json
import lzma
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = 'https://www.dukascopy.com/datafeed'

def fetch(item):
    symbol, day, root = item
    key = f'{symbol}/{day.year}/{day.month-1:02}/{day.day:02}_ticks.bi5'
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    empty = path.with_suffix('.empty')
    if empty.exists(): return {'key': key, 'status': 'no_data'}
    for attempt in range(4):
        try:
            if path.exists(): content = path.read_bytes()
            else:
                req = urllib.request.Request(f'{BASE}/{key}', headers={'User-Agent':'TradeQuest-Historical-Practice/1.0'})
                with urllib.request.urlopen(req, timeout=90) as response:
                    content = response.read(64*1024*1024+1)
            if not content:
                empty.write_text('HTTP 200 empty archive\n'); return {'key':key,'status':'no_data'}
            if len(content)>64*1024*1024: raise ValueError('archive size exceeds limit')
            raw = lzma.decompress(content, memlimit=256*1024*1024)
            if len(raw)%20: raise ValueError('invalid 20-byte tick records')
            if not raw:
                empty.write_text('HTTP 200 archive contains no quotes\n');return {'key':key,'status':'no_data'}
            if not path.exists():
                temp=path.with_suffix('.partial');temp.write_bytes(content);temp.replace(path)
            return {'key':key,'status':'ok','ticks':len(raw)//20,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
        except urllib.error.HTTPError as error:
            if error.code==404:
                empty.write_text('HTTP 404: provider has no daily archive\n');return {'key':key,'status':'no_data'}
            if attempt==3:return {'key':key,'status':'error','error':str(error)}
            time.sleep(10*(attempt+1) if error.code==429 else 2*(attempt+1))
        except Exception as error:
            if attempt==3:return {'key':key,'status':'error','error':str(error)}
            time.sleep(2*(attempt+1))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--symbols',nargs='+',choices=['BTCUSD','XAUUSD'],default=['BTCUSD','XAUUSD'])
    parser.add_argument('--year',type=int,default=2025)
    parser.add_argument('--workers',type=int,choices=range(1,9),default=4)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'data'/'tick-archives')
    args=parser.parse_args()
    if not 2004<=args.year<datetime.now(timezone.utc).year:parser.error('Use a complete past calendar year')
    start=datetime(args.year,1,1,tzinfo=timezone.utc);end=datetime(args.year+1,1,1,tzinfo=timezone.utc)
    days=[start+timedelta(days=i) for i in range((end-start).days)]
    jobs=[(symbol,day,args.output) for symbol in args.symbols for day in days]
    records=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for result in pool.map(fetch,jobs):
            records.append(result)
            if len(records)%10==0 or result['status']=='error':print(f"{len(records)}/{len(jobs)} days checked; {sum(x.get('ticks',0) for x in records):,} ticks; errors {sum(x['status']=='error' for x in records)}",flush=True)
            if len(records)%10==0:
                args.output.mkdir(parents=True,exist_ok=True)
                temp=args.output/f'{args.year}-download.partial';temp.write_text(json.dumps({'source':BASE,'year':args.year,'complete':False,'days':records}));temp.replace(args.output/f'{args.year}-download.json')
    manifest={'source':BASE,'year':args.year,'symbols':args.symbols,'complete':all(x['status']!='error' for x in records),'days':records}
    (args.output/f'{args.year}-download.json').write_text(json.dumps(manifest,indent=2))
    print('FINISHED',json.dumps({k:v for k,v in manifest.items() if k!='days'}),flush=True)
    if not manifest['complete']:raise SystemExit(1)

if __name__=='__main__':main()
