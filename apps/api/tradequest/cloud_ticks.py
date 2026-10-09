"""Bounded private R2 range reads; no full-year download or future bars sent to clients."""
import os
import re
import struct
from collections import OrderedDict
from functools import lru_cache
from threading import RLock
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

BAR = struct.Struct('<qdddddqq')  # time, OHLC, volume, first/last tick index
TICK = struct.Struct('<qdd')
LIMIT = 48 * 1024 * 1024
_cache = OrderedDict()
_bytes = 0
_lock = RLock()

@lru_cache(maxsize=1)
def storage():
    account = os.getenv('R2_ACCOUNT_ID', '')
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account) or not all(os.getenv(k) for k in ('R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')):
        raise HTTPException(503, 'Tick storage is not configured (Cloudflare R2)')
    return boto3.client('s3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com',
                        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
                        region_name='auto', config=Config(connect_timeout=5, read_timeout=15, retries={'max_attempts': 2}))

def descriptor(dataset):
    value = dataset.metadata_json.get('cloud_ticks', {})
    if value.get('version') != 1 or not re.fullmatch(r'markets/[a-zA-Z0-9_-]{1,100}/[a-f0-9]{64}', value.get('prefix', '')):
        raise HTTPException(409, 'Upload this tick dataset to cloud storage first')
    return value

class RangeFile:
    def __init__(self, prefix, name, info, block):
        if not re.fullmatch(r'(ticks\.bin|M1\.idx|M5\.idx|M15\.idx|M30\.idx|H1\.idx|H4\.idx|D1\.idx)', name):
            raise HTTPException(409, 'Invalid market index')
        self.key = prefix + '/' + name
        self.size = info['size']
        self.etag = info['etag']
        self.block = block
        if not isinstance(self.size, int) or self.size <= 0 or not isinstance(self.etag, str) or len(self.etag) > 100:
            raise HTTPException(409, 'Invalid market index')
    def read(self, start, count):
        if start < 0 or start + count > self.size: raise HTTPException(409, 'Market index is incomplete')
        pieces = []
        while count:
            block_start = start // self.block * self.block
            cache_key = (os.getenv('R2_ACCOUNT_ID'), os.getenv('R2_BUCKET'), self.key, self.etag, block_start)
            with _lock:
                payload = _cache.get(cache_key)
                if payload is None:
                    end = min(self.size, block_start + self.block) - 1
                    try:
                        response = storage().get_object(Bucket=os.environ['R2_BUCKET'], Key=self.key,
                            Range=f'bytes={block_start}-{end}', IfMatch=self.etag)
                        stream = response['Body']
                        try: payload = stream.read(end - block_start + 2)
                        finally: stream.close()
                        if (len(payload) != end - block_start + 1 or response.get('ETag') != self.etag or
                            response.get('ContentRange') != f'bytes {block_start}-{end}/{self.size}'):
                            raise HTTPException(409, 'Market archive changed or is incomplete')
                    except (ClientError, BotoCoreError, OSError):
                        raise HTTPException(503, 'Cannot read market archive') from None
                    global _bytes
                    _cache[cache_key] = payload
                    _bytes += len(payload)
                    while _bytes > LIMIT and _cache:
                        _, old = _cache.popitem(last=False)
                        _bytes -= len(old)
                else: _cache.move_to_end(cache_key)
            offset = start - block_start
            take = min(count, len(payload) - offset)
            pieces.append(payload[offset:offset + take]); start += take; count -= take
        return b''.join(pieces)

class RemoteIndex:
    def __init__(self, dataset):
        self.meta = descriptor(dataset)
        self.files = {}
        for tf, info in self.meta['indexes'].items():
            file = RangeFile(self.meta['prefix'], tf + '.idx', info, 64 * 1024)
            if file.size % BAR.size: raise HTTPException(409, 'Invalid market index size')
            self.files[tf] = file
    def at(self, tf, offset):
        file = self.files[tf]
        if offset < 0 or offset >= file.size // BAR.size: return None
        return BAR.unpack(file.read(offset * BAR.size, BAR.size))
    def bound(self, tf, value, field=0):
        low = 0; high = self.files[tf].size // BAR.size
        while low < high:
            mid = (low + high) // 2
            if self.at(tf, mid)[field] < value: low = mid + 1
            else: high = mid
        return low
    def before(self, tf, stamp, limit):
        end = self.bound(tf, stamp)
        start = max(0, end - limit)
        file = self.files[tf]
        return list(BAR.iter_unpack(file.read(start * BAR.size, (end - start) * BAR.size)))
    def between(self, start, end):
        first = self.bound('M1', start); last = self.bound('M1', end)
        file = self.files['M1']
        return list(BAR.iter_unpack(file.read(first * BAR.size, (last - first) * BAR.size)))
    def first(self, minute):
        row = self.at('M1', self.bound('M1', minute))
        return row[6] if row and row[0] == minute else None
    def count(self, tf, end=None):
        return self.files[tf].size // BAR.size if end is None else self.bound(tf, end, 7)

class RemoteQuotes:
    def __init__(self, dataset):
        meta = descriptor(dataset)
        self.file = RangeFile(meta['prefix'], 'ticks.bin', meta['ticks'], 24 * 65536)
        self.index = RemoteIndex(dataset)
        if self.file.size != dataset.metadata_json['tick_count'] * TICK.size:
            raise HTTPException(409, 'Invalid tick archive size')
    def __len__(self): return self.file.size
    def tick(self, index): return TICK.unpack(self.file.read(index * TICK.size, TICK.size))
    def bound_index(self, stamp, upper=False):
        # Narrow by minute before binary-searching tick timestamps; duplicate milliseconds retain source order.
        minute = stamp // 60000 * 60
        pos = self.index.bound('M1', minute)
        row = self.index.at('M1', pos)
        if row is None: return len(self) // TICK.size - 1 if upper else len(self) // TICK.size
        if row[0] != minute: return row[6] - 1 if upper else row[6]
        low = row[6]; high = row[7] + 1
        while low < high:
            mid = (low + high) // 2; time = self.tick(mid)[0]
            if time < stamp or upper and time == stamp: low = mid + 1
            else: high = mid
        return low - 1 if upper else low
