import logging
import time
from typing import Dict, List, Optional

import yfinance as yf

logger = logging.getLogger(__name__)

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
    "LSEETF": "",   # IBKR sometimes tags US-listed ETFs with this; no suffix needed
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
            time.sleep(1.5)
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
                break

    return result


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


def get_historical_daily_prices(
    symbol: str,
    start_date,
    listing_exchange: Optional[str] = None,
) -> List[dict]:
    """
    Fetch daily OHLCV bars from yfinance for a 2-year historical backfill.
    Returns a list of dicts with keys: date, open, high, low, close, volume.
    """
    from datetime import date as date_type, datetime as dt_type
    yf_ticker = get_yf_ticker(symbol, listing_exchange)
    try:
        if hasattr(start_date, "isoformat"):
            start_str = start_date.isoformat()
        else:
            start_str = str(start_date)
        hist = yf.Ticker(yf_ticker).history(start=start_str, auto_adjust=True)
        if hist.empty:
            return []
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
    except Exception as exc:
        logger.error("Historical daily fetch error for %s (%s): %s", symbol, yf_ticker, exc)
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
