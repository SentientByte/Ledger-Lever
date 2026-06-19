import logging
import time
from collections import deque
from datetime import datetime, timedelta, time as dt_time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from . import crud
from .database import SessionLocal
from .yfinance_service import get_current_prices, get_ticker_names, get_historical_daily_prices

logger = logging.getLogger(__name__)
_scheduler = BackgroundScheduler(timezone="UTC")

_PRICE_BATCH_SIZE = 8   # symbols per yfinance batch
_BATCH_DELAY_S = 2.0    # seconds between batches to avoid rate-limiting
_TICKER_DELAY_S = 1.5   # seconds between individual ticker requests within a batch


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

        # ticker.info / quoteSummary endpoint is the most aggressively rate-limited Yahoo
        # endpoint, so we skip the slow name-fetch entirely during the price refresh loop.
        # Names will surface naturally once fast_info starts returning data.

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


def backfill_historical_data() -> None:
    """
    Fetch 2 years of daily OHLCV for every held symbol, cache in historical_price_bars,
    then reconstruct daily portfolio values and fill gaps in portfolio_snapshots.
    Runs in a background thread — safe to call concurrently with the live refresh loop.
    """
    db = SessionLocal()
    try:
        txns = crud.get_all_transactions_sorted(db)
        positions = crud.get_positions(db)

        all_symbols: set = set()
        for t in txns:
            all_symbols.add(t.symbol.upper())
        for p in positions:
            all_symbols.add(p.symbol.upper())

        if not all_symbols:
            logger.info("Historical backfill skipped: no symbols found")
            return

        start_date = (datetime.utcnow() - timedelta(days=730)).date()
        today = datetime.utcnow().date()
        exchange_map = crud.get_symbol_exchange_map(txns) if txns else {}

        # ── Step 1: fetch missing historical price bars per symbol ────────────
        for symbol in sorted(all_symbols):
            oldest = crud.get_oldest_historical_bar_date(db, symbol)
            # Re-fetch if we have no data or data doesn't go back far enough
            if oldest is None or oldest > start_date + timedelta(days=7):
                logger.info("Backfill: fetching 2-yr history for %s (oldest=%s)", symbol, oldest)
                bars = get_historical_daily_prices(symbol, start_date, exchange_map.get(symbol))
                if bars:
                    count = crud.save_historical_price_bars(db, symbol, bars)
                    logger.info("Backfill: stored %d bars for %s", count, symbol)
                else:
                    logger.warning("Backfill: no historical bars returned for %s", symbol)
                time.sleep(2.0)  # avoid Yahoo Finance rate limits between symbols

        # ── Step 2: pre-load all cached prices into memory ────────────────────
        all_hist: dict = {}  # {symbol: {date: close_price}}
        for symbol in all_symbols:
            rows = crud.get_historical_prices_for_symbol(db, symbol, start_date, today)
            all_hist[symbol] = {row.date: row.close for row in rows}

        # Union of all trading dates across all symbols
        trading_dates = sorted({d for sym_prices in all_hist.values() for d in sym_prices})
        if not trading_dates:
            logger.info("Backfill: no trading dates found — skipping portfolio snapshot generation")
            return

        # ── Step 3: determine which calendar days already have snapshots ──────
        existing_dates = crud.get_existing_portfolio_snapshot_dates(db, start_date)

        # ── Step 4: reconstruct daily portfolio value timeline ────────────────
        snapshots: list = []

        if txns:
            # Efficient single-pass: replay transactions in order, accumulate lots
            lots: dict = {}   # {symbol: deque of [qty, cost_price]}
            txn_idx = 0

            for trade_date in trading_dates:
                # Advance transactions up to (and including) this trade date
                while txn_idx < len(txns) and txns[txn_idx].dt.date() <= trade_date:
                    t = txns[txn_idx]
                    sym = t.symbol.upper()
                    if t.quantity > 0:  # BUY
                        if sym not in lots:
                            lots[sym] = deque()
                        lots[sym].append([float(t.quantity), float(t.price)])
                    else:  # SELL — FIFO consume
                        remaining = abs(float(t.quantity))
                        if sym in lots:
                            while remaining > 1e-9 and lots[sym]:
                                lot = lots[sym][0]
                                if lot[0] <= remaining + 1e-9:
                                    remaining -= lot[0]
                                    lots[sym].popleft()
                                else:
                                    lot[0] -= remaining
                                    remaining = 0.0
                    txn_idx += 1

                if trade_date in existing_dates:
                    continue  # already have a snapshot for this day

                total_value = 0.0
                total_cost = 0.0
                has_price = False

                for sym, lot_deque in lots.items():
                    if not lot_deque:
                        continue
                    qty = sum(l[0] for l in lot_deque)
                    cost = sum(l[0] * l[1] for l in lot_deque)
                    total_cost += cost
                    price = all_hist.get(sym, {}).get(trade_date)
                    if price is not None:
                        total_value += qty * price
                        has_price = True

                if has_price and total_value > 0:
                    ts = datetime.combine(trade_date, dt_time(16, 0, 0))
                    snapshots.append((round(total_value, 2), round(total_cost, 2), 0.0, ts))

        else:
            # No transactions: use current positions × historical prices
            for trade_date in trading_dates:
                if trade_date in existing_dates:
                    continue
                total_value = 0.0
                total_cost = 0.0
                has_price = False
                for p in positions:
                    sym = p.symbol.upper()
                    price = all_hist.get(sym, {}).get(trade_date)
                    if price is not None:
                        total_value += p.shares * price
                        has_price = True
                    total_cost += p.shares * p.avg_cost
                if has_price and total_value > 0:
                    ts = datetime.combine(trade_date, dt_time(16, 0, 0))
                    snapshots.append((round(total_value, 2), round(total_cost, 2), 0.0, ts))

        if snapshots:
            crud.bulk_save_portfolio_snapshots(db, snapshots)
            logger.info("Backfill complete: inserted %d portfolio snapshots", len(snapshots))
        else:
            logger.info("Backfill: no new portfolio snapshots needed")

    except Exception as exc:
        logger.error("backfill_historical_data error: %s", exc, exc_info=True)
    finally:
        db.close()


def start_scheduler() -> None:
    import threading
    _scheduler.add_job(
        refresh_prices,
        trigger=IntervalTrigger(seconds=300),
        id="refresh_prices",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.start()
    logger.info("Scheduler started (300 s interval)")
    refresh_prices()
    # Kick off a 2-year historical backfill in the background so it doesn't
    # block startup. Subsequent calls are safe — already-cached dates are skipped.
    threading.Thread(target=backfill_historical_data, daemon=True, name="hist-backfill").start()


def stop_scheduler() -> None:
    _scheduler.shutdown(wait=False)
