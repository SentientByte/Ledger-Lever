import csv
import io
import logging
import threading
from datetime import datetime
from typing import List, Optional

import os

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import Base, engine, get_db, SessionLocal
from .scheduler import refresh_prices, start_scheduler, stop_scheduler, backfill_historical_data
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

# Supported date formats for CSV import (order matters — try most specific first)
_DATE_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",   # e.g. "3/12/2025 9:30" — IBKR activity export
    "%m/%d/%Y",
]

_log_level = logging.DEBUG if os.getenv("DEBUG") else logging.INFO
_log_format = "%(asctime)s %(levelname)s %(name)s: %(message)s"

import sys as _sys
if getattr(_sys, "frozen", False):
    _log_dir = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "LedgerLever")
else:
    _log_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.makedirs(_log_dir, exist_ok=True)
_log_file = os.path.join(_log_dir, "app.log")

logging.basicConfig(
    level=_log_level,
    format=_log_format,
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_log_file, encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)
Base.metadata.create_all(bind=engine)

# Migrate: add listing_exchange column to any tables that predate it
from sqlalchemy import inspect as sa_inspect, text as sa_text
with engine.connect() as _conn:
    _insp = sa_inspect(engine)
    for _table in ("transactions", "cached_positions"):
        try:
            _cols = [c["name"] for c in _insp.get_columns(_table)]
        except Exception:
            continue
        if "listing_exchange" not in _cols:
            _conn.execute(sa_text(f"ALTER TABLE {_table} ADD COLUMN listing_exchange VARCHAR"))
    _conn.commit()

app = FastAPI(title="Ledger Lever", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.getenv("DEBUG"):
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request as StarletteRequest
    import time

    class RequestLoggingMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: StarletteRequest, call_next):
            start = time.time()
            response = await call_next(request)
            elapsed = (time.time() - start) * 1000
            logger.debug(
                "%s %s → %d (%.0fms)",
                request.method, request.url.path, response.status_code, elapsed,
            )
            return response

    app.add_middleware(RequestLoggingMiddleware)


@app.on_event("startup")
def on_startup():
    start_scheduler()


@app.on_event("shutdown")
def on_shutdown():
    stop_scheduler()


# ── Serve bundled React frontend (Windows .exe mode) ─────────────────────────

