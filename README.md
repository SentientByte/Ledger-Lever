# Ledger Lever — Portfolio Dashboard

A real-time personal portfolio tracking dashboard with live prices from Yahoo Finance, historical data storage, and auto-refresh every 60 seconds.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI · SQLAlchemy · SQLite · APScheduler |
| Data | yfinance (Yahoo Finance) |
| Frontend | React 18 · Vite · Chart.js · Tailwind CSS |
| Runtime | Docker · Docker Compose |

## Features

- **Live prices** pulled from Yahoo Finance, refreshed every 60 seconds automatically
- **Portfolio summary** — total value, day P&L, total P&L with percentages
- **Performance chart** — portfolio value vs cost basis over 1W / 1M / 3M / 1Y
- **Allocation chart** — donut chart with per-position breakdown
- **Holdings table** — sortable, shows price, day range, day gain, total return
- **Add / Edit / Remove** positions with real-time symbol validation
- **Historical data** stored in SQLite so charts persist across restarts
- **Manual refresh** button + countdown timer

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
