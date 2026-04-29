import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from . import crud
from .database import SessionLocal
from .yfinance_service import get_current_prices

logger = logging.getLogger(__name__)
_scheduler = BackgroundScheduler(timezone="UTC")


def refresh_prices() -> None:
    db = SessionLocal()
    try:
        positions = crud.get_positions(db)
        if not positions:
            return

        symbols = list({p.symbol.upper() for p in positions})
        logger.info("Refreshing prices for: %s", symbols)

        prices = get_current_prices(symbols)

        for symbol, data in prices.items():
            if data.get("price") is not None:
                crud.save_price_snapshot(db, symbol, data)

        # Recalculate portfolio snapshot
        latest = crud.get_latest_prices(db, symbols)
        total_value = 0.0
        total_cost = 0.0
        day_gain = 0.0

        for pos in positions:
            sym = pos.symbol.upper()
            snap = latest.get(sym)
            cost = pos.shares * pos.avg_cost
            total_cost += cost
            if snap and snap.price:
                mv = pos.shares * snap.price
                total_value += mv
                if snap.prev_close:
                    day_gain += pos.shares * (snap.price - snap.prev_close)

        if total_value > 0:
            crud.save_portfolio_snapshot(db, total_value, total_cost, day_gain)

        logger.info("Refresh done — portfolio value: $%.2f", total_value)
    except Exception as exc:
        logger.error("refresh_prices error: %s", exc)
    finally:
        db.close()


def start_scheduler() -> None:
    _scheduler.add_job(
        refresh_prices,
        trigger=IntervalTrigger(seconds=60),
        id="refresh_prices",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info("Scheduler started (60 s interval)")
    refresh_prices()


def stop_scheduler() -> None:
    _scheduler.shutdown(wait=False)
