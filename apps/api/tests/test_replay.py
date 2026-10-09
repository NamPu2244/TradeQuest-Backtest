import csv,io
BASE='/api/v1/replay'
def bars(n=90):
    return [{'time':1767225600+i*300,'open':100.,'high':101.,'low':99.,'close':100.,'volume':10.} for i in range(n)]


def dataset(client,values=None):
    values=values or bars()
    stream=io.StringIO();w=csv.DictWriter(stream,fieldnames=values[0].keys());w.writeheader();w.writerows(values)
    response=client.post(BASE+'/datasets/import',files={'file':('bars.csv',stream.getvalue(),'text/csv')},data={'name':'TEST history','symbol':'TEST','timeframe':'M5','utc_offset_minutes':'0'})
    assert response.status_code==200,response.text
    return response.json()


def start(client,d=None,**kwargs):
    d=d or dataset(client)
    response=client.post(BASE+'/sessions',json={'dataset_id':d['id'],'workspace':'backtest','initial_balance':1000,'target_trades':20,'point_value':100,'goal':'Practice','start_time':1767225600+31*300,**kwargs})
    assert response.status_code==200,response.text
    return response.json()


def order(client,s,**kwargs):
    payload={'revision':s['revision'],'side':'BUY','order_type':'MARKET','entry':100,'sl':98,'tp':104,'lot':.1,**kwargs}
    return client.post(BASE+'/sessions/'+s['id']+'/positions',json=payload)


def step(client,s,**kwargs):
    r=client.post(BASE+'/sessions/'+s['id']+'/step',json={'revision':s['revision'],**kwargs});assert r.status_code==200,r.text;return r.json()
