import logging
from typing import Dict, List, Optional
import yfinance as yf

logger = logging.getLogger(__name__)


def get_current_prices(symbols: List[str]) -> Dict[str, dict]:
    if not symbols:
        return {}

    result: Dict[str, dict] = {}
    for symbol in symbols:
        result[symbol] = {"price": None, "prev_close": None}

    try:
        tickers = yf.Tickers(" ".join(s.upper() for s in symbols))
        for symbol in symbols:
            sym = symbol.upper()
            try:
                ticker = tickers.tickers.get(sym) or yf.Ticker(sym)
                fi = ticker.fast_info
                price = getattr(fi, "last_price", None)
                prev_close = getattr(fi, "previous_close", None)

                if price is None:
                    # fallback: 1-day history
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
                logger.warning("Error fetching %s: %s", sym, exc)
    except Exception as exc:
        logger.error("Batch fetch error: %s", exc)

    return result


def get_price_history(symbol: str, period: str = "3mo") -> List[dict]:
    try:
        hist = yf.Ticker(symbol.upper()).history(period=period)
        return [
            {
                "timestamp": idx.isoformat(),
                "price": round(float(row["Close"]), 4),
            }
            for idx, row in hist.iterrows()
        ]
    except Exception as exc:
        logger.error("History fetch error for %s: %s", symbol, exc)
        return []


def validate_symbol(symbol: str) -> Optional[dict]:
    try:
        ticker = yf.Ticker(symbol.upper())
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
