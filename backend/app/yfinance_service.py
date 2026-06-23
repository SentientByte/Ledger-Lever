import logging
import random
import time
from typing import Dict, List, Optional

import yfinance as yf

logger = logging.getLogger(__name__)

# yfinance logs "$TICKER: possibly delisted; no timezone found" at ERROR level
# whenever Yahoo Finance returns an empty body (usually a transient rate-limit,
# not an actual delisting).  Suppress it so it doesn't pollute the log file.
class _SuppressDelistNoise(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "possibly delisted" not in record.getMessage()

logging.getLogger("yfinance").addFilter(_SuppressDelistNoise())

# stooq uses its own suffix scheme, different from yfinance
_STOOQ_SUFFIX: Dict[str, str] = {
    # United States
    "NYSE": ".us",
    "NASDAQ": ".us",
    "NASDAQ_CM": ".us",
    "NASDAQ_GM": ".us",
    "NASDAQ_GS": ".us",
    "ARCA": ".us",
    "BATS": ".us",
    "AMEX": ".us",
    "CBOE": ".us",
    "IEX": ".us",
    # United Kingdom
    "LSE": ".uk",
    "LSEETF": ".uk",
    # Canada
    "TSX": ".ca",
    "TSE": ".ca",
    "TSXV": ".ca",
    "CVE": ".ca",
    # Germany
    "XETRA": ".de",
    "FWB": ".de",
    # Japan
    "TSE_JP": ".jp",
    # Hong Kong
    "HKEX": ".hk",
    "HKG": ".hk",
    # Hungary (stooq is Polish-origin, strong EU coverage)
    "EURONEXT": ".fr",
    "AEX": ".nl",
    # Australia — stooq has limited AU coverage, best-effort
    "ASX": ".au",
}

# Maps listing exchange identifiers (as they appear in broker CSVs) to yfinance ticker suffixes.
# US exchanges require no suffix; non-US exchanges need one.
_EXCHANGE_SUFFIX: Dict[str, str] = {
    # United States — no suffix
    "NYSE": "",
    "NASDAQ": "",
    "NASDAQ_CM": "",
    "NASDAQ_GM": "",
    "NASDAQ_GS": "",
    "ARCA": "",
    "BATS": "",
    "AMEX": "",
    "CBOE": "",
    "IEX": "",
    "LSEETF": ".L",  # IBKR code for London Stock Exchange ETFs
    # Canada
    "TSX": ".TO",
    "TSE": ".TO",   # IBKR uses TSE for Toronto Stock Exchange
    "TSXV": ".V",
    "CVE": ".V",
    # United Kingdom
    "LSE": ".L",
    # Germany
    "XETRA": ".DE",
    "FWB": ".F",
    # Australia
    "ASX": ".AX",
    # Hong Kong
    "HKEX": ".HK",
    "HKG": ".HK",
    # Japan
    "TSE_JP": ".T",
    # Euronext
    "EURONEXT": ".PA",
    "AEX": ".AS",
    "BRU": ".BR",
    # Switzerland
    "SWX": ".SW",
    # Singapore
    "SGX": ".SI",
}


def get_yf_ticker(symbol: str, listing_exchange: Optional[str] = None) -> str:
    """Construct the yfinance ticker symbol, appending the exchange suffix if needed."""
    sym = symbol.upper()
    if not listing_exchange:
        return sym
    exch_upper = listing_exchange.upper()
    if exch_upper not in _EXCHANGE_SUFFIX:
        logger.warning("Unknown listing exchange %r for %s — no suffix applied", listing_exchange, sym)
    suffix = _EXCHANGE_SUFFIX.get(exch_upper, "")
    return f"{sym}{suffix}"


def get_current_prices(
    symbols: List[str],
    symbol_exchange_map: Optional[Dict[str, str]] = None,
) -> Dict[str, dict]:
    """
    Fetch current price data for a list of symbols using yfinance fast_info.
    Returns a dict keyed by plain symbol (no exchange suffix).
    Uses only fast_info to avoid the rate-limit-prone ticker.info endpoint.
    """
    if not symbols:
        return {}

    exch_map = symbol_exchange_map or {}
    result: Dict[str, dict] = {s.upper(): {"price": None, "prev_close": None} for s in symbols}

    # Build yf_ticker -> plain_symbol mapping
    yf_ticker_to_sym: Dict[str, str] = {}
    for symbol in symbols:
        sym = symbol.upper()
        exchange = exch_map.get(sym)
        yf_ticker = get_yf_ticker(sym, exchange)
        yf_ticker_to_sym[yf_ticker] = sym
        logger.info("yfinance ticker mapping: %s (exchange=%s) -> %s", sym, exchange, yf_ticker)

    tickers = list(yf_ticker_to_sym.items())
    for idx, (yf_ticker, sym) in enumerate(tickers):
        if idx > 0:
            time.sleep(random.uniform(5.0, 8.0))
        for attempt in range(3):
            try:
                ticker = yf.Ticker(yf_ticker)
                fi = ticker.fast_info

                price = getattr(fi, "last_price", None)
                prev_close = getattr(fi, "previous_close", None)

                # Fallback to 1-day history when fast_info has no price
                if price is None:
                    try:
                        hist = ticker.history(period="1d")
                        if not hist.empty:
                            price = float(hist["Close"].iloc[-1])
                            if prev_close is None and len(hist) >= 2:
                                prev_close = float(hist["Close"].iloc[-2])
                    except Exception:
                        pass

                if price is None:
                    # yfinance returned no price — try stooq before giving up
                    exchange = exch_map.get(sym)
                    stooq_price = _get_current_price_stooq(sym, exchange)
                    if stooq_price is not None:
                        logger.info("stooq current-price fallback succeeded for %s: %.4f", sym, stooq_price)
                        price = stooq_price

                result[sym] = {
                    "price": float(price) if price is not None else None,
                    "prev_close": float(prev_close) if prev_close is not None else None,
                    "day_high": float(getattr(fi, "day_high", None) or 0) or None,
                    "day_low": float(getattr(fi, "day_low", None) or 0) or None,
                    "volume": getattr(fi, "last_volume", None),
                    "market_cap": getattr(fi, "market_cap", None),
                    # Name is populated by the scheduler via a separate slow call
                    "name": None,
                }
                break
            except Exception as exc:
                msg = str(exc)
                if "429" in msg and attempt < 2:
                    time.sleep(10 * (attempt + 1))
                    continue
                logger.warning("Error fetching %s (%s): %s", sym, yf_ticker, exc)
                # Try stooq as a fallback for the current price
                exchange = exch_map.get(sym)
                stooq_price = _get_current_price_stooq(sym, exchange)
                if stooq_price is not None:
                    logger.info("stooq current-price fallback succeeded for %s: %.4f", sym, stooq_price)
                    result[sym] = {"price": stooq_price, "prev_close": None,
                                   "day_high": None, "day_low": None,
                                   "volume": None, "market_cap": None, "name": None}
                break

    return result


def _get_current_price_stooq(symbol: str, listing_exchange: Optional[str] = None) -> Optional[float]:
    """Return the most recent closing price from stooq (fallback when yfinance is rate-limited)."""
    try:
        import pandas_datareader.data as pdr
        from datetime import date, timedelta
        stooq_ticker = _get_stooq_ticker(symbol, listing_exchange)
        start = date.today() - timedelta(days=7)
        hist = pdr.DataReader(stooq_ticker, "stooq", start=start)
        if hist is not None and not hist.empty:
            hist = hist.sort_index()
            return float(hist["Close"].iloc[-1])
    except Exception as exc:
        logger.debug("stooq current-price fallback failed for %s: %s", symbol, exc)
    return None


def get_ticker_names(symbols: List[str], symbol_exchange_map: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """
    Fetch display names for a list of symbols via ticker.info.
    This is slower and more rate-limit-prone — call it separately from get_current_prices
    and only for symbols whose name is not yet known.
    """
    exch_map = symbol_exchange_map or {}
    names: Dict[str, str] = {}
    for symbol in symbols:
        sym = symbol.upper()
        yf_ticker = get_yf_ticker(sym, exch_map.get(sym))
        try:
            info = yf.Ticker(yf_ticker).info or {}
            name = info.get("longName") or info.get("shortName")
            if name:
                names[sym] = name
        except Exception:
            pass
        time.sleep(0.3)  # be gentle with the Yahoo Finance API
    return names


def get_price_history(
    symbol: str,
    period: str = "3mo",
    listing_exchange: Optional[str] = None,
) -> List[dict]:
    yf_ticker = get_yf_ticker(symbol, listing_exchange)
    try:
        hist = yf.Ticker(yf_ticker).history(period=period)
        return [
            {
                "timestamp": idx.isoformat(),
                "price": round(float(row["Close"]), 4),
            }
            for idx, row in hist.iterrows()
        ]
    except Exception as exc:
        logger.error("History fetch error for %s (%s): %s", symbol, yf_ticker, exc)
        return []


def _bars_from_dataframe(hist) -> List[dict]:
    """Convert a yfinance/stooq OHLCV DataFrame to our bar dict format."""
    bars = []
    for idx, row in hist.iterrows():
        bar_date = idx.date() if hasattr(idx, "date") else idx
        bars.append({
            "date": bar_date,
            "open": round(float(row["Open"]), 6) if row["Open"] else None,
            "high": round(float(row["High"]), 6) if row["High"] else None,
            "low": round(float(row["Low"]), 6) if row["Low"] else None,
            "close": round(float(row["Close"]), 6),
            "volume": float(row["Volume"]) if row["Volume"] else None,
        })
    return bars


def _get_stooq_ticker(symbol: str, listing_exchange: Optional[str] = None) -> str:
    sym = symbol.lower()
    suffix = ""
    if listing_exchange:
        suffix = _STOOQ_SUFFIX.get(listing_exchange.upper(), ".us")
    else:
        suffix = ".us"
    return f"{sym}{suffix}"


def _fetch_historical_stooq(symbol: str, start_date, listing_exchange: Optional[str] = None) -> List[dict]:
    """Fallback historical fetch using stooq via pandas-datareader."""
    try:
        import pandas_datareader.data as pdr
        from datetime import date as date_type
    except ImportError:
        logger.warning("pandas-datareader not installed; stooq fallback unavailable")
        return []

    stooq_ticker = _get_stooq_ticker(symbol, listing_exchange)
    if hasattr(start_date, "isoformat"):
        start = start_date
    else:
        from datetime import date as date_type
        start = date_type.fromisoformat(str(start_date))

    try:
        hist = pdr.DataReader(stooq_ticker, "stooq", start=start)
        if hist is None or hist.empty:
            logger.warning("stooq fallback: no data for %s (%s)", symbol, stooq_ticker)
            return []
        # stooq returns newest-first; sort ascending
        hist = hist.sort_index()
        logger.info("stooq fallback: got %d bars for %s (%s)", len(hist), symbol, stooq_ticker)
        return _bars_from_dataframe(hist)
    except Exception as exc:
        logger.warning("stooq fallback failed for %s (%s): %s", symbol, stooq_ticker, exc)
        return []


def get_historical_daily_prices(
    symbol: str,
    start_date,
    listing_exchange: Optional[str] = None,
) -> List[dict]:
    """
    Fetch daily OHLCV bars for a 2-year historical backfill.
    Tries yfinance first; falls back to stooq if Yahoo rate-limits or returns nothing.
    Returns a list of dicts with keys: date, open, high, low, close, volume.
    """
    yf_ticker = get_yf_ticker(symbol, listing_exchange)
    if hasattr(start_date, "isoformat"):
        start_str = start_date.isoformat()
    else:
        start_str = str(start_date)

    backoff = 5
    yf_failed = False
    for attempt in range(4):
        try:
            hist = yf.Ticker(yf_ticker).history(start=start_str, auto_adjust=True)
            if not hist.empty:
                return _bars_from_dataframe(hist)
            # Empty result — try stooq immediately
            yf_failed = True
            break
        except Exception as exc:
            msg = str(exc)
            if ("char 0" in msg or "429" in msg) and attempt < 3:
                logger.warning(
                    "yfinance rate-limited for %s (%s), retrying in %ds (attempt %d/4)",
                    symbol, yf_ticker, backoff, attempt + 1,
                )
                time.sleep(backoff)
                backoff *= 2
                continue
            logger.warning("yfinance historical fetch failed for %s (%s): %s — trying stooq", symbol, yf_ticker, exc)
            yf_failed = True
            break

    if yf_failed:
        return _fetch_historical_stooq(symbol, start_date, listing_exchange)
    return []


def validate_symbol(symbol: str, listing_exchange: Optional[str] = None) -> Optional[dict]:
    yf_ticker = get_yf_ticker(symbol, listing_exchange)
    try:
        ticker = yf.Ticker(yf_ticker)
        fi = ticker.fast_info
        price = getattr(fi, "last_price", None)

        if price is None:
            hist = ticker.history(period="1d")
            if hist.empty:
                return None
            price = float(hist["Close"].iloc[-1])

        info = {}
        try:
            info = ticker.info or {}
        except Exception:
            pass

        return {
            "symbol": symbol.upper(),
            "name": info.get("longName") or info.get("shortName") or symbol.upper(),
            "price": float(price),
        }
    except Exception:
        return None
