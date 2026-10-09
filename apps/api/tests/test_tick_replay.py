"""Synthetic quote fixtures verify causal tick replay; never use real user data."""
import hashlib
import importlib.util
import lzma
import struct
from pathlib import Path
import pytest
from tradequest.db import DATA
from tradequest.models import ReplayDataset
from tradequest import tick_store
from test_replay import BASE,dataset,start,step
from test_backtest import position,close

STAMP=1735776000

@pytest.fixture
def tick_dataset(db,tmp_path):
    script=Path(__file__).resolve().parents[3]/'scripts'/'import_tick_archives.py'
    spec=importlib.util.spec_from_file_location('tq_tick_import',script);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    root=tmp_path/'archives';key='XAUUSD/2025/00/02_ticks.bi5';path=root/key;path.parent.mkdir(parents=True)
    raw=b''
    for minute in range(180):
        # Two separate quotes at the same millisecond retain source order.
        for offset,price in [(0,100),(15000,101),(15000,110),(45000,95)]:
            raw+=struct.pack('>IIIff',minute*60000+offset,int((price+1)*1000),int(price*1000),.001,.001)
    content=lzma.compress(raw);path.write_bytes(content)
    records=[{'key':key,'status':'ok','sha256':hashlib.sha256(content).hexdigest()}]
    metadata=module.build_store(root,records,DATA/'market-data'/'demo-ticks','XAUUSD',2025)
    metadata.update(provider='SYNTHETIC_TEST',complete_calendar_scan=False)
    d=ReplayDataset(id='demo-ticks',name='DEMO quote fixture',symbol='DEMO',timeframe='M5',source='SYNTHETIC_TEST_TICKS',synthetic=True,bars=[],metadata_json=metadata)
    db.add(d);db.commit();return d


def profile(client,d,**kwargs):
    result=client.post(BASE+'/sessions',json={'dataset_id':d.id,'workspace':'backtest','name':'Tick fixture','initial_balance':1000,'target_trades':20,'point_value':100,'goal':'Practice','start_time':STAMP+100*60,'timeframe':'M5',**kwargs})
    assert result.status_code==200,result.text
    return result.json()


def advance(client,s,**kwargs):
    result=client.post(f"{BASE}/sessions/{s['id']}/advance",json={'revision':s['revision'],**kwargs})
    assert result.status_code==200,result.text
    return result.json()


def tf(client,s,value):
    result=client.put(f"{BASE}/sessions/{s['id']}/timeframe",json={'revision':s['revision'],'timeframe':value})
    assert result.status_code==200,result.text
    return result.json()


def test_forming_candle_hides_future_and_timeframe_keeps_source_clock(client,tick_dataset):
    s=profile(client,tick_dataset)
    assert s['bars'][-1]=={'time':STAMP+6000,'open':100,'high':100,'low':100,'close':100,'volume':1}
    assert s['replay_time_ms']==(STAMP+6000)*1000
    original=s['cursor'];clock=s['replay_time_ms']
    for frame in ['M1','M15','M30','H1','H4','D1','M5']:
        s=tf(client,s,frame)
        assert s['cursor']==original and s['replay_time_ms']==clock
        assert s['quote']=={'time_ms':clock,'bid':100,'ask':101}
        # Future quote volume/extremes cannot enter any aggregated candle.
        assert sum(b['volume'] for b in s['bars'])==401
    s=advance(client,s,one_tick=True)
    assert s['bars'][-1]['high']==101 and s['bars'][-1]['low']==100
    s=advance(client,s,one_tick=True)
    assert s['quote']['bid']==110 and s['bars'][-1]['high']==110
    assert s['replay_time_ms']==(STAMP+6015)*1000
    assert client.get(f"{BASE}/sessions/{s['id']}").json()==s
    assert 'ticks' not in s and 'bars' not in s['dataset']


