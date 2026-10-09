"""Profile money, discretionary entry and optional reflection use isolated practice data."""
import pytest
from sqlalchemy import select, func
from tradequest.models import ReplayTrade
from tradequest.db import Base
from test_replay import dataset, bars, start, step, BASE


def profile(client, values=None, **kwargs):
    return start(client, dataset(client, values), **{'workspace':'backtest','start_time':1767225600+31*300,'initial_balance':1000,'currency':'USD','target_trades':2,'goal':'practice patience','point_value':100,**kwargs})


def position(client, s, **kwargs):
    return client.post(f"{BASE}/sessions/{s['id']}/positions", json={'revision':s['revision'],'side':'BUY','order_type':'MARKET','entry':100,'sl':98,'tp':104,'lot':.1,'reason':'manual level','emotion':'calm',**kwargs})


def close(client,s):
    result=client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision']})
    assert result.status_code==200,result.text
    return result.json()


def test_profile_preserves_fields_blank_chart_and_no_future_bars(client):
    s=profile(client)
    assert s['config']['initial_balance']==1000 and s['config']['target_trades']==2
    assert s['config']['goal']=='practice patience' and s['config']['point_value']==100
    assert s['indicators']==[] and s['drawings']==[]
    assert s['accounting']['balance']==s['accounting']['equity']==1000
    assert len(s['bars'])==31
    assert client.get(f"{BASE}/sessions/{s['id']}").json()==s
    saved=client.get(BASE+'/sessions').json()[0]
    assert saved['config']==s['config']
    assert 'bars' not in saved and 'bars' not in saved['dataset']


@pytest.mark.parametrize('missing',['initial_balance','target_trades','point_value','goal'])
def test_profile_required_details_enforced_by_server(client,missing):
    body={'dataset_id':dataset(client)['id'],'workspace':'backtest','initial_balance':1000,'target_trades':2,'point_value':100,'goal':'practice'}
    del body[missing]
    assert client.post(BASE+'/sessions',json=body).status_code==422


@pytest.mark.parametrize('changes',[{'lot':0},{'sl':101},{'tp':99}])
def test_position_cannot_bypass_volume_or_geometry(client,changes):
    s=profile(client)
    assert position(client,s,**changes).status_code==422
    assert client.get(f"{BASE}/sessions/{s['id']}").json()['trades']==[]


def test_profile_entry_has_no_setup_gate_and_cannot_use_old_order_endpoint(client):
    s=profile(client)
    result=position(client,s);assert result.status_code==200,result.text
    t=result.json()['trades'][0]
    assert t['status']=='pending' and t['playbook_snapshot']=={}
    assert t['decision']['reason']=='manual level' and t['decision']['emotion']=='calm'
    assert 'confirm_detected' not in t['decision']
    assert client.post(f"{BASE}/sessions/{s['id']}/orders",json={'revision':1,'side':'BUY','sl':98,'tp':104,'playbook_id':'trend-sr-confirm','playbook_version':1,'confirm_detected':True,'confirm_candle_closed':True}).status_code==404
    assert position(client,s).status_code==409
    assert position(client,result.json()).status_code==200
    assert client.post(BASE+'/sessions',json={'dataset_id':s['dataset']['id'],'workspace':'legacy'}).status_code==422


def test_money_uses_actual_fill_lot_point_value_spread_and_one_commission(client,db):
    values=bars();values[31].update(open=100.5,high=101.5,low=100,close=101)
    s=profile(client,values,spread=.2,commission_r=.1)
    s=step(client,position(client,s).json())
    assert s['trades'][0]['entry_price']==pytest.approx(100.7)
    assert s['accounting']['balance']==1000
    assert s['accounting']['floating_pnl']==pytest.approx(3)
    assert s['accounting']['equity']==pytest.approx(1003)
    s=close(client,s);t=s['trades'][0]
    assert t['money_pnl']==pytest.approx(.3*10-2.7*10*.1)
    assert s['accounting']['balance']==pytest.approx(1000.3)
    assert s['accounting']['net_pnl']==pytest.approx(.3)
    assert s['accounting']['floating_pnl']==0
    assert s['stats']['by_setup']==[]
    assert set(Base.metadata.tables)=={'replay_datasets','replay_sessions','replay_trades','settings'}
    assert client.get(BASE+'/stats').status_code==200


