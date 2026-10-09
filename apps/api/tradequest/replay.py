"""Manual historical practice. Only revealed candles may affect decisions/results."""
import csv
import io
import math
import random
from datetime import datetime, timezone, timedelta
from copy import deepcopy
from fastapi import HTTPException
from sqlalchemy import select
from .models import ReplayDataset, ReplayTrade
from . import tick_store

INTERVALS = tick_store.INTERVALS


def validate_bars(bars, timeframe):
    if not 30 <= len(bars) <= 50000:
        raise HTTPException(422,"ต้องมีแท่งปิด 30–50,000 แท่ง")
    last=0
    step=INTERVALS[timeframe]
    for b in bars:
        if not all(math.isfinite(float(b[k])) for k in ["time","open","high","low","close","volume"]):
            raise HTTPException(422,"ราคาหรือเวลาไม่ใช่ตัวเลขที่ใช้ได้")
        if b["time"] <= last or (b["time"]-bars[0]["time"]) % step or b["time"]+step > datetime.now(timezone.utc).timestamp():
            raise HTTPException(422,"แท่งต้องปิดแล้ว เวลาเรียงไม่ซ้ำ และตรง timeframe (UTC)")
        if min(b["open"],b["high"],b["low"],b["close"])<=0 or b["high"]<max(b["open"],b["close"]) or b["low"]>min(b["open"],b["close"]) or b["high"]<b["low"] or b["volume"]<0:
            raise HTTPException(422,"OHLC หรือ volume ไม่ถูกต้อง")
        last=b["time"]
    return {"count":len(bars),"first_time":bars[0]["time"],"last_time":bars[-1]["time"],"gaps":sum(bars[i]["time"]-bars[i-1]["time"]!=step for i in range(1,len(bars)))}


def parse_csv(content, timeframe, offset):
    try:
        text=content.decode("utf-16" if content.startswith((b"\xff\xfe",b"\xfe\xff")) else "utf-8-sig")
        reader=csv.DictReader(io.StringIO(text),delimiter=csv.Sniffer().sniff(text[:8192],delimiters=",;\t").delimiter)
        bars=[]
        for raw in reader:
            row={k.strip().strip('<>').lower():v.strip() for k,v in raw.items() if k and v is not None}
            if "date" in row:
                stamp=datetime.strptime(row['date']+' '+row['time'],"%Y.%m.%d %H:%M:%S" if len(row['time'])>5 else "%Y.%m.%d %H:%M")
            else:
                value=row["time"]
                try: stamp=datetime.fromtimestamp(float(value),timezone.utc)
                except ValueError: stamp=datetime.fromisoformat(value.replace('Z','+00:00'))
            if stamp.tzinfo is None:stamp=stamp.replace(tzinfo=timezone(timedelta(minutes=offset)))
            bars.append({"time":int(stamp.timestamp()),**{k:float(row[k]) for k in ['open','high','low','close']},"volume":float(row.get('tickvol') or row.get('volume') or row.get('vol') or 0)})
        return bars,validate_bars(bars,timeframe)
    except HTTPException:raise
    except (ValueError,KeyError,TypeError,OverflowError,csv.Error,UnicodeError):
        raise HTTPException(422,"CSV ต้องมี time/open/high/low/close หรือคอลัมน์ Export Bars ของ MT5 · ตรวจเวลาและ UTC offset")


def demo_bars():
    rng=random.Random(949)
    price=100.;bars=[]
    for i in range(1200):
        opening=price
        price=max(10,price+rng.uniform(-.65,.65)+.08*math.sin(i/35))
        bars.append({"time":1767225600+i*300,"open":round(opening,5),"high":round(max(opening,price)+rng.uniform(.03,.45),5),"low":round(min(opening,price)-rng.uniform(.03,.45),5),"close":round(price,5),"volume":rng.randint(50,500)})
    return bars


def dataset_dict(d):
    return {"id":d.id,"name":d.name,"symbol":d.symbol,"timeframe":d.timeframe,"source":d.source,"synthetic":d.synthetic,**d.metadata_json}



