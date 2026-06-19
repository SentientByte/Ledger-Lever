import logging
import os
import time
from datetime import date as date_type, datetime as dt_type
from typing import Dict, List, Optional

import requests
import yfinance as yf

logger = logging.getLogger(__name__)

# ── Exchange suffix tables ─────────────────────────────────────────────────────

# yfinance ticker suffix by IBKR exchange code
_EXCHANGE_SUFFIX: Dict[str, str] = {
    "NYSE": "", "NASDAQ": "", "NASDAQ_CM": "", "NASDAQ_GM": "", "NASDAQ_GS": "",
    "ARCA": "", "BATS": "", "AMEX": "", "CBOE": "", "IEX": "",
    "LSEETF": ".L",
    "TSX": ".TO", "TSE": ".TO", "TSXV": ".V", "CVE": ".V",
    "LSE": ".L",
    "XETRA": ".DE", "FWB": ".F",
    "ASX": ".AX",
    "HKEX": ".HK", "HKG": ".HK",
    "TSE_JP": ".T",
    "EURONEXT": ".PA", "AEX": ".AS", "BRU": ".BR",
    "SWX": ".SW",
    "SGX": ".SI",
}

# Twelve Data exchange name by IBKR exchange code (only non-US need explicit exchange)
_TD_EXCHANGE: Dict[str, str] = {
    "LSEETF": "LSE", "LSE": "LSE",
    "TSX": "TSX", "TSE": "TSX", "TSXV": "TSXV", "CVE": "TSXV",
    "XETRA": "XETRA", "FWB": "FWB",
    "ASX": "ASX",
    "HKEX": "HKEX", "HKG": "HKEX",
    "TSE_JP": "TSE",
    "EURONEXT": "EURONEXT", "AEX": "EURONEXT",
    "SWX": "SWX",
    "SGX": "SGX",
}

_TD_BASE = "https://api.twelvedata.com"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _td_key() -> Optional[str]:
    return os.environ.get("TWELVE_DATA_API_KEY") or None


def get_yf_ticker(symbol: str, listing_exchange: Optional[str] = None) -> str:
    sym = symbol.upper()
    if not listing_exchange:
        return sym
    exch_upper = listing_exchange.upper()
    if exch_upper not in _EXCHANGE_SUFFIX:
        logger.warning("Unknown listing exchange %r for %s — no suffix applied", listing_exchange, sym)
    return f"{sym}{_EXCHANGE_SUFFIX.get(exch_upper, '')}"


def _td_params(symbol: str, listing_exchange: Optional[str] = None) -> dict:
    """Build base Twelve Data query params for a symbol."""
    p: dict = {"symbol": symbol.upper()}
    if listing_exchange:
        exch = _TD_EXCHANGE.get(listing_exchange.upper())
        if exch:
            p["exchange"] = exch
    return p


def _td_get(path: str, params: dict, retries: int = 3) -> Optional[dict]:
    """GET a Twelve Data endpoint, returning parsed JSON or None on failure."""
    key = _td_key()
    if not key:
        return None
    params = {**params, "apikey": key}
    backoff = 10
    for attempt in range(retries):
        try:
            r = requests.get(f"{_TD_BASE}{path}", params=params, timeout=15)
            if r.status_code == 429:
                logger.warning("Twelve Data rate limit hit, waiting %ds", backoff)
                time.sleep(backoff)
                backoff *= 2
                continue
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and data.get("status") == "error":
                logger.warning("Twelve Data error for %s: %s", params.get("symbol"), data.get("message"))
                return None
            return data
        except Exception as exc:
            logger.warning("Twelve Data request failed (%s): %s", path, exc)
            if attempt < retries - 1:
                time.sleep(backoff)
                backoff *= 2
    return None


def _bars_from_dataframe(hist) -> List[dict]:
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


# ── Current prices ─────────────────────────────────────────────────────────────