@pytest.mark.parametrize('side,entry,sl,tp,next_bar,expected',[
    ('BUY',102,99,104,{'open':103,'high':104.5,'low':103,'close':104},10),
    ('SELL',98,101,96,{'open':97,'high':97,'low':95.5,'close':96},10),
])
def test_stop_orders_fill_at_gap_price_and_money_is_directional(client,side,entry,sl,tp,next_bar,expected):
    values=bars();values[32].update(**next_bar)
    s=profile(client,values)
    result=position(client,s,side=side,order_type='STOP',entry=entry,sl=sl,tp=tp)
    assert result.status_code==200,result.text
    s=step(client,result.json());assert s['trades'][0]['status']=='pending'
    s=step(client,s);assert s['trades'][0]['status']=='closed'
    assert s['trades'][0]['entry_price']==next_bar['open']
    assert s['trades'][0]['exit_reason']=='TP'
    assert s['trades'][0]['money_pnl']==expected
    assert s['accounting']['balance']==1000+expected


def test_stop_both_hits_uses_sl_first_and_gap_stop_can_exceed_risk(client):
    values=bars();values[31].update(open=100,high=106,low=95,close=100)
    s=profile(client,values);s=step(client,position(client,s,order_type='STOP',entry=102,sl=98,tp=104).json())
    assert s['trades'][0]['ambiguous'] and s['trades'][0]['money_pnl']==-40
    values=bars();values[32].update(open=95,high=96,low=94,close=95)
    s=profile(client,values);s=step(client,position(client,s).json());s=step(client,s)
    assert s['trades'][0]['net_r']==-2.5 and s['accounting']['balance']==950


def test_optional_reflection_after_finish_owns_trade_and_preserves_entry(client):
    s=profile(client);s=step(client,position(client,s).json());s=close(client,s)
    trade=s['trades'][0];decision=trade['decision']
    assert trade['review'] is None
    s=client.post(f"{BASE}/sessions/{s['id']}/finish",json={'revision':s['revision']}).json()
    route=f"{BASE}/sessions/{s['id']}/trades/{trade['id']}/reflection"
    result=client.put(route,json={'emotion':'relieved','feelings':'waited well','feedback':'be patient'})
    assert result.status_code==200,result.text
    saved=result.json()['trades'][0]
    assert saved['decision']==decision and saved['review']['feedback']=='be patient'
    balance=result.json()['accounting']
    empty=client.put(route,json={});assert empty.status_code==200
    assert empty.json()['accounting']==balance and empty.json()['trades'][0]['decision']==decision
    other=profile(client)
    assert client.put(f"{BASE}/sessions/{other['id']}/trades/{trade['id']}/reflection",json={}).status_code==404
    pending=position(client,other).json()['trades'][0]
    assert client.put(f"{BASE}/sessions/{other['id']}/trades/{pending['id']}/reflection",json={}).status_code==422
    assert client.get(f"{BASE}/sessions/{s['id']}").json()['status']=='finished'


def test_empty_simulated_balance_blocks_new_entries_without_resetting_results(client):
    values=bars();values[32].update(open=95,high=96,low=94,close=95)
    s=profile(client,values,initial_balance=1,currency='USC')
    s=step(client,position(client,s).json());s=step(client,s)
    assert s['accounting']['balance']==-49 and s['accounting']['currency']=='USC'
    assert position(client,s).status_code==422
    saved=client.get(f"{BASE}/sessions/{s['id']}").json()
    assert len(saved['trades'])==1 and saved['accounting']==s['accounting']


def test_position_visual_frame_is_frozen_without_changing_fill_time_or_journal(client):
    s=profile(client);anchor=s['bars'][-1]['time']+10000
    result=position(client,s,drawing_time=anchor,drawing_end_time=anchor+333)
    assert result.status_code==200,result.text
    s=result.json();decision=s['trades'][0]['decision']
    assert decision['position_drawing']=={'time':anchor,'end_time':anchor+333}
    assert decision['candle_time']<anchor
    assert s['trades'][0]['entry_time'] is None
    s=step(client,s);t=s['trades'][0]
    assert t['entry_time']<anchor and t['decision']['position_drawing']==decision['position_drawing']
    assert t['decision']['reason']=='manual level' and t['decision']['emotion']=='calm'


