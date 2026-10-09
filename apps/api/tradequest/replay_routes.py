import secrets
from copy import deepcopy
from datetime import datetime,timezone
from threading import RLock
from typing import Literal
from fastapi import APIRouter,Depends,HTTPException,UploadFile,File,Form
from pydantic import BaseModel,ConfigDict,Field,model_validator
from sqlalchemy import select
from .db import get_db,now
from .models import ReplayDataset,ReplaySession,ReplayTrade
from .replay import INTERVALS,validate_bars,parse_csv,demo_bars,dataset_dict,process_bar,close_trade,session_dict,statistics,accounting,current_view,available_timeframes,remaining_lot
from . import tick_store, pine_scripts
from .pine_scripts import PineIndicator, ScriptInput
router=APIRouter(prefix='/api/v1/replay',tags=['Manual replay · practice only'])
lock=RLock()


class Input(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)


class Start(Input):
    dataset_id:str
    name:str=Field(default='ฝึก Replay',min_length=1,max_length=150)
    start_time:int|None=None
    end_time:int|None=None
    spread:float=Field(default=0,ge=0,le=100000)
    commission_r:float=Field(default=0,ge=0,le=5)
    workspace:Literal['backtest']='backtest'
    initial_balance:float|None=Field(default=None,gt=0,le=1e12)
    currency:Literal['USD','USC','THB']='USD'
    target_trades:int|None=Field(default=None,ge=1,le=100000)
    goal:str=Field(default='',max_length=2000)
    point_value:float|None=Field(default=None,gt=0,le=1e9)
    timeframe:Literal['M1','M5','M15','M30','H1','H4','D1']|None=None
    @model_validator(mode='after')
    def profile(self):
        if not self.name.strip():raise ValueError('ระบุชื่อโปรไฟล์')
        if self.workspace=='backtest' and (self.initial_balance is None or self.target_trades is None or self.point_value is None or not self.goal.strip()):
            raise ValueError('ระบุเงินเริ่มต้น จำนวนไม้ เป้าหมาย และมูลค่าต่อราคาหนึ่งหน่วย')
        return self


class Revision(Input):
    revision:int=Field(ge=0)


class Step(Revision):
    steps:int=Field(default=1,ge=1,le=10)


class Advance(Revision):
    milliseconds:int=Field(default=250,ge=1,le=3600000)
    one_tick:bool=False


class Timeframe(Revision):
    timeframe:Literal['M1','M5','M15','M30','H1','H4','D1']


class Point(Input):
    time:int=Field(ge=0,le=4102444800)
    price:float=Field(gt=0)


class FiboLevel(Input):
    value:float=Field(ge=-100,le=100)
    enabled:bool=True
    color:str=Field(pattern=r'^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$')


class FiboSettings(Input):
    levels:list[FiboLevel]=Field(min_length=1,max_length=32)
    extend:Literal['none','left','right','both']='none'
    reverse:bool=False
    trend_line:bool=True
    trend_color:str=Field(default='#787b86',pattern=r'^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$')
    trend_style:Literal['solid','dashed','dotted']='dashed'
    background:bool=False
    background_opacity:int=Field(default=15,ge=0,le=100)
    single_color:bool=False
    single_color_value:str=Field(default='#d6b86c',pattern=r'^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$')
    show_prices:bool=True
    show_levels:bool=True
    level_format:Literal['value','percent']='value'
    label_position:Literal['left','center','right']='left'
    label_vertical:Literal['top','center','bottom']='center'
    show_text:bool=True
    text_position:Literal['left','center','right']='center'
    text_vertical:Literal['top','center','bottom']='top'
    font_size:int=Field(default=12,ge=10,le=24)
    timeframes:list[Literal['M1','M5','M15','M30','H1','H4','D1']]=Field(default=['M1','M5','M15','M30','H1','H4','D1'],max_length=7)
    @model_validator(mode='after')
    def unique_timeframes(self):
        if len(set(self.timeframes))!=len(self.timeframes):raise ValueError('TF ซ้ำ')
        return self