def _td_get_current_prices(
    symbols: List[str],
    symbol_exchange_map: Optional[Dict[str, str]] = None,
) -> Dict[str, dict]:
    """Fetch current quotes from Twelve Data. Returns partial results (missing symbols stay None)."""
    exch_map = symbol_exchange_map or {}
    result: Dict[str, dict] = {}

    for idx, symbol in enumerate(symbols):
        sym = symbol.upper()
        if idx > 0:
            time.sleep(8)  # stay within 8 req/min free tier
        params = _td_params(sym, exch_map.get(sym))
        data = _td_get("/quote", params)
        if not data:
            continue
        try:
            price = float(data["close"]) if data.get("close") else None
            prev_close = float(data["previous_close"]) if data.get("previous_close") else None
            result[sym] = {
                "price": price,
                "prev_close": prev_close,
                "day_high": float(data["high"]) if data.get("high") else None,
                "day_low": float(data["low"]) if data.get("low") else None,
                "volume": int(data["volume"]) if data.get("volume") else None,
                "market_cap": None,  # not in TD quote
                "name": data.get("name") or None,
            }
            logger.info("Twelve Data quote: %s @ %s", sym, price)
        except Exception as exc:
            logger.warning("Twelve Data quote parse error for %s: %s", sym, exc)

    return result


def get_current_prices(
    symbols: List[str],
    symbol_exchange_map: Optional[Dict[str, str]] = None,
) -> Dict[str, dict]:
    """
    Fetch current price data for a list of symbols.
    Uses Twelve Data when TWELVE_DATA_API_KEY is set, falls back to yfinance.
    """
    if not symbols:
        return {}

    exch_map = symbol_exchange_map or {}
    result: Dict[str, dict] = {s.upper(): {"price": None, "prev_close": None} for s in symbols}

    if _td_key():
        td_result = _td_get_current_prices(symbols, exch_map)
        result.update(td_result)
        # Only fall back to yfinance for symbols TD couldn't fill
        missing = [s for s in symbols if result[s.upper()].get("price") is None]
        if not missing:
            return result
        logger.info("Twelve Data missing %d symbol(s), trying yfinance: %s", len(missing), missing)
        symbols_to_fetch = missing
    else:
        symbols_to_fetch = symbols

    # yfinance path
    yf_ticker_to_sym: Dict[str, str] = {}
    for symbol in symbols_to_fetch:
        sym = symbol.upper()
        yf_ticker = get_yf_ticker(sym, exch_map.get(sym))
        yf_ticker_to_sym[yf_ticker] = sym
        logger.info("yfinance ticker mapping: %s (exchange=%s) -> %s", sym, exch_map.get(sym), yf_ticker)

    for idx, (yf_ticker, sym) in enumerate(yf_ticker_to_sym.items()):
        if idx > 0:
            time.sleep(1.5)
        for attempt in range(3):
            try:
                ticker = yf.Ticker(yf_ticker)
                fi = ticker.fast_info
                price = getattr(fi, "last_price", None)
                prev_close = getattr(fi, "previous_close", None)

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


# ── Ticker names ───────────────────────────────────────────────────────────────

def get_ticker_names(symbols: List[str], symbol_exchange_map: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """
    Fetch display names. Uses Twelve Data /quote (name field) when key available,
    otherwise falls back to yfinance ticker.info.
    """
    exch_map = symbol_exchange_map or {}
    names: Dict[str, str] = {}

    if _td_key():
        for idx, symbol in enumerate(symbols):
            sym = symbol.upper()
            if idx > 0:
                time.sleep(8)
            params = _td_params(sym, exch_map.get(sym))
            data = _td_get("/quote", params)
            if data and data.get("name"):
                names[sym] = data["name"]
        return names

    # yfinance fallback
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
        time.sleep(0.3)
    return names


# ── Price history (chart endpoint) ─────────────────────────────────────────────

def get_price_history(
    symbol: str,
    period: str = "3mo",
    listing_exchange: Optional[str] = None,
) -> List[dict]:
    """
    Fetch recent price history for charting (not OHLCV backfill).
    Uses Twelve Data when key available, falls back to yfinance.
    """
    # Map yfinance period strings to Twelve Data outputsize / start_date
    _period_to_days = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825}
    days = _period_to_days.get(period, 90)

    if _td_key():
        from datetime import timedelta
        start = (dt_type.utcnow() - timedelta(days=days)).date().isoformat()
        params = {**_td_params(symbol, listing_exchange), "interval": "1day", "start_date": start, "outputsize": 5000}
        data = _td_get("/time_series", params)
        if data and data.get("values"):
            return [
                {"timestamp": v["datetime"], "price": round(float(v["close"]), 4)}
                for v in reversed(data["values"])
            ]

    yf_ticker = get_yf_ticker(symbol, listing_exchange)
    try:
        hist = yf.Ticker(yf_ticker).history(period=period)
        return [
            {"timestamp": idx.isoformat(), "price": round(float(row["Close"]), 4)}
            for idx, row in hist.iterrows()
        ]
    except Exception as exc:
        logger.error("History fetch error for %s (%s): %s", symbol, yf_ticker, exc)
        return []