def test_tick_market_next_quote_tp_uses_sequence_and_preserves_millisecond_evidence(client,tick_dataset):
    s=profile(client,tick_dataset,commission_r=.1,spread=999)
    assert s['config']['spread']==0
    result=position(client,s,entry=101,sl=90,tp=105);assert result.status_code==200,result.text
    s=result.json();assert s['trades'][0]['status']=='pending'
    s=advance(client,s,one_tick=True);t=s['trades'][0]
    assert t['status']=='open' and t['entry_price']==102
    assert s['accounting']['floating_pnl']==-10
    s=advance(client,s,milliseconds=60000);t=s['trades'][0]
    assert t['exit_reason']=='TP' and not t['ambiguous']
    assert t['entry_time']==t['exit_time'] # Different quotes in same ms, never collapsed.
    assert t['decision']['entry_tick_index']+1==t['decision']['exit_tick_index']
    assert t['decision']['exit_time_ms']==(STAMP+6015)*1000
    assert t['money_pnl']==pytest.approx(30-12)
    assert s['quote']['bid']==110 # Playback stops at exit, before later 95 quote.


def test_short_mark_uses_real_ask_and_tf_does_not_modify_position(client,tick_dataset):
    s=profile(client,tick_dataset)
    s=position(client,s,side='SELL',entry=100,sl=120,tp=80).json();s=advance(client,s,one_tick=True)
    assert s['trades'][0]['entry_price']==101
    assert s['accounting']['floating_pnl']==-10
    frozen=s['trades'][0];s=tf(client,s,'H1');assert s['trades'][0]==frozen
    s=close(client,s);t=s['trades'][0]
    assert t['exit_price']==102 and t['money_pnl']==-10
    assert t['decision']['exit_time_ms']==s['replay_time_ms']


@pytest.mark.parametrize('side,kind,entry,sl,tp,expected',[
    ('BUY','LIMIT',100,90,120,96),('BUY','STOP',105,90,120,111),
    ('SELL','LIMIT',105,120,80,110),('SELL','STOP',96,120,80,95),
])
def test_pending_tick_orders_quote_side_and_gap_fill(client,tick_dataset,side,kind,entry,sl,tp,expected):
    s=profile(client,tick_dataset)
    result=position(client,s,side=side,order_type=kind,entry=entry,sl=sl,tp=tp);assert result.status_code==200,result.text
    s=advance(client,result.json(),milliseconds=60000)
    assert s['trades'][0]['entry_price']==expected


def test_tick_whitespace_drawings_hide_future_quotes_stale_mutation_and_finished_tf(client,tick_dataset):
    s=profile(client,tick_dataset);old=s
    s=tf(client,s,'H1')
    stale=client.post(f"{BASE}/sessions/{s['id']}/advance",json={'revision':old['revision']});assert stale.status_code==409
    drawings=[{'id':'zone','kind':'horizontal','points':[{'time':s['bars'][-1]['time'],'price':100}]}]
    result=client.put(f"{BASE}/sessions/{s['id']}/visuals",json={'revision':s['revision'],'drawings':drawings,'indicators':[]});assert result.status_code==200,result.text
    s=result.json();drawings[0]['points'][0]['time']=STAMP+120*60
    result=client.put(f"{BASE}/sessions/{s['id']}/visuals",json={'revision':s['revision'],'drawings':drawings,'indicators':[]});assert result.status_code==200,result.text
    future=result.json()
    for key in ['bars','quote','cursor','replay_time_ms','trades','accounting']:assert future[key]==s[key]
    s=future
    s=client.post(f"{BASE}/sessions/{s['id']}/finish",json={'revision':s['revision']}).json();s=tf(client,s,'M1')
    assert s['status']=='finished'
    assert client.post(f"{BASE}/sessions/{s['id']}/advance",json={'revision':s['revision']}).status_code==409


def test_bar_only_data_supports_coarser_tf_without_fabricated_ticks(client):
    s=start(client,dataset(client));original=s
    s=tf(client,s,'M15');assert s['cursor']==original['cursor'] and s['quote']==original['quote']
    assert len(s['bars'])==11
    assert client.put(f"{BASE}/sessions/{s['id']}/timeframe",json={'revision':s['revision'],'timeframe':'M1'}).status_code==422
    assert client.post(f"{BASE}/sessions/{s['id']}/advance",json={'revision':s['revision']}).status_code==422
    s=step(client,s);assert s['cursor']==original['cursor']+3


