from collections import deque
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy import desc, asc
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
    for symbol in symbols:
        snap = (
            db.query(models.PriceSnapshot)
            .filter(models.PriceSnapshot.symbol == symbol.upper())
            .order_by(desc(models.PriceSnapshot.timestamp))
            .first()
        )
        if snap:
            result[symbol.upper()] = snap
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

def _make_transaction(symbol: str, dt: datetime, quantity: float, price: float, commission: float) -> models.Transaction:
    side = "BUY" if quantity > 0 else "SELL"
    notional = round(abs(quantity) * price, 2)
    if side == "BUY":
        net = round(-(notional + commission), 2)
    else:
        net = round(notional - commission, 2)
    return models.Transaction(
        symbol=symbol.upper(),
        dt=dt,
        quantity=quantity,
        price=price,
        commission=commission,
        side=side,
        notional=notional,
        net=net,
    )


def create_transaction(
    db: Session, symbol: str, dt: datetime, quantity: float, price: float, commission: float
) -> Tuple[Optional[models.Transaction], bool]:
    """Returns (transaction, was_duplicate)."""
    obj = _make_transaction(symbol, dt, quantity, price, commission)
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


def delete_all_transactions(db: Session) -> None:
    db.query(models.Transaction).delete()
    db.commit()


def compute_fifo(transactions: List[models.Transaction]):
    """
    Returns:
      positions: dict symbol -> {quantity, avg_cost, cost_basis, first_lot_date, lots}
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
