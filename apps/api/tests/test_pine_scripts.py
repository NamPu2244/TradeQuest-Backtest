from copy import deepcopy
import pytest
from test_replay import start, order, BASE
SOURCE='//@version=6\nindicator("EMA", overlay=true)\nplot(ta.ema(close, 5), "EMA")\n'


def create(client, **kwargs):
    r=client.post(BASE+'/pine-scripts',json={'name':'My EMA','source':SOURCE,**kwargs})
    assert r.status_code==200,r.text
    return r.json()


def indicator(script,version=None):
    v=script['versions'][(version or script['latest_version'])-1]
    return {'id':'my-pine','kind':'PINE','script_id':script['id'],'script_version':v['version'],**{k:v[k] for k in ['name','source','source_hash','runtime_version']},'inputs':{'in_0':5,'test':True}}


def visuals(client,s,items):
    return client.put(BASE+'/sessions/'+s['id']+'/visuals',json={'revision':s['revision'],'drawings':s['drawings'],'indicators':items})


def test_versions_and_preentry_snapshot_survive_edit_archive_resume(client):
    script=create(client);s=start(client)
    s=visuals(client,s,[indicator(script)]).json()
    frozen=deepcopy(s['indicators'][0])
    s=order(client,s).json()
    edited=client.put(BASE+'/pine-scripts/'+script['id'],json={'name':'Renamed','source':SOURCE.replace('5','10'),'base_version':1})
    assert edited.status_code==200,edited.text
    assert edited.json()['versions'][0]==script['versions'][0]
    assert edited.json()['latest_version']==2
    assert client.put(BASE+'/pine-scripts/'+script['id'],json={'name':'stale','source':SOURCE,'base_version':1}).status_code==409
    assert client.delete(BASE+'/pine-scripts/'+script['id']+'?base_version=1').status_code==409
    assert client.delete(BASE+'/pine-scripts/'+script['id']+'?base_version=2').status_code==200
    latest=client.get(BASE+'/sessions/'+s['id']).json()
    assert latest['trades'][0]['decision']['indicators']==[frozen]
    assert latest['indicators']==[frozen]
    assert visuals(client,latest,[{**frozen,'inputs':{'in_0':9}}]).status_code==200
    newer=client.get(BASE+'/sessions/'+s['id']).json()
    assert newer['trades'][0]['decision']['indicators']==[frozen]
    assert visuals(client,newer,[{**frozen,'id':'new-on-archived'}]).status_code==422
    assert client.get(BASE+'/pine-scripts').json()[0]['archived']
    assert create(client)['latest_version']==1


@pytest.mark.parametrize('field,value',[('source',SOURCE+'plot(close)'),('name','forged'),('source_hash','f'*64),('runtime_version','0.1.0'),('script_version',2)])
def test_frozen_source_must_match_registered_version(client,field,value):
    script=create(client);s=start(client);i=indicator(script);i[field]=value
    assert visuals(client,s,[i]).status_code==422
    assert client.get(BASE+'/sessions/'+s['id']).json()['indicators']==s['indicators']


@pytest.mark.parametrize('body',[{'name':'','source':SOURCE},{'name':'   ','source':SOURCE},{'name':'x','source':'plot(close)'},{'name':'x','source':'//@version=4\nplot(close)'},{'name':'x','source':'//@version=6\n'+'x'*40000}])
def test_source_boundaries(client,body):
    assert client.post(BASE+'/pine-scripts',json=body).status_code==422


def test_access_duplicates_and_input_limits(client):
    script=create(client);s=start(client);i=indicator(script)
    assert visuals(client,s,[i,i]).status_code==422
    assert visuals(client,s,[{**i,'inputs':{'huge':'x'*501}}]).status_code==422
    client.headers.clear()
    assert client.get(BASE+'/pine-scripts').status_code in [401,403]
    assert client.post(BASE+'/pine-scripts',json={'name':'x','source':SOURCE}).status_code in [401,403]


@pytest.mark.parametrize('version',[5,6])
def test_license_comments_before_version_preserved(client,version):
    source='// License and attribution\r\n// Author\r\n\r\n//@version='+str(version)+'\r\nindicator("Comments")\r\nplot(close)'
    r=client.post(BASE+'/pine-scripts',json={'name':'Comments','source':source})
    assert r.status_code==200
    assert r.json()['versions'][0]['source']==source.replace('\r\n','\n')
