"""Immutable on-disk quotes, indexed minute bars and causal timeframe views.
Ticks stay on the server. Public responses contain only the revealed quote/window.
"""
import mmap
import re
import secrets
import sqlite3
import struct
from contextlib import contextmanager
from fastapi import HTTPException
from .db import DATA

INTERVALS = {'M1':60,'M5':300,'M15':900,'M30':1800,'H1':3600,'H4':14400,'D1':86400}
RECORD=struct.Struct('<qdd')
WINDOW=2000


def is_tick(dataset):
    return dataset.metadata_json.get('storage')=='ticks-v1'


def folder(dataset):
    key=dataset.metadata_json.get('store_id','')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',key):raise HTTPException(409,'ชุดข้อมูล tick ไม่ถูกต้อง')
    path=(DATA/'market-data'/key).resolve()
    if path.parent!=(DATA/'market-data').resolve():raise HTTPException(409,'ชุดข้อมูล tick ไม่ถูกต้อง')
    if not (path/'ticks.bin').is_file() or not (path/'bars.sqlite3').is_file():raise HTTPException(409,'ไม่พบไฟล์ tick ในเครื่องนี้ กรุณานำเข้าข้อมูลก่อน')
    return path


@contextmanager
def quotes(dataset):
    path=folder(dataset)
    with (path/'ticks.bin').open('rb') as file:
        if file.seek(0,2)!=dataset.metadata_json['tick_count']*RECORD.size:raise HTTPException(409,'ไฟล์ tick มีขนาดเปลี่ยนไป')
        with mmap.mmap(file.fileno(),0,access=mmap.ACCESS_READ) as mapped:yield mapped


def tick_at(mapped,index):
    stamp,bid,ask=RECORD.unpack_from(mapped,index*RECORD.size)
    return {'time_ms':stamp,'bid':bid,'ask':ask}


def find_index(mapped,stamp,upper=False):
    """Lower bound; upper=True returns last quote <= stamp, retaining duplicate timestamps."""
    low=0;high=len(mapped)//RECORD.size
    while low<high:
        mid=(low+high)//2;time=RECORD.unpack_from(mapped,mid*RECORD.size)[0]
        if time<stamp or upper and time==stamp:low=mid+1
        else:high=mid
    return low-1 if upper else low


def bar_row(row):
    return dict(zip(('time','open','high','low','close','volume'),row[:6]))


def merge_bars(bars,interval):
    result=[]
    for b in bars:
        stamp=b['time']//interval*interval
        if not result or result[-1]['time']!=stamp:result.append({**b,'time':stamp})
        else:
            r=result[-1];r['high']=max(r['high'],b['high']);r['low']=min(r['low'],b['low']);r['close']=b['close'];r['volume']+=b['volume']
    return result


def view(dataset,cursor,timeframe):
    interval=INTERVALS[timeframe]
    with quotes(dataset) as mapped:
        quote=tick_at(mapped,cursor);seconds=quote['time_ms']//1000
        bucket=seconds//interval*interval;minute=seconds//60*60
        with sqlite3.connect((folder(dataset)/'bars.sqlite3').as_uri()+'?mode=ro',uri=True) as db:
            # Completed buckets only: full OHLC of the current bucket is never read.
            rows=db.execute('SELECT time,open,high,low,close,volume FROM frames WHERE tf=? AND time<? ORDER BY time DESC LIMIT ?', (timeframe,bucket,WINDOW-1)).fetchall()
            bars=[bar_row(r) for r in reversed(rows)]
            complete=db.execute('SELECT time,open,high,low,close,volume FROM minutes WHERE time>=? AND time<? ORDER BY time',(bucket,minute)).fetchall()
            first=db.execute('SELECT first_idx FROM minutes WHERE time=?',(minute,)).fetchone()
            if not first:raise HTTPException(409,'ดัชนี tick ไม่ครบ')
        partial=None
        for index in range(first[0],cursor+1):
            tick=tick_at(mapped,index);price=tick['bid']
            if partial is None:partial={'time':minute,'open':price,'high':price,'low':price,'close':price,'volume':0}
            partial['high']=max(partial['high'],price);partial['low']=min(partial['low'],price);partial['close']=price;partial['volume']+=1
        bars.extend(merge_bars([*(bar_row(r) for r in complete),partial],interval))
    return bars,quote


