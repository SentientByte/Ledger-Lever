use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub fn db_path() -> PathBuf {
    // On Windows: %APPDATA%\com.ledgerlever.app\portfolio.db
    // Fallback: next to the executable
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = PathBuf::from(appdata).join("com.ledgerlever.app");
        std::fs::create_dir_all(&dir).ok();
        return dir.join("portfolio.db");
    }
    // Fallback for dev
    PathBuf::from("portfolio.db")
}

pub fn open() -> Result<Connection> {
    let path = db_path();
    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    create_schema(&conn)?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS positions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            name        TEXT,
            shares      REAL NOT NULL DEFAULT 0,
            avg_cost    REAL NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol            TEXT NOT NULL,
            listing_exchange  TEXT,
            dt                TEXT NOT NULL,
            quantity          REAL NOT NULL,
            price             REAL NOT NULL,
            commission        REAL NOT NULL DEFAULT 0,
            side              TEXT NOT NULL,
            notional          REAL NOT NULL DEFAULT 0,
            net               REAL NOT NULL DEFAULT 0,
            UNIQUE(symbol, dt, quantity, price)
        );

        CREATE TABLE IF NOT EXISTS price_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            price       REAL,
            prev_close  REAL,
            day_high    REAL,
            day_low     REAL,
            volume      REAL,
            market_cap  REAL,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            total_value REAL NOT NULL,
            total_cost  REAL NOT NULL DEFAULT 0,
            day_gain    REAL NOT NULL DEFAULT 0,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS historical_price_bars (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol  TEXT NOT NULL,
            date    TEXT NOT NULL,
            open    REAL,
            high    REAL,
            low     REAL,
            close   REAL NOT NULL,
            volume  REAL,
            UNIQUE(symbol, date)
        );

        CREATE TABLE IF NOT EXISTS cached_positions (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol            TEXT NOT NULL,
            listing_exchange  TEXT,
            quantity          REAL NOT NULL,
            avg_cost          REAL NOT NULL DEFAULT 0,
            cost_basis        REAL NOT NULL DEFAULT 0,
            first_lot_date    TEXT,
            updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cached_metrics (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            fills            INTEGER NOT NULL DEFAULT 0,
            realized_pnl     REAL NOT NULL DEFAULT 0,
            total_invested   REAL NOT NULL DEFAULT 0,
            active_positions INTEGER NOT NULL DEFAULT 0,
            last_fill        TEXT,
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_price_snapshots_symbol_ts
            ON price_snapshots(symbol, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_ts
            ON portfolio_snapshots(timestamp);
        CREATE INDEX IF NOT EXISTS idx_hist_bars_symbol_date
            ON historical_price_bars(symbol, date);
        CREATE INDEX IF NOT EXISTS idx_transactions_dt
            ON transactions(dt);
    ")?;
    Ok(())
}

fn run_migrations(conn: &Connection) -> Result<()> {
    // Ensure listing_exchange column exists (migration for older DBs)
    for table in &["transactions", "cached_positions"] {
        let has_col: bool = conn
            .prepare(&format!("PRAGMA table_info({})", table))?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .any(|name| name == "listing_exchange");
        if !has_col {
            conn.execute_batch(&format!(
                "ALTER TABLE {} ADD COLUMN listing_exchange TEXT",
                table
            ))?;
        }
    }
    Ok(())
}