def test_missing_or_changed_tick_store_rejected(client,tick_dataset):
    s=profile(client,tick_dataset)
    with (tick_store.folder(tick_dataset)/'ticks.bin').open('ab') as f:f.write(b'bad')
    assert client.get(f"{BASE}/sessions/{s['id']}").status_code==409


def test_normal_quote_pause_respects_playback_clock_without_forcing_next_tick(client,tick_dataset):
    s=profile(client,tick_dataset);index=s['cursor'];clock=s['replay_time_ms']
    for _ in range(4):s=advance(client,s,milliseconds=250)
    assert s['cursor']==index and s['quote']['bid']==100
    assert s['replay_time_ms']==clock+1000
    s=tf(client,s,'M1');assert s['replay_time_ms']==clock+1000
    s=advance(client,s,milliseconds=13999);assert s['cursor']==index
    s=advance(client,s,milliseconds=1);assert s['cursor']==index+2
    assert s['quote']['bid']==110
    assert s['replay_time_ms']==clock+15000


def test_bar_skip_processes_quote_path_and_stops_early_at_exit(client,tick_dataset):
    s=profile(client,tick_dataset);original=s['cursor']
    s=step(client,s);assert s['cursor']==original+20
    assert s['replay_time_ms']==(STAMP+105*60)*1000
    s=position(client,s,entry=101,sl=90,tp=105).json()
    s=step(client,s)
    assert s['trades'][0]['exit_reason']=='TP'
    assert s['cursor']==original+22
    assert s['replay_time_ms']==(STAMP+105*60+15)*1000


def rewind(client,s):
    r=client.post(f"{BASE}/sessions/{s['id']}/rewind",json={'revision':s['revision']})
    assert r.status_code==200,r.text
    return r.json()


@pytest.mark.parametrize('state',['pending','open'])
def test_rewind_cancels_active_simulation_and_allows_new_entry(client,tick_dataset,state):
    s=profile(client,tick_dataset)
    s=position(client,s,entry=101,sl=80,tp=120).json()
    if state=='open':s=advance(client,s,one_tick=True)
    old=s['trades'][0];assert old['status']==state
    s=rewind(client,s)
    assert s['quote']['time_ms']==(STAMP+99*60+45)*1000 # Last real quote of previous M5 bucket.
    assert s['cursor']==399 and s['config']['replay_generation']==1
    t=s['trades'][0]
    assert t['status']=='cancelled' and t['entry_price']==old['entry_price']
    assert t['exit_price'] is None and t['net_r'] is None and t['money_pnl'] is None
    assert t['decision']['rewind_to_cursor']==399 and s['accounting']['balance']==1000
    assert s['accounting']['floating_pnl']==s['stats']['trades']==0
    next=position(client,s,entry=96,sl=80,tp=120)
    assert next.status_code==200,next.text
    assert next.json()['trades'][-1]['decision']['replay_generation']==1
    assert client.get(f"{BASE}/sessions/{s['id']}").json()==next.json()


def test_rewind_keeps_closed_outcome_balance_and_visuals(client,tick_dataset):
    s=profile(client,tick_dataset)
    s=advance(client,position(client,s,entry=101,sl=90,tp=105).json(),milliseconds=60000)
    original=s['trades'][0];balance=s['accounting']['balance']
    s=rewind(client,s)
    assert s['trades'][0]==original and s['accounting']['balance']==balance==1030
    assert s['stats']['trades']==1 and s['stats']['wins']==1
    # Repeating source time is a new practice decision, not a duplicate closed trade.
    s=step(client,s);s=position(client,s,entry=101,sl=80,tp=120).json()
    assert len(s['trades'])==2 and s['trades'][0]==original