def close_trade(t, price, stamp, reason, fee):
    net=((price-t.entry_price)*(1 if t.side=='BUY' else -1))/abs(t.entry_price-t.stop_price)-fee
    if (t.decision or {}).get('workspace')=='backtest':
        lot=t.decision['lot'];remaining=remaining_lot(t)
        net=(sum(x['net_r']*x['lot'] for x in t.decision.get('partial_exits',[]))+net*remaining)/lot
        t.decision={**t.decision,'final_exit_lot':remaining}
    t.exit_price=price;t.exit_time=stamp;t.exit_reason=reason;t.status='closed';t.net_r=net


def process_bar(t, b, config):
    spread=config['spread'];long=t.side=='BUY'
    intrabar_limit=False
    opening=b['open']+(0 if long else spread)
    low=b['low']+(0 if long else spread);high=b['high']+(0 if long else spread)
    if t.status=='pending':
        entry=b['open']+(spread if long else 0)
        if t.order_type=='STOP':
            if long and b['high']+spread<t.requested_entry or not long and b['low']>t.requested_entry:return
            entry=max(entry,t.requested_entry) if long else min(entry,t.requested_entry)
        if t.order_type=='LIMIT':
            if long and b['low']+spread>t.requested_entry or not long and b['high']<t.requested_entry:return
            intrabar_limit=entry>t.requested_entry if long else entry<t.requested_entry
            entry=min(entry,t.requested_entry) if long else max(entry,t.requested_entry)
        if not (t.stop_price<entry<t.target_price if long else t.target_price<entry<t.stop_price):
            t.status='cancelled';t.exit_reason='ราคาข้ามกรอบ SL/TP';return
        t.entry_price=entry;t.entry_time=b['time'];t.status='open'
    if t.status!='open':return
    sl=low<=t.stop_price if long else high>=t.stop_price
    tp=high>=t.target_price if long else low<=t.target_price
    if sl:
        t.ambiguous=tp
        price=min(opening,t.stop_price) if long else max(opening,t.stop_price)
        close_trade(t,price,b['time'],'SL · แตะทั้งสองฝั่ง' if tp else 'SL',config['commission_r'])
    elif tp:
        # For a limit filled inside this bar, high/low may precede the fill.
        # A close beyond TP proves it was reached after filling; otherwise defer TP.
        if not intrabar_limit or (b['close']>=t.target_price if long else b['close']+spread<=t.target_price):
            close_trade(t,t.target_price,b['time'],'TP',config['commission_r'])


def trade_dict(t,quote=None):
    keys=['id','status','side','order_type','requested_entry','entry_price','stop_price','target_price','entry_time','exit_time','exit_price','net_r','exit_reason','ambiguous','playbook_snapshot','decision','review']
    return {**{k:getattr(t,k) for k in keys},'money_pnl':money_pnl(t),'remaining_lot':remaining_lot(t),'realized_pnl':realized_pnl(t),'floating_pnl':floating_pnl(t,quote) if quote else None,'current_price':(quote['bid'] if t.side=='BUY' else quote['ask']) if quote and t.status in ('pending','open') else t.exit_price}


def statistics(trades):
    closed=[t for t in trades if t.status=='closed']
    wins=sum(t.net_r>1e-9 for t in closed);losses=sum(t.net_r< -1e-9 for t in closed)
    streak=maximum=0
    for t in sorted(closed,key=lambda x:(x.created_at,x.id)):
        streak=streak+1 if t.net_r< -1e-9 else 0;maximum=max(maximum,streak)
    reviewed=[t for t in closed if t.review and t.review.get('in_plan') is not None]
    groups={}
    for t in closed:
        p=(t.review or {}).get('playbook_snapshot') or t.playbook_snapshot
        if not p:continue
        key=f"{p['playbook_id']}@{p['playbook_version']}"
        groups.setdefault(key,{'playbook_id':p['playbook_id'],'name':p['playbook_name'],'version':p['playbook_version'],'trades':[]})['trades'].append(t)
    return {'trades':len(closed),'wins':wins,'losses':losses,'win_rate':wins/len(closed)*100 if closed else None,'net_r':sum(t.net_r for t in closed),'average_r':sum(t.net_r for t in closed)/len(closed) if closed else None,'in_plan_percent':sum(t.review['in_plan'] for t in reviewed)/len(reviewed)*100 if reviewed else None,'reviewed':len(reviewed),'max_losing_streak':maximum,'ambiguous':sum(t.ambiguous for t in closed),'by_setup':[{'key':k,**{a:b for a,b in g.items() if a!='trades'},**statistics_no_groups(g['trades'])} for k,g in groups.items()]}


