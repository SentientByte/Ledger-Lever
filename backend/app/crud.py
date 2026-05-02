from collections import deque
from datetime import datetime, timedelta, date as date_type
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import desc, asc, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, schemas


def get_positions(db: Session) -> List[models.Position]:
    return db.query(models.Position).all()


def get_position(db: Session, position_id: int) -> Optional[models.Position]:
    return db.query(models.Position).filter(models.Position.id == position_id).first()


def create_position(
    db: Session, position: schemas.PositionCreate, name: Optional[str] = None
) -> models.Position:
    obj = models.Position(
        symbol=position.symbol.upper(),
        name=name,
        shares=position.shares,
        avg_cost=position.avg_cost,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


def update_position(
    db: Session, position_id: int, update: schemas.PositionUpdate
) -> Optional[models.Position]:
    obj = get_position(db, position_id)
    if obj is None:
        return None
    if update.shares is not None:
        obj.shares = update.shares
    if update.avg_cost is not None:
        obj.avg_cost = update.avg_cost
    obj.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(obj)
    return obj


def delete_position(db: Session, position_id: int) -> bool:
    obj = get_position(db, position_id)
    if obj is None:
        return False
    db.delete(obj)
    db.commit()
    return True


def save_price_snapshot(db: Session, symbol: str, data: dict) -> None:
    snap = models.PriceSnapshot(
        symbol=symbol.upper(),
        price=data.get("price"),
        prev_close=data.get("prev_close"),
        day_high=data.get("day_high"),
        day_low=data.get("day_low"),
        volume=data.get("volume"),
        market_cap=data.get("market_cap"),
    )
    db.add(snap)
    db.commit()


def get_latest_prices(
    db: Session, symbols: List[str]
) -> Dict[str, models.PriceSnapshot]:
    result: Dict[str, models.PriceSnapshot] = {}
    if not symbols:
        return result
    # Batch query: get latest snapshot per symbol in two queries instead of N
    from sqlalchemy import func
    syms_upper = [s.upper() for s in symbols]
    # Subquery: max timestamp per symbol
    sub = (
        db.query(
            models.PriceSnapshot.symbol,
            func.max(models.PriceSnapshot.timestamp).label("max_ts"),
        )
        .filter(models.PriceSnapshot.symbol.in_(syms_upper))
        .group_by(models.PriceSnapshot.symbol)
        .subquery()
    )
    rows = (
        db.query(models.PriceSnapshot)
        .join(
            sub,
            (models.PriceSnapshot.symbol == sub.c.symbol)
            & (models.PriceSnapshot.timestamp == sub.c.max_ts),
        )
        .all()
    )
    for row in rows:
        result[row.symbol] = row
    return result


def save_portfolio_snapshot(
    db: Session, total_value: float, total_cost: float, day_gain: float
) -> None:
    snap = models.PortfolioSnapshot(
        total_value=total_value,
        total_cost=total_cost,
        day_gain=day_gain,
    )
    db.add(snap)
    db.commit()


def get_portfolio_performance(
    db: Session, days: int = 30
) -> List[models.PortfolioSnapshot]:
    since = datetime.utcnow() - timedelta(days=days)
    return (
        db.query(models.PortfolioSnapshot)
        .filter(models.PortfolioSnapshot.timestamp >= since)
        .order_by(models.PortfolioSnapshot.timestamp)
        .all()
    )


# ── Transactions ──────────────────────────────────────────────────────────────

def _make_transaction(
    symbol: str, dt: datetime, quantity: float, price: float, commission: float,
    listing_exchange: Optional[str] = None,
) -> models.Transaction:
    side = "BUY" if quantity > 0 else "SELL"
    notional = round(abs(quantity) * price, 2)
    if side == "BUY":
        net = round(-(notional + commission), 2)
    else:
        net = round(notional - commission, 2)
    return models.Transaction(
        symbol=symbol.upper(),
        listing_exchange=listing_exchange.upper() if listing_exchange else None,
        dt=dt,
        quantity=quantity,
        price=price,
        commission=commission,
        side=side,
        notional=notional,
        net=net,
    )


def create_transaction(
    db: Session, symbol: str, dt: datetime, quantity: float, price: float, commission: float,
    listing_exchange: Optional[str] = None,
) -> Tuple[Optional[models.Transaction], bool]:
    """Returns (transaction, was_duplicate)."""
    obj = _make_transaction(symbol, dt, quantity, price, commission, listing_exchange)
    try:
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj, False
    except IntegrityError:
        db.rollback()
        return None, True


def get_transactions(
    db: Session,
    symbol: Optional[str] = None,
    side: Optional[str] = None,
    page: int = 1,
    page_size: int = 10,
) -> Tuple[List[models.Transaction], int]:
    q = db.query(models.Transaction)
    if symbol:
        q = q.filter(models.Transaction.symbol == symbol.upper())
    if side:
        q = q.filter(models.Transaction.side == side.upper())
    total = q.count()
    items = q.order_by(desc(models.Transaction.dt)).offset((page - 1) * page_size).limit(page_size).all()
    return items, total


def get_all_transactions_sorted(db: Session) -> List[models.Transaction]:
    return db.query(models.Transaction).order_by(asc(models.Transaction.dt)).all()


def get_symbol_exchange_map(transactions: List[models.Transaction]) -> Dict[str, str]:
    """Returns the most recently set listing_exchange per symbol."""
    result: Dict[str, str] = {}
    for txn in transactions:
        if txn.listing_exchange:
            result[txn.symbol.upper()] = txn.listing_exchange.upper()
    return result


def delete_all_transactions(db: Session) -> None:
    db.query(models.Transaction).delete()
    db.commit()


def compute_fifo(transactions: List[models.Transaction]):
    """
    Returns:
      positions: dict symbol -> {quantity, avg_cost, cost_basis, first_lot_date}
      realized_pnl: float
      total_invested: float  (sum of all buy notionals + commissions)
    """
    lots: Dict[str, deque] = {}  # symbol -> deque of [qty, price, date]
    realized_pnl = 0.0
    total_invested = 0.0

    for txn in transactions:
        sym = txn.symbol
        if txn.quantity > 0:  # BUY
            if sym not in lots:
                lots[sym] = deque()
            lots[sym].append([float(txn.quantity), float(txn.price), txn.dt])
            total_invested += txn.quantity * txn.price + txn.commission
        else:  # SELL
            qty_to_sell = abs(txn.quantity)
            if sym in lots:
                remaining = qty_to_sell
                cost_basis_sold = 0.0
                while remaining > 1e-9 and lots[sym]:
                    lot = lots[sym][0]
                    lot_qty, lot_price = lot[0], lot[1]
                    if lot_qty <= remaining + 1e-9:
                        cost_basis_sold += lot_qty * lot_price
                        remaining -= lot_qty
                        lots[sym].popleft()
                    else:
                        cost_basis_sold += remaining * lot_price
                        lot[0] -= remaining
                        remaining = 0.0
                realized_pnl += qty_to_sell * txn.price - cost_basis_sold - txn.commission

    positions = {}
    for sym, lot_deque in lots.items():
        if not lot_deque:
            continue
        total_qty = sum(l[0] for l in lot_deque)
        total_cost = sum(l[0] * l[1] for l in lot_deque)
        first_lot_date = lot_deque[0][2]
        positions[sym] = {
            "symbol": sym,
            "quantity": round(total_qty, 6),
            "avg_cost": round(total_cost / total_qty, 4) if total_qty else 0,
            "cost_basis": round(total_cost, 2),
            "first_lot_date": first_lot_date,
        }

    return positions, round(realized_pnl, 2), round(total_invested, 2)


def get_year_activity(transactions: List[models.Transaction]) -> List[dict]:
    by_year: Dict[int, dict] = {}
    for txn in transactions:
        y = txn.dt.year
        if y not in by_year:
            by_year[y] = {"year": y, "notional": 0.0, "buys": 0, "sells": 0}
        by_year[y]["notional"] += txn.notional
        if txn.side == "BUY":
            by_year[y]["buys"] += 1
        else:
            by_year[y]["sells"] += 1
    return sorted(by_year.values(), key=lambda x: x["year"])


# ── Cache management ──────────────────────────────────────────────────────────

def update_cache(
    db: Session,
    positions: dict,
    realized_pnl: float,
    total_invested: float,
    fills: int,
    last_fill: Optional[datetime],
    exchange_map: Dict[str, str],
) -> None:
    """Replace cached FIFO positions and update aggregate metrics in one transaction."""
    db.query(models.CachedPosition).delete()
    for sym, pos in positions.items():
        db.add(models.CachedPosition(
            symbol=sym.upper(),
            listing_exchange=exchange_map.get(sym.upper()),
            quantity=pos["quantity"],
            avg_cost=pos["avg_cost"],
            cost_basis=pos["cost_basis"],
            first_lot_date=pos["first_lot_date"],
        ))

    metrics = db.query(models.CachedMetrics).first()
    if metrics is None:
        metrics = models.CachedMetrics()
        db.add(metrics)
    metrics.fills = fills
    metrics.realized_pnl = round(realized_pnl, 2)
    metrics.total_invested = round(total_invested, 2)
    metrics.active_positions = len(positions)
    metrics.last_fill = last_fill
    metrics.updated_at = datetime.utcnow()
    db.commit()


def get_cached_positions(db: Session) -> List[models.CachedPosition]:
    return db.query(models.CachedPosition).all()


def get_cached_metrics(db: Session) -> Optional[models.CachedMetrics]:
    return db.query(models.CachedMetrics).first()


def sync_positions_from_fifo(db: Session, fifo_positions: dict) -> None:
    """Replace the positions table with FIFO-derived data so all pages reflect transactions."""
    # Preserve any names already stored for these symbols
    existing_names: Dict[str, str] = {
        p.symbol.upper(): p.name
        for p in db.query(models.Position).all()
        if p.name
    }
    db.query(models.Position).delete()
    for sym, pos in fifo_positions.items():
        db.add(models.Position(
            symbol=sym.upper(),
            name=existing_names.get(sym.upper()),
            shares=pos["quantity"],
            avg_cost=pos["avg_cost"],
        ))
    db.commit()


def clear_cache(db: Session) -> None:
    db.query(models.CachedPosition).delete()
    db.query(models.CachedMetrics).delete()
    db.commit()


# ── Historical price bars ─────────────────────────────────────────────────────

def save_historical_price_bars(db: Session, symbol: str, bars: List[dict]) -> int:
    """Bulk-insert daily OHLCV bars using INSERT OR IGNORE to skip duplicates. Returns count inserted."""
    if not bars:
        return 0
    sym_upper = symbol.upper()
    rows = [
        {
            "symbol": sym_upper,
            "date": bar["date"].isoformat() if hasattr(bar["date"], "isoformat") else str(bar["date"]),
            "open": bar.get("open"),
            "high": bar.get("high"),
            "low": bar.get("low"),
            "close": bar["close"],
            "volume": bar.get("volume"),
        }
        for bar in bars
    ]
    db.execute(
        text("""
            INSERT OR IGNORE INTO historical_price_bars
            (symbol, date, open, high, low, close, volume)
            VALUES (:symbol, :date, :open, :high, :low, :close, :volume)
        """),
        rows,
    )
    db.commit()
    return len(rows)


def get_oldest_historical_bar_date(db: Session, symbol: str) -> Optional[date_type]:
    """Return the oldest cached date for a symbol, or None if no data."""
    from sqlalchemy import func
    result = (
        db.query(func.min(models.HistoricalPriceBar.date))
        .filter(models.HistoricalPriceBar.symbol == symbol.upper())
        .scalar()
    )
    if result is None:
        return None
    if isinstance(result, str):
        return datetime.strptime(result, "%Y-%m-%d").date()
    return result


def get_historical_prices_for_symbol(
    db: Session, symbol: str, start_date: date_type, end_date: date_type
) -> List[models.HistoricalPriceBar]:
    return (
        db.query(models.HistoricalPriceBar)
        .filter(
            models.HistoricalPriceBar.symbol == symbol.upper(),
            models.HistoricalPriceBar.date >= start_date,
            models.HistoricalPriceBar.date <= end_date,
        )
        .order_by(models.HistoricalPriceBar.date)
        .all()
    )


def get_existing_portfolio_snapshot_dates(db: Session, since: date_type) -> Set[date_type]:
    """Return the set of calendar dates that already have a portfolio snapshot."""
    since_dt = datetime(since.year, since.month, since.day)
    rows = (
        db.query(models.PortfolioSnapshot.timestamp)
        .filter(models.PortfolioSnapshot.timestamp >= since_dt)
        .all()
    )
    return {row[0].date() for row in rows}


def bulk_save_portfolio_snapshots(
    db: Session, snapshots: List[Tuple[float, float, float, datetime]]
) -> None:
    """Insert a batch of (total_value, total_cost, day_gain, timestamp) portfolio snapshots."""
    for total_value, total_cost, day_gain, ts in snapshots:
        db.add(models.PortfolioSnapshot(
            total_value=total_value,
            total_cost=total_cost,
            day_gain=day_gain,
            timestamp=ts,
        ))
    db.commit()


def update_position_names(db: Session, names: Dict[str, str]) -> None:
    """Update display names for positions that currently have no name."""
    for symbol, name in names.items():
        if not name or name == symbol:
            continue
        db.query(models.Position).filter(
            models.Position.symbol == symbol.upper(),
            models.Position.name.is_(None),
        ).update({"name": name})
    db.commit()