class Drawing(Input):
    id:str=Field(min_length=1,max_length=80)
    kind:Literal['horizontal','trend','zone','fibo']
    points:list[Point]=Field(min_length=1,max_length=2)
    label:str=Field(default='',max_length=60)
    color:str=Field(default='#d6b86c',pattern=r'^#[0-9a-fA-F]{6}$')
    line_width:int=Field(default=2,ge=1,le=5)
    line_style:Literal['solid','dashed','dotted']='solid'
    locked:bool=False
    fibo:FiboSettings|None=None
    @model_validator(mode='after')
    def length(self):
        if len(self.points)!=(1 if self.kind=='horizontal' else 2):raise ValueError('จำนวนจุดไม่ตรงเครื่องมือ')
        if self.fibo is not None and self.kind!='fibo':raise ValueError('ตั้งค่า Fibo ใช้ได้เฉพาะ Fib Retracement')
        return self


class Indicator(Input):
    id:str=Field(min_length=1,max_length=80)
    kind:Literal['EMA','SMA','RSI','MACD','VOLUME']
    period:int=Field(default=14,ge=1,le=500)
    fast:int=Field(default=9,ge=1,le=500)
    slow:int=Field(default=4,ge=1,le=500)
    signal:int=Field(default=9,ge=1,le=500)


class Visuals(Revision):
    drawings:list[Drawing]=Field(max_length=100)
    indicators:list[Indicator|PineIndicator]=Field(max_length=8)



class ClosePosition(Revision):
    trade_id:str|None=Field(default=None,min_length=1,max_length=36)
    lot:float|None=Field(default=None,gt=0,le=100000)


class Position(Revision):
    side:Literal['BUY','SELL']
    order_type:Literal['MARKET','LIMIT','STOP']='MARKET'
    entry:float=Field(gt=0)
    sl:float=Field(gt=0)
    tp:float=Field(gt=0)
    lot:float=Field(gt=0,le=100000)
    reason:str=Field(default='',max_length=5000)
    emotion:str=Field(default='',max_length=200)
    drawing_time:int|None=Field(default=None,ge=0,le=4102444800)
    drawing_end_time:int|None=Field(default=None,ge=0,le=4102444800)
    @model_validator(mode='after')
    def required_text(self):
        if (self.drawing_time is None)!=(self.drawing_end_time is None) or (self.drawing_time is not None and self.drawing_end_time<=self.drawing_time):raise ValueError('ระบุขอบกรอบ Position ให้ครบและเรียงซ้ายไปขวา')
        return self


class Reflection(Input):
    emotion:str=Field(default='',max_length=200)
    feelings:str=Field(default='',max_length=5000)
    feedback:str=Field(default='',max_length=5000)



def session(db,id,body=None,active=True):
    s=db.get(ReplaySession,id)
    if not s:raise HTTPException(404,'ไม่พบรอบฝึก')
    if body and body.revision!=s.revision:raise HTTPException(409,'รอบฝึกเปลี่ยนแล้ว กรุณาเปิดใหม่ก่อนทำต่อ')
    if active and s.status!='active':raise HTTPException(409,'รอบฝึกจบแล้ว')
    return s


def save(db,s):
    s.revision+=1;s.updated_at=now();db.commit()
    return session_dict(db,s)


@router.get('/datasets')
def datasets(db=Depends(get_db)):
    return [dataset_dict(d) for d in db.scalars(select(ReplayDataset).order_by(ReplayDataset.created_at.desc()))]


@router.post('/datasets/demo')
def demo(db=Depends(get_db)):
    existing=db.scalar(select(ReplayDataset).where(ReplayDataset.source=='SYNTHETIC_DEMO_V1'))
    if existing:return dataset_dict(existing)
    bars=demo_bars()
    d=ReplayDataset(name='DEMO DATA · ฝึกใช้เครื่องมือ',symbol='DEMO',timeframe='M5',source='SYNTHETIC_DEMO_V1',synthetic=True,bars=bars,metadata_json=validate_bars(bars,'M5'))
    db.add(d);db.commit();return dataset_dict(d)


@router.post('/datasets/import')
async def import_csv(file:UploadFile=File(...),symbol:str=Form(...,min_length=1,max_length=40),timeframe:str=Form(...),utc_offset_minutes:int=Form(...,ge=-840,le=840),name:str=Form(...,min_length=1,max_length=150),db=Depends(get_db)):
    if timeframe not in INTERVALS:raise HTTPException(422,'timeframe ไม่รองรับ')
    if not symbol.strip() or not name.strip():raise HTTPException(422,'ระบุชื่อและ symbol')
    content=await file.read(8*1024*1024+1)
    if len(content)>8*1024*1024:raise HTTPException(413,'CSV ใหญ่เกิน 8 MB')
    bars,metadata=parse_csv(content,timeframe,utc_offset_minutes)
    d=ReplayDataset(name=name.strip(),symbol=symbol.strip(),timeframe=timeframe,source='CSV_IMPORT',synthetic=False,bars=bars,metadata_json={**metadata,'utc_offset_minutes':utc_offset_minutes})
    db.add(d);db.commit();return dataset_dict(d)



