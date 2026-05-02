from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, UniqueConstraint
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


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True, nullable=False)
    listing_exchange = Column(String, nullable=True)
    dt = Column(DateTime, nullable=False, index=True)
    quantity = Column(Float, nullable=False)   # positive = BUY, negative = SELL
    price = Column(Float, nullable=False)
    commission = Column(Float, nullable=False, default=0.0)
    side = Column(String, nullable=False)       # "BUY" or "SELL"
    notional = Column(Float, nullable=False)    # abs(quantity) * price
    net = Column(Float, nullable=False)         # BUY: -(notional+commission), SELL: +(notional-commission)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "dt", "quantity", "price", name="uq_transaction"),
    )


class CachedPosition(Base):
    """FIFO-computed positions from the transactions ledger, persisted to avoid recomputation."""
    __tablename__ = "cached_positions"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, unique=True, index=True, nullable=False)
    listing_exchange = Column(String, nullable=True)
    quantity = Column(Float, nullable=False)
    avg_cost = Column(Float, nullable=False)
    cost_basis = Column(Float, nullable=False)
    first_lot_date = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow)


class HistoricalPriceBar(Base):
    """Daily OHLCV bars fetched from yfinance and cached to avoid repeated API calls."""
    __tablename__ = "historical_price_bars"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float, nullable=False)
    volume = Column(Float)

    __table_args__ = (
        UniqueConstraint("symbol", "date", name="uq_hist_price_bar"),
    )


class CachedMetrics(Base):
    """Aggregate portfolio metrics derived from transactions, persisted to avoid recomputation."""
    __tablename__ = "cached_metrics"

    id = Column(Integer, primary_key=True)
    fills = Column(Integer, nullable=False, default=0)
    realized_pnl = Column(Float, nullable=False, default=0.0)
    total_invested = Column(Float, nullable=False, default=0.0)
    active_positions = Column(Integer, nullable=False, default=0)
    last_fill = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)
