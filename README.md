# Ledger Lever — Portfolio Dashboard

A real-time personal portfolio tracking dashboard with live prices from Yahoo Finance, historical data storage, and market-aware auto-refresh (every 30 seconds while the US market is open, 5 minutes when closed).

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI · SQLAlchemy · SQLite · APScheduler |
| Data | yfinance (Yahoo Finance) |
| Frontend | React 18 · Vite · Chart.js · Tailwind CSS |
| Runtime | Docker · Docker Compose |

## Features

- **Live prices** pulled from Yahoo Finance, refreshed every 30 seconds while the US market is open (Mon–Fri 09:30–16:00 ET, excluding holidays) and every 5 minutes when closed
- **Portfolio summary** — total value, day P&L, total P&L with percentages
- **Trailing-12-month total return** — time-weighted (IBKR "performance %" methodology), benchmarked against the S&P 500 (SPY) and Nasdaq-100 (QQQ), with weekend/holiday gaps removed and partial-coverage dips repaired
- **Performance indicators** — MTD / QTD / YTD / since-inception, all time-weighted off a cleaned trading-day series
- **Allocation chart** — per-position breakdown by market value
- **Holdings table** — sortable, shows price, day range, day gain, total return
- **Risk ledger** — VaR/CVaR, drawdown, correlation matrix, factor & stress tests, plus a **Monte-Carlo outcome simulator** (GBM with realized σ/β/correlations from price history, adjustable rate/macro/bubble/oil/gold scenarios, and current-vs-proposed comparison)
- **Add / Edit / Remove** positions with real-time symbol validation
- **Historical data** stored in SQLite so charts persist across restarts
- **Manual refresh** button

## Quick Start

```bash
git clone <repo-url>
cd Ledger-Lever
docker compose up --build
```

Open **http://localhost:3000** in your browser.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/portfolio/summary` | Portfolio totals |
| GET | `/api/positions` | All positions with live data |
| POST | `/api/positions` | Add a position |
| PUT | `/api/positions/{id}` | Edit a position |
| DELETE | `/api/positions/{id}` | Remove a position |
| GET | `/api/portfolio/performance?days=30` | Historical portfolio value |
| GET | `/api/prices/{symbol}/history?period=3mo` | Symbol price history |
| POST | `/api/portfolio/refresh` | Force price refresh |
| GET | `/api/validate/{symbol}` | Validate ticker symbol |

## Data Persistence

Positions and price history are stored in a SQLite database in a named Docker volume (`portfolio_data`). Data survives container restarts.

## Development

```bash
# Backend (auto-reload)
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend && npm install && npm run dev
```
