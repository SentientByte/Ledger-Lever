import logging
from datetime import datetime
from typing import List

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import Base, engine, get_db
from .scheduler import refresh_prices, start_scheduler, stop_scheduler
from .yfinance_service import get_current_prices, get_price_history, validate_symbol

logging.basicConfig(level=logging.INFO)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Ledger Lever", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    start_scheduler()


@app.on_event("shutdown")
def on_shutdown():
    stop_scheduler()


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


# ── Portfolio summary ─────────────────────────────────────────────────────────

@app.get("/api/portfolio/summary", response_model=schemas.PortfolioSummary)
def portfolio_summary(db: Session = Depends(get_db)):
    positions = crud.get_positions(db)
    if not positions:
        return schemas.PortfolioSummary(
            total_value=0,
            total_cost=0,
            total_gain=0,
            total_gain_pct=0,
            day_gain=0,
            day_gain_pct=0,
            positions_count=0,
            last_updated=None,
        )

    symbols = list({p.symbol.upper() for p in positions})
    latest = crud.get_latest_prices(db, symbols)

    total_value = 0.0
    total_cost = 0.0
    day_gain = 0.0
    last_updated = None

    for pos in positions:
        sym = pos.symbol.upper()
        cost = pos.shares * pos.avg_cost
        total_cost += cost

        snap = latest.get(sym)
        if snap and snap.price:
            mv = pos.shares * snap.price
            total_value += mv
            if snap.prev_close:
                day_gain += pos.shares * (snap.price - snap.prev_close)
            if last_updated is None or snap.timestamp > last_updated:
                last_updated = snap.timestamp

    total_gain = total_value - total_cost
    total_gain_pct = (total_gain / total_cost * 100) if total_cost else 0
    prev_total = total_value - day_gain
    day_gain_pct = (day_gain / prev_total * 100) if prev_total else 0

    return schemas.PortfolioSummary(
        total_value=round(total_value, 2),
        total_cost=round(total_cost, 2),
        total_gain=round(total_gain, 2),
        total_gain_pct=round(total_gain_pct, 2),
        day_gain=round(day_gain, 2),
        day_gain_pct=round(day_gain_pct, 2),
        positions_count=len(positions),
        last_updated=last_updated,
    )


# ── Positions ─────────────────────────────────────────────────────────────────

def _enrich_positions(db: Session) -> List[schemas.PositionResponse]:
    positions = crud.get_positions(db)
    if not positions:
        return []

    symbols = list({p.symbol.upper() for p in positions})
    latest = crud.get_latest_prices(db, symbols)

    result = []
    for pos in positions:
        sym = pos.symbol.upper()
        snap = latest.get(sym)

        price = snap.price if snap else None
        prev_close = snap.prev_close if snap else None
        mv = pos.shares * price if price is not None else None
        cost = pos.shares * pos.avg_cost

        total_gain = (mv - cost) if mv is not None else None
        total_gain_pct = (total_gain / cost * 100) if total_gain is not None and cost else None

        day_gain = None
        day_gain_pct = None
        if price is not None and prev_close:
            day_gain = pos.shares * (price - prev_close)
            day_gain_pct = (price - prev_close) / prev_close * 100

        result.append(
            schemas.PositionResponse(
                id=pos.id,
                symbol=pos.symbol,
                name=pos.name,
                shares=pos.shares,
                avg_cost=pos.avg_cost,
                current_price=round(price, 4) if price is not None else None,
                prev_close=round(prev_close, 4) if prev_close is not None else None,
                market_value=round(mv, 2) if mv is not None else None,
                cost_basis=round(cost, 2),
                total_gain=round(total_gain, 2) if total_gain is not None else None,
                total_gain_pct=round(total_gain_pct, 2) if total_gain_pct is not None else None,
                day_gain=round(day_gain, 2) if day_gain is not None else None,
                day_gain_pct=round(day_gain_pct, 2) if day_gain_pct is not None else None,
                day_high=round(snap.day_high, 4) if snap and snap.day_high else None,
                day_low=round(snap.day_low, 4) if snap and snap.day_low else None,
                volume=snap.volume if snap else None,
                created_at=pos.created_at,
            )
        )
    return result


@app.get("/api/positions", response_model=List[schemas.PositionResponse])
def list_positions(db: Session = Depends(get_db)):
    return _enrich_positions(db)


@app.post("/api/positions", response_model=schemas.PositionResponse, status_code=201)
def add_position(body: schemas.PositionCreate, db: Session = Depends(get_db)):
    info = validate_symbol(body.symbol)
    if info is None:
        raise HTTPException(status_code=400, detail=f"Unknown symbol: {body.symbol}")

    pos = crud.create_position(db, body, name=info.get("name"))

    # Immediately store a price snapshot so the response has live data
    prices = get_current_prices([body.symbol.upper()])
    for sym, data in prices.items():
        if data.get("price") is not None:
            crud.save_price_snapshot(db, sym, data)

    for enriched in _enrich_positions(db):
        if enriched.id == pos.id:
            return enriched

    raise HTTPException(status_code=500, detail="Enrichment failed")


@app.put("/api/positions/{position_id}", response_model=schemas.PositionResponse)
def edit_position(
    position_id: int, body: schemas.PositionUpdate, db: Session = Depends(get_db)
):
    obj = crud.update_position(db, position_id, body)
    if obj is None:
        raise HTTPException(status_code=404, detail="Position not found")

    for enriched in _enrich_positions(db):
        if enriched.id == position_id:
            return enriched

    raise HTTPException(status_code=404, detail="Position not found")


@app.delete("/api/positions/{position_id}")
def remove_position(position_id: int, db: Session = Depends(get_db)):
    if not crud.delete_position(db, position_id):
        raise HTTPException(status_code=404, detail="Position not found")
    return {"message": "deleted"}


# ── Price history & performance ───────────────────────────────────────────────

@app.get("/api/prices/{symbol}/history")
def symbol_history(symbol: str, period: str = "3mo"):
    return get_price_history(symbol, period)


@app.get("/api/portfolio/performance")
def portfolio_performance(days: int = 30, db: Session = Depends(get_db)):
    snaps = crud.get_portfolio_performance(db, days)
    return [
        {
            "timestamp": s.timestamp.isoformat(),
            "total_value": round(s.total_value, 2),
            "total_cost": round(s.total_cost, 2),
        }
        for s in snaps
    ]


# ── Manual refresh ────────────────────────────────────────────────────────────

@app.post("/api/portfolio/refresh")
def manual_refresh():
    refresh_prices()
    return {"message": "prices refreshed"}


# ── Symbol validation ─────────────────────────────────────────────────────────

@app.get("/api/validate/{symbol}")
def validate_ticker(symbol: str):
    info = validate_symbol(symbol)
    if info is None:
        raise HTTPException(status_code=404, detail=f"Symbol not found: {symbol}")
    return info