def seed_cursor(dataset,start_time=None,end_time=None,timeframe='M5',random_start=False):
    with quotes(dataset) as mapped:
        end=dataset.metadata_json['tick_count']-1 if end_time is None else find_index(mapped,end_time*1000,upper=True)
        if start_time is None and random_start:
            with sqlite3.connect((folder(dataset)/'bars.sqlite3').as_uri()+'?mode=ro',uri=True) as db:
                count=db.execute('SELECT count(*) FROM frames WHERE tf=? AND last_idx<?',(timeframe,end)).fetchone()[0]
                low=249 if count>=520 else 19
                high=count-21 if count-low>=40 else count-1
                if high<low:raise HTTPException(422,'ต้องมีอย่างน้อย 20 แท่งก่อนเริ่มและข้อมูลสำหรับฝึกต่อ')
                offset=low+secrets.randbelow(high-low+1)
                cursor=db.execute('SELECT last_idx FROM frames WHERE tf=? AND last_idx<? ORDER BY time LIMIT 1 OFFSET ?',(timeframe,end,offset)).fetchone()[0]
        elif start_time is None:
            with sqlite3.connect((folder(dataset)/'bars.sqlite3').as_uri()+'?mode=ro',uri=True) as db:
                row=db.execute('SELECT last_idx FROM frames WHERE tf=? ORDER BY time LIMIT 1 OFFSET 249',(timeframe,)).fetchone()
                if row is None:row=db.execute('SELECT last_idx FROM frames WHERE tf=? ORDER BY time LIMIT 1 OFFSET 19',(timeframe,)).fetchone()
            if row is None:raise HTTPException(422,'ข้อมูลก่อนเริ่มต้องมีอย่างน้อย 20 แท่ง')
            cursor=row[0]
        else:cursor=find_index(mapped,start_time*1000,upper=True)
        end=dataset.metadata_json['tick_count']-1 if end_time is None else find_index(mapped,end_time*1000,upper=True)
        if not 0<=cursor<end<dataset.metadata_json['tick_count']:raise HTTPException(422,'เวลาเริ่ม/จบอยู่นอกข้อมูล tick')
    if len(view(dataset,cursor,timeframe)[0])<20:raise HTTPException(422,'เวลาเริ่มต้องมีกราฟย้อนหลังอย่างน้อย 20 แท่ง')
    return cursor,end


def process_tick(trade,tick,config,index):
    """Paper fills against actual bid/ask, in source sequence, including same-ms ticks."""
    from .replay import close_trade
    long=trade.side=='BUY';entry=tick['ask'] if long else tick['bid'];mark=tick['bid'] if long else tick['ask']
    if trade.status=='pending':
        if trade.order_type=='LIMIT' and (entry>trade.requested_entry if long else entry<trade.requested_entry):return
        if trade.order_type=='STOP' and (entry<trade.requested_entry if long else entry>trade.requested_entry):return
        if not (trade.stop_price<entry<trade.target_price if long else trade.target_price<entry<trade.stop_price):
            trade.status='cancelled';trade.exit_reason='ราคาข้ามกรอบ SL/TP';return
        trade.entry_price=entry;trade.entry_time=tick['time_ms']//1000;trade.status='open'
        trade.decision={**trade.decision,'entry_time_ms':tick['time_ms'],'entry_tick_index':index,'entry_bid':tick['bid'],'entry_ask':tick['ask']}
    if trade.status!='open':return
    sl=mark<=trade.stop_price if long else mark>=trade.stop_price
    tp=mark>=trade.target_price if long else mark<=trade.target_price
    if sl or tp:
        # Stop gaps use the observed quote; a TP limit fills at target (conservative).
        close_trade(trade,mark if sl else trade.target_price,tick['time_ms']//1000,'SL' if sl else 'TP',config['commission_r'])
        trade.decision={**trade.decision,'exit_time_ms':tick['time_ms'],'exit_tick_index':index,'exit_bid':tick['bid'],'exit_ask':tick['ask']}


def advance(dataset,session,trade,milliseconds=None,one_tick=False,bar=False):
    trades=trade if isinstance(trade,list) else ([trade] if trade else [])
    interval=INTERVALS[session.config_json.get('timeframe','M5')]
    with quotes(dataset) as mapped:
        current=tick_at(mapped,session.cursor)
        clock=session.config_json.get('replay_clock_ms',current['time_ms'])
        end_clock=tick_at(mapped,session.end_cursor)['time_ms']
        if one_tick:
            target=min(session.end_cursor,session.cursor+1)
            target_clock=tick_at(mapped,target)['time_ms']
        elif bar:
            stamp=(clock//(interval*1000)+1)*interval*1000
            target=min(session.end_cursor,find_index(mapped,stamp))
            target_clock=tick_at(mapped,target)['time_ms']
        else:
            target_clock=min(end_clock,clock+milliseconds)
            target=min(session.end_cursor,find_index(mapped,target_clock,upper=True))
            # Ordinary quote pauses consume simulated time. Only long market gaps
            # are skipped; a quiet 1-second feed must not run at four ticks/second.
            if target==session.cursor and session.cursor<session.end_cursor:
                next_tick=tick_at(mapped,session.cursor+1)
                if next_tick['time_ms']-current['time_ms']>=900000:
                    target=session.cursor+1;target_clock=next_tick['time_ms']
        capped=target if bar else min(target,session.cursor+100000)
        if capped<target:target_clock=tick_at(mapped,capped)['time_ms']
        if not trades:session.cursor=capped
        for index in range(session.cursor+1,capped+1) if trades else ():
            session.cursor=index
            tick=tick_at(mapped,index)
            ended=False
            for item in trades:
                if item.status not in ('pending','open'):continue
                process_tick(item,tick,session.config_json,index)
                ended=ended or item.status in ('closed','cancelled')
            if ended:
                target_clock=tick['time_ms'];break
        session.config_json={**session.config_json,'replay_clock_ms':target_clock}
