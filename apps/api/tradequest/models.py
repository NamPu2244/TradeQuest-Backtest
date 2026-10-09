import uuid
from sqlalchemy import String,Float,Integer,Boolean,DateTime,ForeignKey,JSON
from sqlalchemy.orm import Mapped,mapped_column
from .db import Base,now

def uid():return str(uuid.uuid4())

class Setting(Base):
    owner_id: Mapped[str] = mapped_column(String(36), default='local', server_default='local', index=True)
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class ReplayDataset(Base):
    owner_id: Mapped[str] = mapped_column(String(36), default='local', server_default='local', index=True)
    __tablename__ = "replay_datasets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(150))
    symbol: Mapped[str] = mapped_column(String(40))
    timeframe: Mapped[str] = mapped_column(String(8))
    source: Mapped[str] = mapped_column(String(80))
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    bars: Mapped[list] = mapped_column(JSON)
    metadata_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), default=now)


class ReplaySession(Base):
    owner_id: Mapped[str] = mapped_column(String(36), default='local', server_default='local', index=True)
    __tablename__ = "replay_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("replay_datasets.id"))
    name: Mapped[str] = mapped_column(String(150))
    cursor: Mapped[int] = mapped_column(Integer)
    end_cursor: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="active")
    config_json: Mapped[dict] = mapped_column(JSON)
    drawings: Mapped[list] = mapped_column(JSON, default=list)
    indicators: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), default=now)


class ReplayTrade(Base):
    owner_id: Mapped[str] = mapped_column(String(36), default='local', server_default='local', index=True)
    __tablename__ = "replay_trades"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("replay_sessions.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    side: Mapped[str] = mapped_column(String(4))
    order_type: Mapped[str] = mapped_column(String(8))
    requested_entry: Mapped[float | None] = mapped_column(Float, nullable=True)
    entry_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_price: Mapped[float] = mapped_column(Float)
    target_price: Mapped[float] = mapped_column(Float)
    entry_time: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exit_time: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    net_r: Mapped[float | None] = mapped_column(Float, nullable=True)
    exit_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ambiguous: Mapped[bool] = mapped_column(Boolean, default=False)
    playbook_snapshot: Mapped[dict] = mapped_column(JSON)
    decision: Mapped[dict] = mapped_column(JSON)
    review: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), default=now)
