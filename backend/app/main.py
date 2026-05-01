import csv
import io
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import Base, engine, get_db
from .scheduler import refresh_prices, start_scheduler, stop_scheduler
from .yfinance_service import get_current_prices, get_price_history, validate_symbol

# 27-fill sample dataset (Symbol, Date/Time, Quantity, Price, Commission)
_SAMPLE_TRANSACTIONS = [
    ("VTI",  "2017-03-14 09:30:00",  200,  125.00, 1.00),
    ("VTI",  "2018-06-20 10:15:00",  150,  144.20, 1.00),
    ("VTI",  "2019-11-08 11:00:00",  140,  203.00, 1.00),
    ("BND",  "2019-05-30 10:00:00",  600,   78.60, 1.00),
    ("BND",  "2022-09-12 09:15:00",  620,   71.25, 1.00),
    ("BND",  "2026-02-19 14:18:32",  420,   74.10, 1.00),
    ("IXUS", "2020-09-11 11:00:00",  800,   59.28, 1.00),
    ("IXUS", "2023-06-05 09:30:00",  220,   63.90, 1.00),
    ("IXUS", "2025-04-30 11:00:01",  250,   67.20, 1.00),
    ("IEF",  "2021-02-04 10:30:00",  200,  124.00, 1.00),
    ("IEF",  "2022-04-20 11:15:00",  220,  109.11, 1.00),
    ("IEF",  "2025-03-12 10:14:22",  340,   84.10, 1.00),
    ("USMV", "2021-07-29 09:45:00",  250,   76.00, 1.00),
    ("USMV", "2022-12-08 10:00:00",  180,   72.40, 1.00),
    ("USMV", "2025-08-25 10:08:14",  120,   86.10, 1.00),
    ("USMV", "2026-03-04 11:42:17",   40,   90.40, 1.00),
    ("SCHP", "2022-06-09 09:30:00",  510,   54.80, 1.00),
    ("SCHP", "2025-06-18 09:45:30",  360,   48.40, 1.00),
    ("IEMG", "2022-01-18 10:00:00",  400,   62.40, 1.00),
    ("IEMG", "2023-08-14 09:45:00",  340,   56.34, 1.00),
    ("IEMG", "2025-10-02 13:31:09", -200,   55.40, 1.00),
    ("IAU",  "2022-10-04 10:00:00",  300,   33.10, 1.00),
    ("IAU",  "2024-09-23 11:28:00",  180,   46.20, 1.00),
    ("SGOV", "2025-11-14 09:51:48",  165,  100.20, 0.00),
    ("VTI",  "2025-01-06 09:35:50",   90,  278.40, 1.00),
    ("VTI",  "2026-01-05 10:00:00",   60,  310.20, 1.00),
    ("VTI",  "2026-04-12 09:33:08",   32,  316.10, 1.00),
]

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


# ── Transactions ──────────────────────────────────────────────────────────────

def _load_sample_transactions(db: Session) -> int:
    added = 0
    for row in _SAMPLE_TRANSACTIONS:
        sym, dt_str, qty, price, commission = row
        dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        _, dup = crud.create_transaction(db, sym, dt, float(qty), float(price), float(commission))
        if not dup:
            added += 1
    return added


@app.post("/api/transactions/reset", response_model=schemas.TransactionUploadResult)
def reset_transactions(db: Session = Depends(get_db)):
    crud.delete_all_transactions(db)
    added = _load_sample_transactions(db)
    return schemas.TransactionUploadResult(added=added, duplicates=0, errors=0, total_rows=len(_SAMPLE_TRANSACTIONS))


@app.post("/api/transactions/upload", response_model=schemas.TransactionUploadResult)
async def upload_transactions(file: UploadFile = File(...), db: Session = Depends(get_db)):
    contents = await file.read()
    text = contents.decode("utf-8-sig")  # handle BOM
    reader = csv.DictReader(io.StringIO(text))

    # Normalise header names to lower-case, strip whitespace
    reader.fieldnames = [f.strip().lower().replace("/", "_").replace(" ", "_") for f in (reader.fieldnames or [])]

    added = duplicates = errors = total = 0
    for row in reader:
        total += 1
        try:
            sym = row.get("symbol", "").strip().upper()
            dt_raw = row.get("date_time", row.get("date", "")).strip()
            qty = float(row.get("quantity", 0))
            price = float(row.get("price", 0))
            commission = float(row.get("commission", 0))

            if not sym or not dt_raw or qty == 0 or price <= 0:
                errors += 1
                continue

            # Try multiple date formats
            dt = None
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y"):
                try:
                    dt = datetime.strptime(dt_raw, fmt)
                    break
                except ValueError:
                    continue
            if dt is None:
                errors += 1
                continue

            _, dup = crud.create_transaction(db, sym, dt, qty, price, commission)
            if dup:
                duplicates += 1
            else:
                added += 1
        except Exception:
            errors += 1

    return schemas.TransactionUploadResult(added=added, duplicates=duplicates, errors=errors, total_rows=total)