# ── Historical daily bars (backfill) ───────────────────────────────────────────

def _td_get_historical(symbol: str, start_date, listing_exchange: Optional[str] = None) -> List[dict]:
    """Fetch 2-year daily OHLCV from Twelve Data /time_series."""
    if hasattr(start_date, "isoformat"):
        start_str = start_date.isoformat()
    else:
        start_str = str(start_date)

    params = {
        **_td_params(symbol, listing_exchange),
        "interval": "1day",
        "start_date": start_str,
        "outputsize": 5000,
    }
    data = _td_get("/time_series", params)
    if not data or not data.get("values"):
        return []

    bars = []
    for v in reversed(data["values"]):  # TD returns newest-first
        try:
            bars.append({
                "date": date_type.fromisoformat(v["datetime"][:10]),
                "open": round(float(v["open"]), 6) if v.get("open") else None,
                "high": round(float(v["high"]), 6) if v.get("high") else None,
                "low": round(float(v["low"]), 6) if v.get("low") else None,
                "close": round(float(v["close"]), 6),
                "volume": float(v["volume"]) if v.get("volume") else None,
            })
        except Exception:
            continue

    logger.info("Twelve Data history: got %d bars for %s", len(bars), symbol)
    return bars


def get_historical_daily_prices(
    symbol: str,
    start_date,
    listing_exchange: Optional[str] = None,
) -> List[dict]:
    """
    Fetch daily OHLCV bars for a 2-year historical backfill.
    Uses Twelve Data when TWELVE_DATA_API_KEY is set; falls back to yfinance.
    """
    if _td_key():
        bars = _td_get_historical(symbol, start_date, listing_exchange)
        if bars:
            return bars
        logger.warning("Twelve Data returned no bars for %s — trying yfinance", symbol)

    # yfinance fallback
    yf_ticker = get_yf_ticker(symbol, listing_exchange)
    if hasattr(start_date, "isoformat"):
        start_str = start_date.isoformat()
    else:
        start_str = str(start_date)

    backoff = 5
    for attempt in range(4):
        try:
            hist = yf.Ticker(yf_ticker).history(start=start_str, auto_adjust=True)
            if not hist.empty:
                return _bars_from_dataframe(hist)
            return []
        except Exception as exc:
            msg = str(exc)
            if ("char 0" in msg or "429" in msg) and attempt < 3:
                logger.warning(
                    "yfinance rate-limited for %s, retrying in %ds (attempt %d/4)",
                    symbol, backoff, attempt + 1,
                )
                time.sleep(backoff)
                backoff *= 2
                continue
            logger.warning("yfinance historical fetch failed for %s: %s", symbol, exc)
            return []
    return []


# ── Symbol validation ──────────────────────────────────────────────────────────

def validate_symbol(symbol: str, listing_exchange: Optional[str] = None) -> Optional[dict]:
    if _td_key():
        params = _td_params(symbol, listing_exchange)
        data = _td_get("/quote", params)
        if data and data.get("close"):
            return {
                "symbol": symbol.upper(),
                "name": data.get("name") or symbol.upper(),
                "price": float(data["close"]),
            }

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
