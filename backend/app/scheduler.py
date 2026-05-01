import logging
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from . import crud
from .database import SessionLocal
from .yfinance_service import get_current_prices, get_ticker_names

logger = logging.getLogger(__name__)
_scheduler = BackgroundScheduler(timezone="UTC")

_PRICE_BATCH_SIZE = 8   # symbols per yfinance batch
_BATCH_DELAY_S = 1.0    # seconds between batches to avoid rate-limiting


def refresh_prices() -> None:
    db = SessionLocal()
    try:
        positions = crud.get_positions(db)
        cached_pos = crud.get_cached_positions(db)

        pos_symbols = {p.symbol.upper() for p in positions}
        cached_symbols = {cp.symbol.upper() for cp in cached_pos}

        # Build exchange map from cached positions (already derived from transactions)
        exchange_map: dict = {
            cp.symbol.upper(): cp.listing_exchange
            for cp in cached_pos
            if cp.listing_exchange
        }

        all_symbols = list(pos_symbols | cached_symbols)
        if not all_symbols:
            return

        logger.info("Refreshing prices for %d symbol(s): %s", len(all_symbols), all_symbols)

        # Fetch in small batches to stay within Yahoo Finance rate limits
        all_prices: dict = {}
        for i in range(0, len(all_symbols), _PRICE_BATCH_SIZE):
            batch = all_symbols[i: i + _PRICE_BATCH_SIZE]
            batch_exch = {s: exchange_map[s] for s in batch if s in exchange_map}
            prices = get_current_prices(batch, batch_exch)
            all_prices.update(prices)
            if i + _PRICE_BATCH_SIZE < len(all_symbols):
                time.sleep(_BATCH_DELAY_S)

        # Persist price snapshots
        names_to_update: dict = {}
        for symbol, data in all_prices.items():
            if data.get("price") is not None:
                crud.save_price_snapshot(db, symbol, data)
            name = data.get("name")
            if name and name != symbol:
                names_to_update[symbol] = name

        # Back-fill display names for positions that don't have one yet.
        # First try names already embedded in the fast_info response.
        if names_to_update:
            crud.update_position_names(db, names_to_update)

        # For any remaining nameless positions, fetch via ticker.info (slow but once per symbol).
        nameless = [
            p.symbol for p in positions if not p.name and p.symbol not in names_to_update
        ]
        if nameless:
            slow_names = get_ticker_names(nameless, exchange_map)
            if slow_names:
                crud.update_position_names(db, slow_names)

        # Compute portfolio snapshot from positions table (kept in sync with FIFO)
        latest = crud.get_latest_prices(db, all_symbols)
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
