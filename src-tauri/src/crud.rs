use rusqlite::{Connection, Result, params, OptionalExtension};
use std::collections::HashMap;
use crate::models::*;
use crate::fifo;

// ── Positions ─────────────────────────────────────────────────────────────────

pub fn get_positions(conn: &Connection) -> Result<Vec<Position>> {
    let mut stmt = conn.prepare(
        "SELECT id, symbol, name, shares, avg_cost, created_at, updated_at FROM positions ORDER BY id"
    )?;
    let rows = stmt.query_map([], |row| Ok(Position {
        id: row.get(0)?,
        symbol: row.get(1)?,
        name: row.get(2)?,
        shares: row.get(3)?,
        avg_cost: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    }))?;
    rows.collect()
}

pub fn create_position(conn: &Connection, symbol: &str, name: Option<&str>, shares: f64, avg_cost: f64) -> Result<i64> {
    conn.execute(
        "INSERT INTO positions (symbol, name, shares, avg_cost) VALUES (?1, ?2, ?3, ?4)",
        params![symbol.to_uppercase(), name, shares, avg_cost],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_position(conn: &Connection, id: i64, shares: Option<f64>, avg_cost: Option<f64>) -> Result<bool> {
    let affected = if let (Some(s), Some(c)) = (shares, avg_cost) {
        conn.execute(
            "UPDATE positions SET shares=?1, avg_cost=?2, updated_at=datetime('now') WHERE id=?3",
            params![s, c, id],
        )?
    } else if let Some(s) = shares {
        conn.execute(
            "UPDATE positions SET shares=?1, updated_at=datetime('now') WHERE id=?2",
            params![s, id],
        )?
    } else if let Some(c) = avg_cost {
        conn.execute(
            "UPDATE positions SET avg_cost=?1, updated_at=datetime('now') WHERE id=?2",
            params![c, id],
        )?
    } else {
        return Ok(false);
    };
    Ok(affected > 0)
}

pub fn delete_position(conn: &Connection, id: i64) -> Result<bool> {
    let n = conn.execute("DELETE FROM positions WHERE id=?1", params![id])?;
    Ok(n > 0)
}

pub fn update_position_names(conn: &Connection, names: &HashMap<String, String>) -> Result<()> {
    for (symbol, name) in names {
        if name.is_empty() || name == symbol {
            continue;
        }
        conn.execute(
            "UPDATE positions SET name=?1 WHERE symbol=?2 AND name IS NULL",
            params![name, symbol.to_uppercase()],
        )?;
    }
    Ok(())
}

// ── Price snapshots ───────────────────────────────────────────────────────────

pub fn save_price_snapshot(conn: &Connection, symbol: &str, data: &PriceData) -> Result<()> {
    conn.execute(
        "INSERT INTO price_snapshots (symbol, price, prev_close, day_high, day_low, volume, market_cap)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            symbol.to_uppercase(),
            data.price,
            data.prev_close,
            data.day_high,
            data.day_low,
            data.volume,
            data.market_cap,
        ],
    )?;
    Ok(())
}

pub fn get_latest_prices(conn: &Connection, symbols: &[String]) -> Result<HashMap<String, PriceSnapshot>> {
    if symbols.is_empty() {
        return Ok(HashMap::new());
    }
    let syms_upper: Vec<String> = symbols.iter().map(|s| s.to_uppercase()).collect();
    let placeholders = vec!["?"; syms_upper.len()].join(",");
    // Inner query uses the same param list twice — duplicate for the JOIN subquery
    let sql = format!(
        "SELECT ps.symbol, ps.price, ps.prev_close, ps.day_high, ps.day_low, ps.volume, ps.market_cap, ps.timestamp
         FROM price_snapshots ps
         INNER JOIN (
             SELECT symbol, MAX(timestamp) AS max_ts FROM price_snapshots
             WHERE symbol IN ({placeholders}) GROUP BY symbol
         ) latest ON ps.symbol = latest.symbol AND ps.timestamp = latest.max_ts
         WHERE ps.symbol IN ({placeholders})",
        placeholders = placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    // params appear twice in the query (once per IN clause)
    let all_params: Vec<&String> = syms_upper.iter().chain(syms_upper.iter()).collect();
    let rows = stmt.query_map(rusqlite::params_from_iter(all_params), |row| {
        Ok(PriceSnapshot {
            symbol: row.get(0)?,
            price: row.get(1)?,
            prev_close: row.get(2)?,
            day_high: row.get(3)?,
            day_low: row.get(4)?,
            volume: row.get(5)?,
            market_cap: row.get(6)?,
            timestamp: row.get(7)?,
        })
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let snap = row?;
        map.insert(snap.symbol.clone(), snap);
    }
    Ok(map)
}

// ── Portfolio snapshots ───────────────────────────────────────────────────────

pub fn save_portfolio_snapshot(conn: &Connection, total_value: f64, total_cost: f64, day_gain: f64) -> Result<()> {
    conn.execute(
        "INSERT INTO portfolio_snapshots (total_value, total_cost, day_gain) VALUES (?1,?2,?3)",
        params![total_value, total_cost, day_gain],
    )?;
    Ok(())
}

pub fn get_portfolio_performance(conn: &Connection, days: i64) -> Result<Vec<PerformancePoint>> {
    let mut stmt = conn.prepare(
        "SELECT timestamp, total_value, total_cost FROM portfolio_snapshots
         WHERE timestamp >= datetime('now', ?1)
         ORDER BY timestamp"
    )?;
    let since = format!("-{} days", days);
    let rows = stmt.query_map(params![since], |row| {
        Ok(PerformancePoint {
            timestamp: row.get(0)?,
            total_value: row.get(1)?,
            total_cost: row.get(2)?,
        })
    })?;
    // Deduplicate to one point per calendar day (last snapshot of each day)
    let mut by_date: HashMap<String, PerformancePoint> = HashMap::new();
    for row in rows {
        let pt = row?;
        let day = pt.timestamp.get(..10).unwrap_or(&pt.timestamp).to_string();
        let existing_ts = by_date.get(&day).map(|p| p.timestamp.clone()).unwrap_or_default();
        if pt.timestamp > existing_ts {
            by_date.insert(day, pt);
        }
    }
    let mut result: Vec<_> = by_date.into_values().collect();
    result.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(result)
}

pub fn bulk_save_portfolio_snapshots(conn: &Connection, snapshots: &[(f64, f64, f64, String)]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (tv, tc, dg, ts) in snapshots {
        tx.execute(
            "INSERT OR IGNORE INTO portfolio_snapshots (total_value, total_cost, day_gain, timestamp)
             VALUES (?1,?2,?3,?4)",
            params![tv, tc, dg, ts],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Remove backfill-reconstructed snapshots (saved at the 16:00 close) within the
/// window so they can be regenerated cleanly. Live intraday snapshots — which
/// carry a real day_gain and a non-16:00:00 timestamp — are preserved.
pub fn clear_reconstructed_snapshots(conn: &Connection, since: &str) -> Result<usize> {
    let n = conn.execute(
        "DELETE FROM portfolio_snapshots
         WHERE timestamp >= ?1 AND timestamp LIKE '% 16:00:00' AND day_gain = 0",
        params![since],
    )?;
    Ok(n)
}

pub fn get_existing_snapshot_dates(conn: &Connection, since: &str) -> Result<std::collections::HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT substr(timestamp,1,10) FROM portfolio_snapshots WHERE timestamp >= ?1"
    )?;
    let rows = stmt.query_map(params![since], |row| row.get::<_, String>(0))?;
    let mut set = std::collections::HashSet::new();
    for r in rows {
        set.insert(r?);
    }
    Ok(set)
}

// ── Transactions ──────────────────────────────────────────────────────────────

pub fn create_transaction(
    conn: &Connection,
    symbol: &str,
    listing_exchange: Option<&str>,
    dt: &str,
    quantity: f64,
    price: f64,
    commission: f64,
) -> Result<bool> {
    let side = if quantity > 0.0 { "BUY" } else { "SELL" };
    let notional = (quantity.abs() * price * 100.0).round() / 100.0;
    let net = if quantity > 0.0 {
        (-(notional + commission) * 100.0).round() / 100.0
    } else {
        ((notional - commission) * 100.0).round() / 100.0
    };
    let result = conn.execute(
        "INSERT OR IGNORE INTO transactions
         (symbol, listing_exchange, dt, quantity, price, commission, side, notional, net)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![symbol.to_uppercase(), listing_exchange, dt, quantity, price, commission, side, notional, net],
    )?;
    Ok(result > 0)
}

pub fn get_transactions(
    conn: &Connection,
    symbol: Option<&str>,
    side: Option<&str>,
    page: i64,
    page_size: i64,
) -> Result<(Vec<Transaction>, i64)> {
    let sym_upper = symbol.map(|s| s.to_uppercase());
    let side_upper = side.map(|s| s.to_uppercase());
    let offset = (page - 1) * page_size;

    macro_rules! map_row {
        ($row:expr) => {
            Transaction {
                id: $row.get(0)?,
                symbol: $row.get(1)?,
                listing_exchange: $row.get(2)?,
                dt: $row.get(3)?,
                quantity: $row.get(4)?,
                price: $row.get(5)?,
                commission: $row.get(6)?,
                side: $row.get(7)?,
                notional: $row.get(8)?,
                net: $row.get(9)?,
            }
        };
    }

    match (sym_upper.as_deref(), side_upper.as_deref()) {
        (Some(s), Some(sd)) => {
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM transactions WHERE symbol=?1 AND side=?2",
                params![s, sd], |r| r.get(0))?;
            let items = conn.prepare(
                "SELECT id,symbol,listing_exchange,dt,quantity,price,commission,side,notional,net
                 FROM transactions WHERE symbol=?1 AND side=?2 ORDER BY dt DESC LIMIT ?3 OFFSET ?4")?
                .query_map(params![s, sd, page_size, offset], |r| Ok(map_row!(r)))?
                .collect::<Result<Vec<_>>>()?;
            Ok((items, total))
        }
        (Some(s), None) => {
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM transactions WHERE symbol=?1",
                params![s], |r| r.get(0))?;
            let items = conn.prepare(
                "SELECT id,symbol,listing_exchange,dt,quantity,price,commission,side,notional,net
                 FROM transactions WHERE symbol=?1 ORDER BY dt DESC LIMIT ?2 OFFSET ?3")?
                .query_map(params![s, page_size, offset], |r| Ok(map_row!(r)))?
                .collect::<Result<Vec<_>>>()?;
            Ok((items, total))
        }
        (None, Some(sd)) => {
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM transactions WHERE side=?1",
                params![sd], |r| r.get(0))?;
            let items = conn.prepare(
                "SELECT id,symbol,listing_exchange,dt,quantity,price,commission,side,notional,net
                 FROM transactions WHERE side=?1 ORDER BY dt DESC LIMIT ?2 OFFSET ?3")?
                .query_map(params![sd, page_size, offset], |r| Ok(map_row!(r)))?
                .collect::<Result<Vec<_>>>()?;
            Ok((items, total))
        }
        (None, None) => {
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM transactions", [], |r| r.get(0))?;
            let items = conn.prepare(
                "SELECT id,symbol,listing_exchange,dt,quantity,price,commission,side,notional,net
                 FROM transactions ORDER BY dt DESC LIMIT ?1 OFFSET ?2")?
                .query_map(params![page_size, offset], |r| Ok(map_row!(r)))?
                .collect::<Result<Vec<_>>>()?;
            Ok((items, total))
        }
    }
}

pub fn get_all_transactions_sorted(conn: &Connection) -> Result<Vec<TxnRow>> {
    let mut stmt = conn.prepare(
        "SELECT symbol, listing_exchange, dt, quantity, price, commission, side
         FROM transactions ORDER BY dt ASC"
    )?;
    let rows = stmt.query_map([], |row| Ok(TxnRow {
        symbol: row.get(0)?,
        listing_exchange: row.get(1)?,
        dt: row.get(2)?,
        quantity: row.get(3)?,
        price: row.get(4)?,
        commission: row.get(5)?,
        side: row.get(6)?,
    }))?;
    rows.collect()
}

/// Net capital invested = total cash paid for buys (incl. commission) minus
/// net proceeds received from sells. Equals -SUM(net) since `net` is negative
/// for buys and positive for sells.
pub fn get_net_invested(conn: &Connection) -> Result<f64> {
    conn.query_row(
        "SELECT -COALESCE(SUM(net), 0) FROM transactions",
        [],
        |r| r.get(0),
    )
}

pub fn get_transaction_symbols(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT symbol FROM transactions ORDER BY symbol"
    )?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

pub fn delete_all_transactions(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM transactions")?;
    Ok(())
}

pub fn get_year_activity(transactions: &[TxnRow]) -> Vec<YearActivity> {
    let mut by_year: HashMap<i64, YearActivity> = HashMap::new();
    for txn in transactions {
        let year = txn.dt.get(..4)
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let entry = by_year.entry(year).or_insert(YearActivity { year, notional: 0.0, buys: 0, sells: 0 });
        let notional = (txn.quantity.abs() * txn.price * 100.0).round() / 100.0;
        entry.notional += notional;
        if txn.side == "BUY" { entry.buys += 1; } else { entry.sells += 1; }
    }
    let mut result: Vec<_> = by_year.into_values().collect();
    result.sort_by_key(|a| a.year);
    result
}

// ── FIFO cache ────────────────────────────────────────────────────────────────

pub fn update_cache(
    conn: &Connection,
    fifo: &fifo::FifoResult,
    fills: i64,
    last_fill: Option<&str>,
    exchange_map: &HashMap<String, String>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM cached_positions", [])?;
    for (sym, pos) in &fifo.positions {
        tx.execute(
            "INSERT INTO cached_positions (symbol, listing_exchange, quantity, avg_cost, cost_basis, first_lot_date)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                sym.to_uppercase(),
                exchange_map.get(&sym.to_uppercase()),
                pos.quantity,
                pos.avg_cost,
                pos.cost_basis,
                pos.first_lot_date,
            ],
        )?;
    }
    // Upsert metrics
    let has_metrics: bool = tx.query_row(
        "SELECT COUNT(*) FROM cached_metrics", [], |r| r.get::<_, i64>(0)
    ).map(|c| c > 0).unwrap_or(false);
    if has_metrics {
        tx.execute(
            "UPDATE cached_metrics SET fills=?1, realized_pnl=?2, total_invested=?3,
             active_positions=?4, last_fill=?5, updated_at=datetime('now')",
            params![fills, fifo.realized_pnl, fifo.total_invested, fifo.positions.len() as i64, last_fill],
        )?;
    } else {
        tx.execute(
            "INSERT INTO cached_metrics (fills, realized_pnl, total_invested, active_positions, last_fill)
             VALUES (?1,?2,?3,?4,?5)",
            params![fills, fifo.realized_pnl, fifo.total_invested, fifo.positions.len() as i64, last_fill],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn sync_positions_from_fifo(conn: &Connection, fifo: &fifo::FifoResult) -> Result<()> {
    // Preserve existing names
    let existing_names: HashMap<String, String> = {
        let mut stmt = conn.prepare("SELECT symbol, name FROM positions WHERE name IS NOT NULL")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM positions", [])?;
    for (sym, pos) in &fifo.positions {
        let sym_up = sym.to_uppercase();
        let name = existing_names.get(&sym_up).cloned();
        tx.execute(
            "INSERT INTO positions (symbol, name, shares, avg_cost) VALUES (?1,?2,?3,?4)",
            params![sym_up, name, pos.quantity, pos.avg_cost],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn get_cached_positions(conn: &Connection) -> Result<Vec<CachedPosition>> {
    let mut stmt = conn.prepare(
        "SELECT symbol, listing_exchange, quantity, avg_cost, cost_basis, first_lot_date
         FROM cached_positions"
    )?;
    let rows = stmt.query_map([], |row| Ok(CachedPosition {
        symbol: row.get(0)?,
        listing_exchange: row.get(1)?,
        quantity: row.get(2)?,
        avg_cost: row.get(3)?,
        cost_basis: row.get(4)?,
        first_lot_date: row.get(5)?,
    }))?;
    rows.collect()
}

pub fn get_cached_metrics(conn: &Connection) -> Result<Option<CachedMetrics>> {
    conn.query_row(
        "SELECT fills, realized_pnl, total_invested, active_positions, last_fill
         FROM cached_metrics LIMIT 1",
        [],
        |row| Ok(CachedMetrics {
            fills: row.get(0)?,
            realized_pnl: row.get(1)?,
            total_invested: row.get(2)?,
            active_positions: row.get(3)?,
            last_fill: row.get(4)?,
        }),
    ).optional()
}

pub fn clear_cache(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM cached_positions; DELETE FROM cached_metrics;")?;
    Ok(())
}

// ── Historical price bars ─────────────────────────────────────────────────────

pub fn save_historical_bars(conn: &Connection, symbol: &str, bars: &[HistBar]) -> Result<usize> {
    if bars.is_empty() { return Ok(0); }
    let tx = conn.unchecked_transaction()?;
    let mut count = 0usize;
    for bar in bars {
        let n = tx.execute(
            "INSERT OR IGNORE INTO historical_price_bars (symbol, date, open, high, low, close, volume)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![symbol.to_uppercase(), bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume],
        )?;
        count += n;
    }
    tx.commit()?;
    Ok(count)
}

pub fn get_historical_bars(conn: &Connection, symbol: &str, start: &str, end: &str) -> Result<Vec<BarData>> {
    let mut stmt = conn.prepare(
        "SELECT date, close FROM historical_price_bars
         WHERE symbol=?1 AND date>=?2 AND date<=?3 ORDER BY date"
    )?;
    let rows = stmt.query_map(params![symbol.to_uppercase(), start, end], |r| {
        Ok(BarData { date: r.get(0)?, close: r.get(1)? })
    })?;
    rows.collect()
}

pub fn get_oldest_bar_date(conn: &Connection, symbol: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT MIN(date) FROM historical_price_bars WHERE symbol=?1",
        params![symbol.to_uppercase()],
        |r| r.get(0),
    ).optional()
}

pub fn get_all_hist_bars_for_backfill(
    conn: &Connection,
    symbols: &[String],
    start: &str,
) -> Result<HashMap<String, HashMap<String, f64>>> {
    if symbols.is_empty() { return Ok(HashMap::new()); }
    let mut result: HashMap<String, HashMap<String, f64>> = HashMap::new();
    // Fetch per-symbol to avoid complex dynamic param binding
    for sym in symbols {
        let sym_upper = sym.to_uppercase();
        let mut stmt = conn.prepare(
            "SELECT date, close FROM historical_price_bars WHERE symbol=?1 AND date>=?2 ORDER BY date"
        )?;
        let bars: Vec<(String, f64)> = stmt.query_map(params![sym_upper, start], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
        })?.collect::<Result<_>>()?;
        let date_map: HashMap<String, f64> = bars.into_iter().collect();
        if !date_map.is_empty() {
            result.insert(sym_upper, date_map);
        }
    }
    Ok(result)
}

// ── Helper types ──────────────────────────────────────────────────────────────

pub struct PriceData {
    pub price: Option<f64>,
    pub prev_close: Option<f64>,
    pub day_high: Option<f64>,
    pub day_low: Option<f64>,
    pub volume: Option<f64>,
    pub market_cap: Option<f64>,
    pub name: Option<String>,
}

pub struct HistBar {
    pub date: String,
    pub open: Option<f64>,
    pub high: Option<f64>,
    pub low: Option<f64>,
    pub close: f64,
    pub volume: Option<f64>,
}

// ── Combined FIFO sync ────────────────────────────────────────────────────────

pub fn sync_cache_and_positions(conn: &Connection) -> Result<()> {
    let txns = get_all_transactions_sorted(conn)?;
    if txns.is_empty() { return Ok(()); }
    let fifo_result = fifo::compute(&txns);
    let ex_map = fifo::exchange_map(&txns);
    let fills = txns.len() as i64;
    let last_fill = txns.last().map(|t| t.dt.as_str());
    update_cache(conn, &fifo_result, fills, last_fill, &ex_map)?;
    if !fifo_result.positions.is_empty() {
        sync_positions_from_fifo(conn, &fifo_result)?;
    }
    Ok(())
}