@router.get('/sessions')
def sessions(db=Depends(get_db)):
    return [{'id':s.id,'name':s.name,'status':s.status,'cursor':s.cursor,'config':s.config_json,'dataset':dataset_dict(db.get(ReplayDataset,s.dataset_id))} for s in db.scalars(select(ReplaySession).order_by(ReplaySession.updated_at.desc()).limit(100))]


@router.post('/sessions')
def start(body:Start,db=Depends(get_db)):
    d=db.get(ReplayDataset,body.dataset_id)
    if not d:raise HTTPException(404,'ไม่พบชุดข้อมูล')
    tf=body.timeframe or d.timeframe
    if tf not in available_timeframes(d):raise HTTPException(422,'TF ต้องไม่เล็กกว่าข้อมูลแท่งที่นำเข้า')
    if tick_store.is_tick(d):
        if body.workspace!='backtest':raise HTTPException(422,'ข้อมูล tick ใช้กับโปรไฟล์ Backtest')
        cursor,end=tick_store.seed_cursor(d,body.start_time,body.end_time,tf,random_start=body.workspace=="backtest")
    else:
        n=len(d.bars);cursor=min(249,max(200 if n>=220 else 19,n//3))
        if body.start_time is not None:
            indices=[i for i,b in enumerate(d.bars) if b['time']+INTERVALS[d.timeframe]<=body.start_time]
            if not indices:raise HTTPException(422,'เวลาเริ่มต้องมีแท่งปิดให้ดูอย่างน้อย 20 แท่ง')
            cursor=indices[-1]
        end=n-1
        if body.end_time is not None:
            indices=[i for i,b in enumerate(d.bars) if b['time']+INTERVALS[d.timeframe]<=body.end_time]
            if not indices:raise HTTPException(422,'ช่วงเวลาจบไม่อยู่ในข้อมูล')
            end=indices[-1]
        if body.workspace=='backtest' and body.start_time is None:
            # Choose real source-bar boundaries; keep TF warmup and training headroom.
            candidates=[]
            for i in range(end):
                if d.bars[i]['time']//INTERVALS[tf]!=d.bars[i+1]['time']//INTERVALS[tf]:candidates.append(i)
            low=249 if len(candidates)>=520 else 19
            high=len(candidates)-21 if len(candidates)-low>=40 else len(candidates)-1
            if high<low:raise HTTPException(422,'ต้องมีอย่างน้อย 20 แท่งก่อนเริ่มและข้อมูลสำหรับฝึกต่อ')
            cursor=candidates[low+secrets.randbelow(high-low+1)]
        if not 19<=cursor<end:raise HTTPException(422,'ต้องมีแท่งก่อนเริ่มอย่างน้อย 20 แท่ง และแท่งสำหรับฝึกต่อ')
    config={'spread':body.spread,'commission_r':body.commission_r,'price_basis':'BID','both_hit_policy':'SL_FIRST','entry_policy':'NEXT_BAR','engine_version':1}
    indicators=[{'id':'macd-default','kind':'MACD','period':14,'fast':9,'slow':4,'signal':9},{'id':'rsi-default','kind':'RSI','period':200,'fast':9,'slow':4,'signal':9}]
    if body.workspace=='backtest':
        config.update(workspace='backtest',profile_version=1,initial_balance=body.initial_balance,currency=body.currency,target_trades=body.target_trades,goal=body.goal.strip(),point_value=body.point_value)
        indicators=[]
    config.update(initial_cursor=cursor,start_policy='random' if body.workspace=='backtest' and body.start_time is None else 'specified' if body.start_time is not None else 'legacy',timeframe=tf,replay_mode='ticks' if tick_store.is_tick(d) else 'bars')
    if tick_store.is_tick(d):config.update(engine_version=2,entry_policy='NEXT_OBSERVED_TICK',both_hit_policy='SOURCE_SEQUENCE',spread=0)
    s=ReplaySession(dataset_id=d.id,name=body.name.strip(),cursor=cursor,end_cursor=end,config_json=config,drawings=[],indicators=indicators)
    db.add(s);db.commit();return session_dict(db,s)


@router.get('/sessions/{id}')
def detail(id:str,db=Depends(get_db)):
    return session_dict(db,session(db,id,active=False))


@router.post('/sessions/{id}/step')
def step(id:str,body:Step,db=Depends(get_db)):
    with lock:
        s=session(db,id,body)
        d=db.get(ReplayDataset,s.dataset_id)
        trades=list(db.scalars(select(ReplayTrade).where(ReplayTrade.session_id==id,ReplayTrade.status.in_(['pending','open']))))
        if tick_store.is_tick(d):
            for _ in range(body.steps):
                tick_store.advance(d,s,trades,bar=True)
                if any(t.status in ('closed','cancelled') for t in trades):break
        else:
            for _ in range(body.steps):
                if s.cursor>=s.end_cursor:break
                interval=INTERVALS[s.config_json.get('timeframe',d.timeframe)]
                bucket=d.bars[s.cursor]['time']//interval
                while s.cursor<s.end_cursor:
                    s.cursor+=1
                    for t in trades:
                        if t.status in ('pending','open'):process_bar(t,d.bars[s.cursor],s.config_json)
                    if any(t.status in ('closed','cancelled') for t in trades):break
                    if d.bars[s.cursor]['time']//interval>bucket:break
                if any(t.status in ('closed','cancelled') for t in trades):break
        return save(db,s)


@router.post('/sessions/{id}/rewind')
def rewind(id:str,body:Revision,db=Depends(get_db)):
    with lock:
        s=session(db,id,body,active=False);d=db.get(ReplayDataset,s.dataset_id)
        interval=INTERVALS[s.config_json.get('timeframe',d.timeframe)]
        if tick_store.is_tick(d):
            import sqlite3
            with tick_store.quotes(d) as mapped:
                bucket=(tick_store.tick_at(mapped,s.cursor)['time_ms']//1000)//interval*interval
            with sqlite3.connect((tick_store.folder(d)/'bars.sqlite3').as_uri()+'?mode=ro',uri=True) as index:
                row=index.execute('SELECT last_idx FROM frames WHERE tf=? AND time<? ORDER BY time DESC LIMIT 1',(s.config_json.get('timeframe',d.timeframe),bucket)).fetchone()
            target=row[0] if row else 0
            with tick_store.quotes(d) as mapped:
                clock=tick_store.tick_at(mapped,target)['time_ms']
        else:
            bucket=d.bars[s.cursor]['time']//interval
            target=s.cursor
            while target>0 and d.bars[target]['time']//interval>=bucket:target-=1
            clock=(d.bars[target]['time']+INTERVALS[d.timeframe])*1000
        if target>=s.cursor:raise HTTPException(422,'อยู่ต้นข้อมูลแล้ว ไม่สามารถย้อนแท่งได้')
        for t in db.scalars(select(ReplayTrade).where(ReplayTrade.session_id==id,ReplayTrade.status.in_(['pending','open']))):
            t.status='cancelled';t.exit_reason='ยกเลิกจากการย้อน Replay'
            t.decision={**t.decision,'cancelled_at_cursor':s.cursor,'rewind_to_cursor':target,'cancelled_time_ms':current_view(d,s)[2]}
        s.cursor=target;s.status='active'
        s.config_json={**s.config_json,'replay_generation':s.config_json.get('replay_generation',0)+1}
        if tick_store.is_tick(d):s.config_json={**s.config_json,'replay_clock_ms':clock}
        return save(db,s)


@router.put('/sessions/{id}/visuals')
def visuals(id:str,body:Visuals,db=Depends(get_db)):
    with lock:
        s=session(db,id,body,active=False)
        # Drawing anchors may occupy whitespace or fractions of a bar. They contain
        # user-entered coordinates only; current_view still hides future market data.
        if len({x.id for x in body.drawings})!=len(body.drawings) or len({x.id for x in body.indicators})!=len(body.indicators):raise HTTPException(422,'เครื่องมือ id ซ้ำ')
        frozen=[pine_scripts.freeze(db,x,s.indicators) if isinstance(x,PineIndicator) else x.model_dump() for x in body.indicators]
        s.drawings=[x.model_dump(exclude_none=True) for x in body.drawings];s.indicators=frozen
        return save(db,s)



def exit_position(t,s,quote,clock,lot=None):
    if t.status=='pending':
        if lot is not None:raise HTTPException(422,'คำสั่งรอเข้าให้ยกเลิกทั้งคำสั่ง')
        t.status='cancelled';t.exit_reason='ยกเลิกก่อนเข้า';return
    remaining=remaining_lot(t)
    if lot is not None and (s.config_json.get('workspace')!='backtest' or lot>remaining+1e-10):raise HTTPException(422,'Lot ที่ปิดต้องไม่เกิน Lot คงเหลือ')
    price=quote['ask'] if t.side=='SELL' else quote['bid']
    evidence={'exit_time_ms':clock,'exit_tick_index':s.cursor,'exit_bid':quote['bid'],'exit_ask':quote['ask']}
    if lot is not None and lot<remaining-1e-10:
        if len(t.decision.get('partial_exits',[]))>=1000:raise HTTPException(422,'ครบจำนวนการปิดบางส่วนสูงสุดของ Position นี้')
        risk=abs(t.entry_price-t.stop_price)
        net=(price-t.entry_price)*(1 if t.side=='BUY' else -1)/risk-s.config_json['commission_r']
        fill={**evidence,'lot':lot,'price':price,'net_r':net,'money_pnl':net*risk*lot*t.decision['point_value']}
        t.decision={**t.decision,'partial_exits':[*t.decision.get('partial_exits',[]),fill]}
    else:
        close_trade(t,price,clock//1000,'ปิดเอง',s.config_json['commission_r'])
        t.decision={**t.decision,**evidence}


@router.post('/sessions/{id}/close')
def close(id:str,body:ClosePosition,db=Depends(get_db)):
    with lock:
        s=session(db,id,body);d=db.get(ReplayDataset,s.dataset_id)
        trades=list(db.scalars(select(ReplayTrade).where(ReplayTrade.session_id==id,ReplayTrade.status.in_(['open','pending']))))
        if body.trade_id:
            t=next((t for t in trades if t.id==body.trade_id),None)
            if not t:raise HTTPException(404,'ไม่พบ Position ที่ยังเปิดในโปรไฟล์นี้')
        else:
            if len(trades)!=1:raise HTTPException(422,'ระบุ Position ที่ต้องการปิด')
            t=trades[0]
        _,quote,clock=current_view(d,s)
        exit_position(t,s,quote,clock,body.lot)
        return save(db,s)


@router.post('/sessions/{id}/close-all')
def close_all(id:str,body:Revision,db=Depends(get_db)):
    with lock:
        s=session(db,id,body);d=db.get(ReplayDataset,s.dataset_id)
        trades=list(db.scalars(select(ReplayTrade).where(ReplayTrade.session_id==id,ReplayTrade.status.in_(['open','pending']))))
        if not trades:raise HTTPException(422,'ไม่มี Position ที่เปิดหรือรอเข้า')
        _,quote,clock=current_view(d,s)
        for t in trades:exit_position(t,s,quote,clock)
        return save(db,s)


@router.post('/sessions/{id}/finish')
def finish(id:str,body:Revision,db=Depends(get_db)):
    with lock:
        s=session(db,id,body)
        if db.scalar(select(ReplayTrade).where(ReplayTrade.session_id==id,ReplayTrade.status.in_(['pending','open']))):raise HTTPException(422,'ปิดหรือยกเลิกไม้จำลองก่อนจบรอบ')
        s.status='finished';return save(db,s)



@router.get('/stats')
def stats(db=Depends(get_db)):
    all_trades=list(db.scalars(select(ReplayTrade)))
    sets={d.id:d for d in db.scalars(select(ReplayDataset))}
    sessions={s.id:s for s in db.scalars(select(ReplaySession))}
    real=[t for t in all_trades if not sets[sessions[t.session_id].dataset_id].synthetic]
    synthetic=[t for t in all_trades if sets[sessions[t.session_id].dataset_id].synthetic]
    return {'historical':statistics(real),'synthetic':statistics(synthetic)}


@router.post('/sessions/{id}/positions')
def position(id:str,body:Position,db=Depends(get_db)):
    with lock:
        s=session(db,id,body);d=db.get(ReplayDataset,s.dataset_id)
        if s.config_json.get('workspace')!='backtest':raise HTTPException(422,'สร้างโปรไฟล์ที่กำหนดเงินเริ่มต้นก่อนวาง Position')
        if s.cursor==s.end_cursor:raise HTTPException(422,'ไม่มีแท่งถัดไปให้เข้าไม้')
        trades=list(db.scalars(select(ReplayTrade).where(ReplayTrade.session_id==id)))
        if sum(t.status in ('open','pending') for t in trades)>=100:raise HTTPException(422,'รองรับ Position ที่เปิดหรือรอเข้าสูงสุด 100 ไม้')
        bars,quote,clock=current_view(d,s)
        if accounting(s,trades,{'close':quote['bid'],'ask':quote['ask']})['balance']<=0:raise HTTPException(422,'เงินจำลองหมดแล้ว กรุณาสร้างโปรไฟล์ใหม่')
        long=body.side=='BUY';reference=quote['ask'] if long else quote['bid']
        entry=reference if body.order_type=='MARKET' else body.entry
        if not (body.sl<entry<body.tp if long else body.tp<entry<body.sl):raise HTTPException(422,'Long ต้อง SL < Entry < TP · Short ต้อง TP < Entry < SL')
        if body.order_type=='LIMIT' and (entry>reference if long else entry<reference):raise HTTPException(422,'Buy Limit ต้องอยู่ไม่สูงกว่าราคา · Sell Limit ต้องอยู่ไม่ต่ำกว่าราคา')
        if body.order_type=='STOP' and (entry<reference if long else entry>reference):raise HTTPException(422,'Buy Stop ต้องอยู่ไม่ต่ำกว่าราคา · Sell Stop ต้องอยู่ไม่สูงกว่าราคา')
        t=ReplayTrade(session_id=id,side=body.side,order_type=body.order_type,requested_entry=entry,stop_price=body.sl,target_price=body.tp,playbook_snapshot={},decision={'workspace':'backtest','cursor':s.cursor,'candle_time':bars[-1]['time'],'decision_time_ms':clock,'replay_generation':s.config_json.get('replay_generation',0),'timeframe':s.config_json.get('timeframe',d.timeframe),'lot':body.lot,'point_value':s.config_json['point_value'],'currency':s.config_json['currency'],'reason':body.reason.strip(),'emotion':body.emotion.strip(),'planned_entry':body.entry,'initial_stop':body.sl,'drawings':deepcopy(s.drawings),'indicators':deepcopy(s.indicators)})
        if body.drawing_time is not None:t.decision={**t.decision,'position_drawing':{'time':body.drawing_time,'end_time':body.drawing_end_time}}
        db.add(t);return save(db,s)


@router.put('/sessions/{id}/trades/{trade_id}/reflection')
def reflection(id:str,trade_id:str,body:Reflection,db=Depends(get_db)):
    with lock:
        s=session(db,id,active=False);t=db.get(ReplayTrade,trade_id)
        if not t or t.session_id!=id:raise HTTPException(404,'ไม่พบ Position')
        if t.status!='closed':raise HTTPException(422,'ทบทวนได้หลังปิด Position แล้ว')
        t.review={'in_plan':None,'notes':'','playbook_snapshot':{},**(t.review or {}),**body.model_dump()}
        db.commit();return session_dict(db,s)


@router.post('/sessions/{id}/advance')
def advance(id:str,body:Advance,db=Depends(get_db)):
    with lock:
        s=session(db,id,body);d=db.get(ReplayDataset,s.dataset_id)
        if not tick_store.is_tick(d):raise HTTPException(422,'ชุดข้อมูลนี้ไม่มี tick จริง ใช้ทีละแท่ง')
        trades=list(db.scalars(select(ReplayTrade).where(ReplayTrade.session_id==id,ReplayTrade.status.in_(['pending','open']))))
        tick_store.advance(d,s,trades,milliseconds=body.milliseconds,one_tick=body.one_tick)
        return save(db,s)


@router.put('/sessions/{id}/timeframe')
def timeframe(id:str,body:Timeframe,db=Depends(get_db)):
    with lock:
        s=session(db,id,body,active=False);d=db.get(ReplayDataset,s.dataset_id)
        if body.timeframe not in available_timeframes(d):raise HTTPException(422,'ข้อมูลแท่งไม่รองรับ TF ที่เล็กกว่าไฟล์ต้นฉบับ')
        s.config_json={**s.config_json,'timeframe':body.timeframe}
        return save(db,s)


@router.get('/pine-scripts')
def pine_catalog(db=Depends(get_db)):
    return pine_scripts.catalog(db)


@router.post('/pine-scripts')
def pine_create(body:ScriptInput,db=Depends(get_db)):
    with lock:return pine_scripts.store(db,body)


@router.put('/pine-scripts/{id}')
def pine_edit(id:str,body:ScriptInput,db=Depends(get_db)):
    with lock:return pine_scripts.store(db,body,id)


@router.delete('/pine-scripts/{id}')
def pine_archive(id:str,base_version:int,db=Depends(get_db)):
    with lock:return pine_scripts.archive(db,id,base_version)