def statistics_no_groups(trades):
    n=len(trades);reviewed=[t for t in trades if t.review and t.review.get('in_plan') is not None]
    streak=maximum=0
    for t in sorted(trades,key=lambda x:(x.created_at,x.id)):
        streak=streak+1 if t.net_r< -1e-9 else 0;maximum=max(maximum,streak)
    return {'trades':n,'win_rate':sum(t.net_r>1e-9 for t in trades)/n*100,'net_r':sum(t.net_r for t in trades),'average_r':sum(t.net_r for t in trades)/n,'in_plan_percent':sum(t.review['in_plan'] for t in reviewed)/len(reviewed)*100 if reviewed else None,'max_losing_streak':maximum}


def session_dict(db,s):
    d=db.get(ReplayDataset,s.dataset_id)
    trades=list(db.scalars(select(ReplayTrade).where(ReplayTrade.session_id==s.id).order_by(ReplayTrade.created_at,ReplayTrade.id)))
    bars,quote,clock=current_view(d,s)
    return {'id':s.id,'name':s.name,'dataset':dataset_dict(d),'cursor':s.cursor,'end_cursor':s.end_cursor,'revision':s.revision,'status':s.status,'bars':bars,'config':s.config_json,'drawings':s.drawings,'indicators':s.indicators,'trades':[trade_dict(t,quote) for t in trades],'stats':statistics(trades),'accounting':accounting(s,trades,{'close':quote['bid'],'ask':quote['ask']}),'quote':quote,'replay_time_ms':clock,'timeframes':available_timeframes(d)}


def available_timeframes(d):
    if tick_store.is_tick(d):return list(INTERVALS)
    base=INTERVALS[d.timeframe]
    return [tf for tf,interval in INTERVALS.items() if interval>=base and interval%base==0]


def current_view(d,s):
    tf=s.config_json.get('timeframe',d.timeframe)
    if tick_store.is_tick(d):
        bars,quote=tick_store.view(d,s.cursor,tf)
        return bars,quote,s.config_json.get('replay_clock_ms',quote['time_ms'])
    prefix=d.bars[:s.cursor+1]
    bars=prefix if tf==d.timeframe else tick_store.merge_bars(prefix,INTERVALS[tf])
    last=prefix[-1];clock=(last['time']+INTERVALS[d.timeframe])*1000
    return bars,{'time_ms':clock,'bid':last['close'],'ask':last['close']+s.config_json['spread']},clock


def money_pnl(t):
    decision=t.decision or {}
    if t.status!='closed' or decision.get('workspace')!='backtest':return None
    # Net R already includes commission; use the actual fill-to-stop risk, not the drafted entry.
    return t.net_r*abs(t.entry_price-t.stop_price)*decision['lot']*decision['point_value']


def remaining_lot(t):
    if t.status not in ('pending','open') or (t.decision or {}).get('workspace')!='backtest':return 0.
    return max(0.,round(t.decision['lot']-sum(x['lot'] for x in t.decision.get('partial_exits',[])),12))


def realized_pnl(t):
    if (t.decision or {}).get('workspace')!='backtest':return None
    return money_pnl(t) if t.status=='closed' else sum(x['money_pnl'] for x in t.decision.get('partial_exits',[]))


def floating_pnl(t,quote):
    if (t.decision or {}).get('workspace')!='backtest':return None
    if t.status!='open':return 0.
    mark=quote['bid'] if t.side=='BUY' else quote['ask']
    return (mark-t.entry_price)*(1 if t.side=='BUY' else -1)*remaining_lot(t)*t.decision['point_value']


def accounting(s,trades,bar):
    config=s.config_json
    if config.get('workspace')!='backtest':return None
    realized=sum(realized_pnl(t) or 0 for t in trades)
    quote={'bid':bar['close'],'ask':bar.get('ask',bar['close']+config['spread'])}
    floating=sum(floating_pnl(t,quote) or 0 for t in trades)
    balance=config['initial_balance']+realized
    return {'initial_balance':config['initial_balance'],'currency':config['currency'],'net_pnl':realized,'balance':balance,'floating_pnl':floating,'equity':balance+floating}