_static_dir = os.getenv("LEDGER_STATIC_DIR", "")
if _static_dir and os.path.isdir(_static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(_static_dir, "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str = ""):
        # Let /api/* routes fall through to their own handlers.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        index = os.path.join(_static_dir, "index.html")
        return FileResponse(index)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/debug")
def debug_info():
    """Returns runtime debug info. Only available when DEBUG env var is set."""
    if not os.getenv("DEBUG"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    import sys, platform
    db_url = os.getenv("DATABASE_URL", os.getenv("LEDGER_DB_PATH", "default"))
    return {
        "debug": True,
        "python": sys.version,
        "platform": platform.platform(),
        "database_url": db_url,
        "env": {k: v for k, v in os.environ.items() if not any(s in k.lower() for s in ("key", "secret", "pass", "token"))},
        "log_level": logging.getLevelName(_log_level),
        "timestamp": datetime.utcnow().isoformat(),
    }


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
    # Aggregate to one data point per calendar day (last snapshot of each day).
    # This ensures clean daily returns whether data comes from the live 60-s
    # scheduler or the historical backfill.
    by_date: dict = {}
    for s in snaps:
        day = s.timestamp.date()
        if day not in by_date or s.timestamp > by_date[day].timestamp:
            by_date[day] = s
    return [
        {
            "timestamp": s.timestamp.isoformat(),
            "total_value": round(s.total_value, 2),
            "total_cost": round(s.total_cost, 2),
        }
        for s in sorted(by_date.values(), key=lambda x: x.timestamp)
    ]


# ── Manual refresh & backfill ─────────────────────────────────────────────────

@app.post("/api/portfolio/refresh")
def manual_refresh():
    refresh_prices()
    return {"message": "prices refreshed"}


@app.post("/api/portfolio/backfill")
def trigger_backfill():
    """Manually trigger a historical data backfill in the background."""
    threading.Thread(target=backfill_historical_data, daemon=True, name="hist-backfill-manual").start()
    return {"message": "historical backfill started in background"}


@app.get("/api/prices/bars")
def get_price_bars(symbols: str = Query(...), period: str = "2y", db: Session = Depends(get_db)):
    """Return daily close prices for multiple comma-separated symbols.

    Served from the cached HistoricalPriceBar table; missing data is fetched
    from yfinance on-demand and then cached for subsequent requests.
    """
    from datetime import timedelta
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not sym_list:
        return {}

    now = datetime.utcnow().date()
    if period.endswith("y"):
        start_date = (datetime.utcnow() - timedelta(days=int(period[:-1]) * 365)).date()
    elif period.endswith("mo"):
        start_date = (datetime.utcnow() - timedelta(days=int(period[:-2]) * 30)).date()
    else:
        start_date = (datetime.utcnow() - timedelta(days=730)).date()

    result = {}
    for sym in sym_list:
        bars = crud.get_historical_prices_for_symbol(db, sym, start_date, now)
        if not bars:
            from .yfinance_service import get_historical_daily_prices
            raw = get_historical_daily_prices(sym, start_date)
            if raw:
                crud.save_historical_price_bars(db, sym, raw)
                bars = crud.get_historical_prices_for_symbol(db, sym, start_date, now)
        result[sym] = [{"date": bar.date.isoformat(), "close": float(bar.close)} for bar in bars]

    return result


# ── Symbol validation ─────────────────────────────────────────────────────────

@app.get("/api/validate/{symbol}")
def validate_ticker(symbol: str):
    info = validate_symbol(symbol)
    if info is None:
        raise HTTPException(status_code=404, detail=f"Symbol not found: {symbol}")
    return info


# ── Transactions ──────────────────────────────────────────────────────────────

def _parse_dt(raw: str) -> Optional[datetime]:
    """Try each supported date format; return None if none match."""
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _sync_cache_and_positions(db: Session) -> None:
    """Recompute FIFO from all transactions, persist cache + positions table."""
    txns = crud.get_all_transactions_sorted(db)
    if not txns:
        return
    positions_fifo, realized_pnl, total_invested = crud.compute_fifo(txns)
    exchange_map = crud.get_symbol_exchange_map(txns)
    last_fill = max(t.dt for t in txns)
    crud.update_cache(
        db, positions_fifo, realized_pnl, total_invested,
        len(txns), last_fill, exchange_map,
    )
    if positions_fifo:
        crud.sync_positions_from_fifo(db, positions_fifo)


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
    crud.clear_cache(db)
    added = _load_sample_transactions(db)
    _sync_cache_and_positions(db)
    threading.Thread(target=refresh_prices, daemon=True).start()
    threading.Thread(target=backfill_historical_data, daemon=True, name="hist-backfill-reset").start()
    return schemas.TransactionUploadResult(
        added=added, duplicates=0, errors=0, total_rows=len(_SAMPLE_TRANSACTIONS)
    )


@app.post("/api/transactions/upload", response_model=schemas.TransactionUploadResult)
async def upload_transactions(file: UploadFile = File(...), db: Session = Depends(get_db)):
    logger.info("CSV upload started: filename=%r content_type=%r size=%s",
                file.filename, file.content_type, file.size)

    try:
        contents = await file.read()
    except Exception as exc:
        logger.error("CSV upload: failed to read file bytes: %s", exc, exc_info=True)
        raise HTTPException(status_code=400, detail="Could not read uploaded file.")

    logger.info("CSV upload: read %d bytes", len(contents))

    try:
        text = contents.decode("utf-8-sig")  # handle BOM
    except Exception as exc:
        logger.error("CSV upload: decode error (tried utf-8-sig): %s", exc, exc_info=True)
        raise HTTPException(status_code=400, detail="File is not valid UTF-8 text.")

    reader = csv.DictReader(io.StringIO(text))

    raw_fieldnames = reader.fieldnames or []
    logger.info("CSV upload: raw headers = %s", raw_fieldnames)

    # Normalise header names: lower-case, strip whitespace, unify separators
    reader.fieldnames = [
        f.strip().lower().replace("/", "_").replace(" ", "_")
        for f in raw_fieldnames
    ]
    logger.info("CSV upload: normalised headers = %s", reader.fieldnames)

    added = duplicates = errors = total = 0
    for row in reader:
        total += 1
        try:
            sym = row.get("symbol", "").strip().upper()
            dt_raw = row.get("date_time", row.get("date", "")).strip()
            qty_raw = row.get("quantity", "0")
            price_raw = row.get("price", "0")
            commission_raw = row.get("commission", "0")

            try:
                qty = float(qty_raw)
            except (ValueError, TypeError) as exc:
                logger.warning("CSV row %d: cannot parse quantity %r — %s | full row: %s",
                               total, qty_raw, exc, dict(row))
                errors += 1
                continue

            try:
                price = float(price_raw)
            except (ValueError, TypeError) as exc:
                logger.warning("CSV row %d: cannot parse price %r — %s | full row: %s",
                               total, price_raw, exc, dict(row))
                errors += 1
                continue

            try:
                commission = float(commission_raw)
            except (ValueError, TypeError):
                commission = 0.0

            # Support IBKR column name variants: ListingExch / ListingExchange / Listing Exchange
            listing_exchange = (
                row.get("listing_exchange")
                or row.get("listingexchange")
                or row.get("listingexch")
                or ""
            ).strip() or None

            if not sym:
                logger.warning("CSV row %d: missing symbol | full row: %s", total, dict(row))
                errors += 1
                continue
            if not dt_raw:
                logger.warning("CSV row %d: missing date/date_time | full row: %s", total, dict(row))
                errors += 1
                continue
            if qty == 0:
                logger.warning("CSV row %d: quantity is 0 (skipping) | sym=%s dt=%s", total, sym, dt_raw)
                errors += 1
                continue
            if price <= 0:
                logger.warning("CSV row %d: price <= 0 (%s) | sym=%s dt=%s", total, price, sym, dt_raw)
                errors += 1
                continue

            dt = _parse_dt(dt_raw)
            if dt is None:
                logger.warning("CSV row %d: unrecognised date format %r | sym=%s | supported formats: %s",
                               total, dt_raw, sym, _DATE_FORMATS)
                errors += 1
                continue

            _, dup = crud.create_transaction(db, sym, dt, qty, price, commission, listing_exchange)
            if dup:
                duplicates += 1
                logger.debug("CSV row %d: duplicate skipped sym=%s dt=%s qty=%s price=%s",
                             total, sym, dt, qty, price)
            else:
                added += 1
                logger.debug("CSV row %d: added sym=%s dt=%s qty=%s price=%s",
                             total, sym, dt, qty, price)

        except Exception as exc:
            logger.error("CSV row %d: unexpected error — %s | full row: %s",
                         total, exc, dict(row), exc_info=True)
            errors += 1

    logger.info("CSV upload complete: total=%d added=%d duplicates=%d errors=%d",
                total, added, duplicates, errors)

    # Synchronously update FIFO cache + positions so the next API calls use fresh data
    if added > 0:
        _sync_cache_and_positions(db)

    # Kick off background price refresh + historical backfill for any new symbols
    threading.Thread(target=refresh_prices, daemon=True).start()
    if added > 0:
        threading.Thread(target=backfill_historical_data, daemon=True, name="hist-backfill-upload").start()

    return schemas.TransactionUploadResult(
        added=added, duplicates=duplicates, errors=errors, total_rows=total
    )


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
    cached = crud.get_cached_positions(db)

    # On first load (cache empty), compute and persist synchronously
    if not cached:
        txns = crud.get_all_transactions_sorted(db)
        if not txns:
            return []
        _sync_cache_and_positions(db)
        cached = crud.get_cached_positions(db)
        if not cached:
            return []

    symbols = [cp.symbol for cp in cached]
    # Read prices from DB only — no live yfinance call (scheduler keeps them fresh)
    latest = crud.get_latest_prices(db, symbols)

    total_mv = sum(
        cp.quantity * latest[cp.symbol].price
        for cp in cached
        if cp.symbol in latest and latest[cp.symbol].price
    )

    result = []
    for cp in cached:
        snap = latest.get(cp.symbol)
        price = snap.price if snap else None
        mv = cp.quantity * price if price is not None else None
        unreal = (mv - cp.cost_basis) if mv is not None else None
        unreal_pct = (
            (unreal / cp.cost_basis * 100) if unreal is not None and cp.cost_basis else None
        )
        wt = (mv / total_mv * 100) if mv and total_mv else None
        result.append(schemas.DerivedPosition(
            symbol=cp.symbol,
            quantity=cp.quantity,
            avg_cost=cp.avg_cost,
            cost_basis=cp.cost_basis,
            current_price=round(price, 4) if price is not None else None,
            market_value=round(mv, 2) if mv is not None else None,
            unrealized=round(unreal, 2) if unreal is not None else None,
            unrealized_pct=round(unreal_pct, 2) if unreal_pct is not None else None,
            weight_pct=round(wt, 1) if wt is not None else None,
            first_lot_date=cp.first_lot_date,
        ))

    result.sort(key=lambda x: (x.cost_basis or 0), reverse=True)
    return result


@app.get("/api/transactions/summary", response_model=schemas.TransactionSummary)
def transaction_summary(db: Session = Depends(get_db)):
    metrics = crud.get_cached_metrics(db)

    # Bootstrap cache on first load
    if metrics is None or metrics.fills == 0:
        txns = crud.get_all_transactions_sorted(db)
        if not txns:
            return schemas.TransactionSummary(
                fills=0, invested=0, realized=0, unrealized=None,
                active_positions=0, last_fill=None, filename=None,
            )
        _sync_cache_and_positions(db)
        metrics = crud.get_cached_metrics(db)

    if metrics is None:
        return schemas.TransactionSummary(
            fills=0, invested=0, realized=0, unrealized=None,
            active_positions=0, last_fill=None, filename=None,
        )

    # Compute unrealized from cached positions + latest DB prices (no live yfinance)
    cached_positions = crud.get_cached_positions(db)
    symbols = [cp.symbol for cp in cached_positions]
    latest = crud.get_latest_prices(db, symbols)

    unrealized: Optional[float] = None
    if cached_positions:
        unrealized = 0.0
        for cp in cached_positions:
            snap = latest.get(cp.symbol)
            if snap and snap.price:
                unrealized += cp.quantity * snap.price - cp.cost_basis

    return schemas.TransactionSummary(
        fills=metrics.fills,
        invested=round(metrics.total_invested, 2),
        realized=round(metrics.realized_pnl, 2),
        unrealized=round(unrealized, 2) if unrealized is not None else None,
        active_positions=metrics.active_positions,
        last_fill=metrics.last_fill,
        filename=None,
    )


@app.get("/api/transactions/activity")
def year_activity(db: Session = Depends(get_db)):
    txns = crud.get_all_transactions_sorted(db)
    return crud.get_year_activity(txns)


@app.delete("/api/transactions")
def clear_transactions(db: Session = Depends(get_db)):
    crud.delete_all_transactions(db)
    crud.clear_cache(db)
    # Remove FIFO-synced positions so the portfolio goes back to zero
    db.query(models.Position).delete()
    db.commit()
    return {"message": "cleared"}
