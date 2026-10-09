"""Local script library. Source is stored as text, never evaluated on the server."""
from copy import deepcopy
from hashlib import sha256
import re
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from .models import Setting
from .db import now

PREFIX='pine-script:'
RUNTIME_VERSION='0.11.0'

class ScriptInput(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    name:str=Field(min_length=1,max_length=100)
    source:str=Field(min_length=1,max_length=40000)
    base_version:int|None=Field(default=None,ge=1)
    @model_validator(mode='after')
    def validate_source(self):
        if not self.name.strip():raise ValueError('ระบุชื่ออินดิเคเตอร์')
        if not re.match(r'^(?:\s*//[^\n]*\n)*\s*//@version=[56][ \t]*\r?(?:\n|$)',self.source.lstrip('\ufeff')):raise ValueError('ระบุ //@version=5 หรือ //@version=6 ก่อนโค้ด (มีคอมเมนต์ลิขสิทธิ์ก่อนหน้าได้)')
        return self

class PineIndicator(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    id:str=Field(min_length=1,max_length=80)
    kind: str=Field(pattern='^PINE$')
    script_id:str=Field(min_length=1,max_length=36)
    script_version:int=Field(ge=1)
    name:str=Field(min_length=1,max_length=100)
    source:str=Field(min_length=1,max_length=40000)
    source_hash:str=Field(pattern=r'^[a-f0-9]{64}$')
    runtime_version:str=Field(pattern=r'^0\.11\.0$')
    inputs:dict[str,float|bool|str]=Field(default_factory=dict,max_length=100)
    @model_validator(mode='after')
    def input_limits(self):
        if any(len(k)>100 or (isinstance(v,str) and len(v)>500) for k,v in self.inputs.items()):raise ValueError('ค่า input ยาวเกินกำหนด')
        return self


def record(db,id,write=False):
    query=select(Setting).where(Setting.key==PREFIX+id).execution_options(populate_existing=True)
    if write:query=query.with_for_update()
    r=db.scalar(query)
    if not r:raise HTTPException(404,'ไม่พบสคริปต์')
    return r


def catalog(db):
    return [deepcopy(r.value) for r in db.scalars(select(Setting).where(Setting.key.startswith(PREFIX)))]


def store(db,body,id=None):
    if id:
        row=record(db,id,write=True); value=deepcopy(row.value)
        if value['archived']:raise HTTPException(409,'สคริปต์นี้อยู่ในคลังที่เก็บแล้ว')
        if body.base_version!=value['latest_version']:raise HTTPException(409,'สคริปต์มีเวอร์ชันใหม่แล้ว เปิดจากคลังอีกครั้ง')
        if len(value['versions'])>=100:raise HTTPException(422,'ครบ 100 เวอร์ชันแล้ว กรุณาบันทึกเป็นสคริปต์ใหม่')
    else:
        if body.base_version is not None:raise HTTPException(422,'สคริปต์ใหม่ยังไม่มีเวอร์ชันเดิม')
        if len(catalog(db))>=100:raise HTTPException(422,'คลังครบ 100 สคริปต์แล้ว')
        id=str(uuid4());value={'id':id,'latest_version':0,'archived':False,'versions':[]}
        row=Setting(key=PREFIX+id,value=value);db.add(row)
    version=value['latest_version']+1
    source=body.source.replace('\r\n','\n')
    value['versions'].append({'version':version,'name':body.name.strip(),'source':source,'source_hash':sha256(source.encode()).hexdigest(),'runtime_version':RUNTIME_VERSION,'created_at':now().isoformat()})
    value['latest_version']=version;row.value=value;db.commit()
    return value


def archive(db,id,base_version):
    row=record(db,id,write=True);value=deepcopy(row.value)
    if base_version!=value['latest_version']:raise HTTPException(409,'สคริปต์มีเวอร์ชันใหม่แล้ว')
    value['archived']=True;row.value=value;db.commit();return value


def freeze(db,item,existing):
    value=record(db,item.script_id).value
    versions=[v for v in value['versions'] if v['version']==item.script_version]
    if not versions:raise HTTPException(422,'ไม่พบเวอร์ชันสคริปต์')
    snapshot=versions[0]
    fields=['name','source','source_hash','runtime_version']
    if any(getattr(item,k)!=snapshot[k] for k in fields):raise HTTPException(422,'เนื้อหาสคริปต์ไม่ตรงเวอร์ชันในคลัง')
    if value['archived'] and not any(x.get('id')==item.id and x.get('script_id')==item.script_id and x.get('script_version')==item.script_version for x in existing):raise HTTPException(422,'สคริปต์ถูกเก็บแล้ว เพิ่มใหม่ไม่ได้')
    return item.model_dump()
