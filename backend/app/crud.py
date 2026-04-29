from datetime import datetime, timedelta
from typing import Dict, List, Optional

from sqlalchemy import desc
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