def test_rewind_tf_boundary_bounds_stale_revision_and_finished_round(client,tick_dataset):
    s=profile(client,tick_dataset);old=s
    s=tf(client,s,'M15');s=rewind(client,s)
    assert s['cursor']==359 and s['quote']['time_ms']==(STAMP+89*60+45)*1000
    assert client.post(f"{BASE}/sessions/{s['id']}/rewind",json={'revision':old['revision']}).status_code==409
    s=tf(client,s,'D1');s=rewind(client,s);assert s['cursor']==0
    r=client.post(f"{BASE}/sessions/{s['id']}/rewind",json={'revision':s['revision']})
    assert r.status_code==422 and client.get(f"{BASE}/sessions/{s['id']}").json()==s
    s=tf(client,s,'M5');s=step(client,s)
    r=client.post(f"{BASE}/sessions/{s['id']}/finish",json={'revision':s['revision']})
    assert r.status_code==200
    assert rewind(client,r.json())['status']=='active'


def test_bar_tf_skip_processes_every_source_bar_and_rewind_preserves_closed(client):
    values=[dict(b) for b in __import__('test_replay').bars()]
    values[32].update(high=105)
    s=start(client,dataset(client,values),workspace='backtest',start_time=1767225600+31*300,initial_balance=1000,target_trades=20,point_value=100,goal='Practice')
    s=tf(client,s,'M15');s=position(client,s).json();s=step(client,s)
    assert s['cursor']==32 and s['trades'][0]['exit_reason']=='TP' # Stops on crossed M5 fill, not next M15 boundary.
    closed=s['trades'][0];s=rewind(client,s)
    assert s['cursor']==29 and s['trades'][0]==closed
    s=step(client,s);assert s['cursor']==30
    s=step(client,s);assert s['cursor']==33


def test_tick_multi_positions_partial_close_money_and_atomic_close_all(client,tick_dataset):
    s=profile(client,tick_dataset,commission_r=.1)
    s=position(client,s,entry=101,sl=90,tp=130,lot=.1).json()
    s=position(client,s,side='SELL',entry=100,sl=130,tp=80,lot=.2).json()
    ids=[t['id'] for t in s['trades']]
    s=advance(client,s,one_tick=True);assert all(t['status']=='open' for t in s['trades'])
    assert s['accounting']['floating_pnl']==pytest.approx(-30)
    s=advance(client,s,one_tick=True)
    assert s['accounting']['floating_pnl']==pytest.approx(-120)
    assert [t['floating_pnl'] for t in s['trades']]==pytest.approx([80,-200])
    assert client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision']}).status_code==422
    revision=s['revision']
    for invalid,status in [({'trade_id':'missing'},404),({'trade_id':ids[0],'lot':.11},422),({'trade_id':ids[0],'lot':0},422)]:
        assert client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':revision,**invalid}).status_code==status
    result=client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':revision,'trade_id':ids[0],'lot':.04});assert result.status_code==200,result.text
    s=result.json();buy=s['trades'][0]
    assert buy['status']=='open' and buy['remaining_lot']==pytest.approx(.06)
    assert buy['decision']['lot']==.1 and buy['decision']['reason']=='manual level'
    assert buy['realized_pnl']==pytest.approx(27.2)
    assert s['accounting']['balance']==pytest.approx(1027.2)
    assert s['accounting']['floating_pnl']==pytest.approx(-152)
    assert s['stats']['trades']==0
    fill=buy['decision']['partial_exits'][0]
    assert fill['exit_time_ms']==s['replay_time_ms'] and fill['exit_tick_index']==s['cursor']
    assert fill['price']==fill['exit_bid']==110 and fill['exit_ask']==111
    assert client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':revision,'trade_id':ids[0],'lot':.04}).status_code==409
    s=client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision'],'trade_id':ids[1],'lot':.05}).json()
    assert s['trades'][1]['remaining_lot']==pytest.approx(.15)
    assert s['accounting']['balance']==pytest.approx(962.7)
    assert client.get(f"{BASE}/sessions/{s['id']}").json()==s
    s=client.post(f"{BASE}/sessions/{s['id']}/close-all",json={'revision':s['revision']}).json()
    assert all(t['status']=='closed' and t['remaining_lot']==0 for t in s['trades'])
    assert [t['money_pnl'] for t in s['trades']]==pytest.approx([68,-258])
    assert s['accounting']['balance']==s['accounting']['equity']==pytest.approx(810)
    assert s['stats']['trades']==2 and s['stats']['wins']==1 and s['stats']['losses']==1
    assert s['accounting']['floating_pnl']==0
    assert sum(t['money_pnl'] for t in s['trades'])==pytest.approx(s['accounting']['net_pnl'])