@app.get("/api/transactions", response_model=schemas.TransactionPage)
def list_transactions(
    symbol: Optional[str] = Query(None),
    side: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    items, total = crud.get_transactions(db, symbol=symbol, side=side, page=page, page_size=page_size)
    return schemas.TransactionPage(items=items, total=total, page=page, page_size=page_size)


@app.get("/api/transactions/symbols")
def list_transaction_symbols(db: Session = Depends(get_db)):
    rows = db.query(models.Transaction.symbol).distinct().order_by(models.Transaction.symbol).all()
    return [r[0] for r in rows]


@app.get("/api/transactions/positions", response_model=List[schemas.DerivedPosition])
def derived_positions(db: Session = Depends(get_db)):
    txns = crud.get_all_transactions_sorted(db)
    if not txns:
        return []

    positions, _, _ = crud.compute_fifo(txns)
    if not positions:
        return []

    symbols = list(positions.keys())
    latest = crud.get_latest_prices(db, symbols)
    total_mv = sum(
        (positions[s]["quantity"] * latest[s].price)
        for s in symbols
        if s in latest and latest[s].price
    )

    result = []
    for sym, pos in positions.items():
        snap = latest.get(sym)
        price = snap.price if snap else None
        mv = pos["quantity"] * price if price else None
        unreal = (mv - pos["cost_basis"]) if mv is not None else None
        unreal_pct = (unreal / pos["cost_basis"] * 100) if unreal is not None and pos["cost_basis"] else None
        wt = (mv / total_mv * 100) if mv and total_mv else None
        result.append(schemas.DerivedPosition(
            symbol=sym,
            quantity=pos["quantity"],
            avg_cost=pos["avg_cost"],
            cost_basis=pos["cost_basis"],
            current_price=round(price, 4) if price else None,
            market_value=round(mv, 2) if mv else None,
            unrealized=round(unreal, 2) if unreal is not None else None,
            unrealized_pct=round(unreal_pct, 2) if unreal_pct is not None else None,
            weight_pct=round(wt, 1) if wt is not None else None,
            first_lot_date=pos["first_lot_date"],
        ))

    result.sort(key=lambda x: (x.cost_basis or 0), reverse=True)
    return result


@app.get("/api/transactions/summary", response_model=schemas.TransactionSummary)
def transaction_summary(db: Session = Depends(get_db)):
    txns = crud.get_all_transactions_sorted(db)
    if not txns:
        return schemas.TransactionSummary(
            fills=0, invested=0, realized=0, unrealized=None,
            active_positions=0, last_fill=None, filename=None,
        )

    positions, realized, invested = crud.compute_fifo(txns)

    symbols = list(positions.keys())
    latest = crud.get_latest_prices(db, symbols)
    unrealized = 0.0
    for sym, pos in positions.items():
        snap = latest.get(sym)
        if snap and snap.price:
            unrealized += pos["quantity"] * snap.price - pos["cost_basis"]

    last_fill = max(t.dt for t in txns)
    return schemas.TransactionSummary(
        fills=len(txns),
        invested=round(invested, 2),
        realized=round(realized, 2),
        unrealized=round(unrealized, 2),
        active_positions=len(positions),
        last_fill=last_fill,
        filename="IBKR_sample_2017-2026.csv" if len(txns) == len(_SAMPLE_TRANSACTIONS) else None,
    )


@app.get("/api/transactions/activity")
def year_activity(db: Session = Depends(get_db)):
    txns = crud.get_all_transactions_sorted(db)
    return crud.get_year_activity(txns)


@app.delete("/api/transactions")
def clear_transactions(db: Session = Depends(get_db)):
    crud.delete_all_transactions(db)
    return {"message": "cleared"}
