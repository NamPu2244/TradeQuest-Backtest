"""Common index contract for immutable local SQLite and range-read cloud files."""
import sqlite3
from contextlib import contextmanager

class LocalIndex:
    def __init__(self, db): self.db = db
    def before(self, tf, stamp, limit):
        return list(reversed(self.db.execute('SELECT time,open,high,low,close,volume,first_idx,last_idx FROM frames WHERE tf=? AND time<? ORDER BY time DESC LIMIT ?', (tf, stamp, limit)).fetchall()))
    def between(self, start, end):
        return self.db.execute('SELECT time,open,high,low,close,volume,first_idx,last_idx FROM minutes WHERE time>=? AND time<? ORDER BY time', (start, end)).fetchall()
    def first(self, minute):
        row = self.db.execute('SELECT first_idx FROM minutes WHERE time=?', (minute,)).fetchone()
        return row[0] if row else None
    def count(self, tf, end=None):
        if end is None: return self.db.execute('SELECT count(*) FROM frames WHERE tf=?', (tf,)).fetchone()[0]
        return self.db.execute('SELECT count(*) FROM frames WHERE tf=? AND last_idx<?', (tf, end)).fetchone()[0]
    def at(self, tf, offset):
        return self.db.execute('SELECT time,open,high,low,close,volume,first_idx,last_idx FROM frames WHERE tf=? ORDER BY time LIMIT 1 OFFSET ?', (tf, offset)).fetchone()

@contextmanager
def open_index(dataset):
    from .auth import CLOUD
    if CLOUD:
        from .cloud_ticks import RemoteIndex
        yield RemoteIndex(dataset)
    else:
        from .tick_store import folder
        with sqlite3.connect((folder(dataset) / 'bars.sqlite3').as_uri() + '?mode=ro', uri=True) as db:
            yield LocalIndex(db)