def test_multi_tick_auto_exits_process_all_orders_at_same_quote_and_keep_remaining_live(client,tick_dataset):
    s=profile(client,tick_dataset)
    for tp in [105,104,120]:s=position(client,s,entry=101,sl=90,tp=tp).json()
    s=advance(client,s,milliseconds=60000)
    assert [t['status'] for t in s['trades']]==['closed','closed','open']
    assert [t['exit_price'] for t in s['trades'][:2]]==[105,104]
    assert s['trades'][2]['current_price']==110
    assert s['accounting']['balance']==1050 and s['accounting']['floating_pnl']==80
    assert s['stats']['trades']==2
    partial=client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision'],'trade_id':s['trades'][2]['id'],'lot':.04}).json()
    amount=partial['accounting']['balance']
    rewound=rewind(client,partial)
    assert rewound['trades'][2]['status']=='cancelled'
    assert rewound['accounting']['balance']==amount
    assert rewound['accounting']['floating_pnl']==0


def test_random_tick_profiles_use_indexed_tf_warmup_and_resume_stays_fixed(client,tick_dataset,monkeypatch):
    monkeypatch.setattr('tradequest.tick_store.secrets.randbelow',lambda n:0)
    first=profile(client,tick_dataset,start_time=None)
    monkeypatch.setattr('tradequest.tick_store.secrets.randbelow',lambda n:n-1)
    last=profile(client,tick_dataset,start_time=None)
    assert first['cursor']<last['cursor']<last['end_cursor']
    assert len(first['bars'])>=20 and len(last['bars'])>=20
    assert all(b['time']<=first['quote']['time_ms']//1000 for b in first['bars'])
    assert first['config']['start_policy']==last['config']['start_policy']=='random'
    assert first['config']['initial_cursor']==first['cursor']
    assert client.get(f"{BASE}/sessions/{first['id']}").json()==first

@pytest.mark.parametrize('sl,tp,partial_tick,reason,expected',[(90,105,1,'TP',2),(98,120,2,'SL',-14)])
def test_partial_volume_then_automatic_exit_banks_only_remaining_lot(client,tick_dataset,sl,tp,partial_tick,reason,expected):
    s=profile(client,tick_dataset,commission_r=.1)
    s=position(client,s,entry=101,sl=sl,tp=tp,lot=.1).json()
    for _ in range(partial_tick):s=advance(client,s,one_tick=True)
    original=s['trades'][0]['decision'].copy()
    r=client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision'],'trade_id':s['trades'][0]['id'],'lot':.04})
    assert r.status_code==200,r.text
    s=r.json();banked=s['trades'][0]['realized_pnl']
    s=advance(client,s,one_tick=True);t=s['trades'][0]
    assert t['exit_reason']==reason and t['remaining_lot']==0
    assert t['decision']['lot']==original['lot']==.1
    assert t['decision']['initial_stop']==original['initial_stop']
    assert t['decision']['final_exit_lot']==pytest.approx(.06)
    assert t['money_pnl']==pytest.approx(expected)
    assert s['accounting']['balance']==pytest.approx(1000+expected)
    assert t['realized_pnl']==pytest.approx(expected)
    assert s['stats']['trades']==1 and s['accounting']['floating_pnl']==0
    assert t['decision']['partial_exits'][0]['money_pnl']==banked
