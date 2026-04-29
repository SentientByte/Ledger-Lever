from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime
from .database import Base


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True, nullable=False)
    name = Column(String)
    shares = Column(Float, nullable=False)
    avg_cost = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True, nullable=False)
    price = Column(Float)
    prev_close = Column(Float)
    day_high = Column(Float)
    day_low = Column(Float)
    volume = Column(Float)
    market_cap = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    total_value = Column(Float, nullable=False)
    total_cost = Column(Float, nullable=False)
    day_gain = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