@pytest.mark.parametrize('coordinates',[{'drawing_time':10},{'drawing_end_time':20},{'drawing_time':20,'drawing_end_time':10},{'drawing_time':-1,'drawing_end_time':20}])
def test_invalid_position_drawing_coordinates_rejected(client,coordinates):
    s=profile(client)
    assert position(client,s,**coordinates).status_code==422
    assert client.get(f"{BASE}/sessions/{s['id']}").json()['trades']==[]


def test_multi_bar_orders_close_by_id_partial_tp_and_pending_cancel(client):
    values=bars();values[32].update(high=105,close=104)
    s=profile(client,values)
    s=position(client,s,tp=110).json()
    s=position(client,s,order_type='LIMIT',entry=97,sl=90,tp=110).json()
    pending=s['trades'][1]['id']
    s=step(client,s);first=s['trades'][0]['id']
    assert [t['status'] for t in s['trades']]==['open','pending']
    assert client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision'],'trade_id':pending,'lot':.01}).status_code==422
    other=profile(client)
    assert client.post(f"{BASE}/sessions/{other['id']}/close",json={'revision':other['revision'],'trade_id':first}).status_code==404
    s=client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision'],'trade_id':pending}).json()
    assert s['trades'][0]['status']=='open' and s['trades'][1]['status']=='cancelled'
    s=step(client,s)
    s=client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision'],'trade_id':first,'lot':.03}).json()
    assert s['trades'][0]['remaining_lot']==pytest.approx(.07)
    assert s['accounting']['balance']==pytest.approx(1012)
    assert s['accounting']['floating_pnl']==pytest.approx(28)
    s=client.post(f"{BASE}/sessions/{s['id']}/close",json={'revision':s['revision'],'trade_id':first,'lot':.07}).json()
    assert s['stats']['trades']==1 and s['trades'][0]['money_pnl']==pytest.approx(40)
    assert s['accounting']['balance']==1040


def test_random_bar_profiles_cover_eligible_window_without_rewriting_legacy(client,monkeypatch):
    from test_replay import dataset
    d=dataset(client,bars(1200))
    body={'dataset_id':d['id'],'workspace':'backtest','initial_balance':1000,'target_trades':20,'point_value':100,'goal':'Random practice'}
    monkeypatch.setattr('tradequest.replay_routes.secrets.randbelow',lambda n:0)
    first=client.post(BASE+'/sessions',json=body).json()
    monkeypatch.setattr('tradequest.replay_routes.secrets.randbelow',lambda n:n-1)
    last=client.post(BASE+'/sessions',json=body).json()
    assert 249==first['cursor']<last['cursor']<last['end_cursor']-19
    assert first['config']['start_policy']=='random'
    assert client.get(f"{BASE}/sessions/{first['id']}").json()==first
    resumed=client.get(f"{BASE}/sessions/{first['id']}").json()
    assert resumed['config']['initial_cursor']==first['cursor']
    assert client.post(BASE+'/sessions',json={**body,'workspace':'legacy'}).status_code==422
    small=dataset(client,bars(30))
    for tf in ['M5','M15']:
        response=client.post(BASE+'/sessions',json={**body,'dataset_id':small['id'],'timeframe':tf})
        if tf=='M5':assert response.status_code==200 and 19<=response.json()['cursor']<29
        else:assert response.status_code==422


def test_new_order_needs_no_reason_or_emotion_and_broker_routes_do_not_exist(client):
    s=profile(client)
    response=client.post(f"{BASE}/sessions/{s['id']}/positions",json={'revision':s['revision'],'side':'BUY','order_type':'MARKET','entry':100,'sl':98,'tp':104,'lot':.1})
    assert response.status_code==200,response.text
    t=response.json()['trades'][0]
    assert t['decision']['reason']==t['decision']['emotion']==''
    assert client.get('/api/v1/accounts').status_code==404
    assert client.post('/api/v1/bridge/heartbeat',json={}).status_code==404
    assert client.get(BASE+'/broker-snapshots').status_code==404
