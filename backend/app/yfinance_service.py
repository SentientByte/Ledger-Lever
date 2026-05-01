import logging
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
    suffix = _EXCHANGE_SUFFIX.get(listing_exchange.upper(), "")
    return f"{sym}{suffix}"


def get_current_prices(
    symbols: List[str],
    symbol_exchange_map: Optional[Dict[str, str]] = None,
) -> Dict[str, dict]:
    if not symbols:
        return {}

    exch_map = symbol_exchange_map or {}
    result: Dict[str, dict] = {}
    for symbol in symbols:
        result[symbol.upper()] = {"price": None, "prev_close": None}

    # Build yf_ticker -> plain_symbol mapping so results can be keyed by plain symbol
    yf_ticker_to_sym: Dict[str, str] = {}
    for symbol in symbols:
        sym = symbol.upper()
        yf_ticker = get_yf_ticker(sym, exch_map.get(sym))
        yf_ticker_to_sym[yf_ticker] = sym

    try:
        tickers = yf.Tickers(" ".join(yf_ticker_to_sym.keys()))
        for yf_ticker, sym in yf_ticker_to_sym.items():
            try:
                ticker = tickers.tickers.get(yf_ticker) or yf.Ticker(yf_ticker)
                fi = ticker.fast_info
                price = getattr(fi, "last_price", None)
                prev_close = getattr(fi, "previous_close", None)

                if price is None:
                    hist = ticker.history(period="1d")
                    if not hist.empty:
                        price = float(hist["Close"].iloc[-1])

                info = {}
                try:
                    info = ticker.info or {}
                except Exception:
                    pass

                result[sym] = {
                    "price": float(price) if price is not None else None,
                    "prev_close": float(prev_close) if prev_close is not None else None,
                    "day_high": float(getattr(fi, "day_high", None) or 0) or None,
                    "day_low": float(getattr(fi, "day_low", None) or 0) or None,
                    "volume": getattr(fi, "last_volume", None),
                    "market_cap": getattr(fi, "market_cap", None),
                    "name": info.get("longName") or info.get("shortName") or sym,
                }
            except Exception as exc:
                logger.warning("Error fetching %s (%s): %s", sym, yf_ticker, exc)
    except Exception as exc:
        logger.error("Batch fetch error: %s", exc)

    return result


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
