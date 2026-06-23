use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use reqwest::blocking::Client;
use rusqlite::Connection;
use crate::{crud, fifo, yahoo, scheduler};
use crate::models::*;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub http_client: Client,
    pub crumb: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap_or_default();
        let crumb = yahoo::fetch_crumb(&client);
        AppState {
            db: Arc::new(Mutex::new(conn)),
            http_client: client,
            crumb: Mutex::new(crumb),
        }
    }

    fn get_crumb(&self) -> Option<String> {
        self.crumb.lock().ok().and_then(|g| g.clone())
    }
}

fn db_err(e: impl std::fmt::Display) -> String {
    format!("Database error: {}", e)
}

// ── Portfolio summary ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_portfolio_summary(state: tauri::State<'_, AppState>) -> Result<PortfolioSummary, String> {
    let conn = state.db.lock().map_err(db_err)?;
    let positions = crud::get_positions(&conn).map_err(db_err)?;
    if positions.is_empty() {
        return Ok(PortfolioSummary {
            total_value: 0.0, total_cost: 0.0, total_gain: 0.0,
            total_gain_pct: 0.0, day_gain: 0.0, day_gain_pct: 0.0,
            positions_count: 0, last_updated: None,
        });
    }
    let symbols: Vec<String> = positions.iter().map(|p| p.symbol.to_uppercase()).collect();
    let latest = crud::get_latest_prices(&conn, &symbols).map_err(db_err)?;

    let mut total_value = 0.0f64;
    let mut total_cost = 0.0f64;
    let mut day_gain = 0.0f64;
    let mut last_updated: Option<String> = None;

    for pos in &positions {
        let sym = pos.symbol.to_uppercase();
        total_cost += pos.shares * pos.avg_cost;
        if let Some(snap) = latest.get(&sym) {
            if let Some(price) = snap.price {
                total_value += pos.shares * price;
                if let Some(prev) = snap.prev_close {
                    day_gain += pos.shares * (price - prev);
                }
                match &last_updated {
                    None => last_updated = Some(snap.timestamp.clone()),
                    Some(t) if &snap.timestamp > t => last_updated = Some(snap.timestamp.clone()),
                    _ => {}
                }
            }
        }
    }

    let total_gain = total_value - total_cost;
    let total_gain_pct = if total_cost > 0.0 { total_gain / total_cost * 100.0 } else { 0.0 };
    let prev_total = total_value - day_gain;
    let day_gain_pct = if prev_total > 0.0 { day_gain / prev_total * 100.0 } else { 0.0 };

    Ok(PortfolioSummary {
        total_value: r2(total_value),
        total_cost: r2(total_cost),
        total_gain: r2(total_gain),
        total_gain_pct: r2(total_gain_pct),
        day_gain: r2(day_gain),
        day_gain_pct: r2(day_gain_pct),
        positions_count: positions.len() as i64,
        last_updated,
    })
}

// ── Positions ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_positions(state: tauri::State<'_, AppState>) -> Result<Vec<PositionResponse>, String> {
    let conn = state.db.lock().map_err(db_err)?;
    enrich_positions(&conn)
}

fn enrich_positions(conn: &Connection) -> Result<Vec<PositionResponse>, String> {
    let positions = crud::get_positions(conn).map_err(db_err)?;
    if positions.is_empty() { return Ok(vec![]); }
    let symbols: Vec<String> = positions.iter().map(|p| p.symbol.to_uppercase()).collect();
    let latest = crud::get_latest_prices(conn, &symbols).map_err(db_err)?;

    let mut result = Vec::new();
    for pos in positions {
        let sym = pos.symbol.to_uppercase();
        let snap = latest.get(&sym);
        let price = snap.and_then(|s| s.price);
        let prev_close = snap.and_then(|s| s.prev_close);
        let cost = pos.shares * pos.avg_cost;
        let mv = price.map(|p| pos.shares * p);
        let total_gain = mv.map(|m| m - cost);
        let total_gain_pct = total_gain.map(|g| if cost > 0.0 { g / cost * 100.0 } else { 0.0 });
        let day_gain = price.zip(prev_close).map(|(p, pc)| pos.shares * (p - pc));
        let day_gain_pct = price.zip(prev_close).map(|(p, pc)| if pc > 0.0 { (p - pc) / pc * 100.0 } else { 0.0 });

        result.push(PositionResponse {
            id: pos.id,
            symbol: pos.symbol,
            name: pos.name,
            shares: pos.shares,
            avg_cost: pos.avg_cost,
            current_price: price.map(r4),
            prev_close: prev_close.map(r4),
            market_value: mv.map(r2),
            cost_basis: r2(cost),
            total_gain: total_gain.map(r2),
            total_gain_pct: total_gain_pct.map(r2),
            day_gain: day_gain.map(r2),
            day_gain_pct: day_gain_pct.map(r2),
            day_high: snap.and_then(|s| s.day_high).map(r4),
            day_low: snap.and_then(|s| s.day_low).map(r4),
            volume: snap.and_then(|s| s.volume),
            created_at: pos.created_at,
        });
    }
    Ok(result)
}

#[tauri::command]
pub fn add_position(
    symbol: String,
    shares: f64,
    avg_cost: f64,  // frontend sends as avgCost, Tauri converts snake_case
    state: tauri::State<'_, AppState>,
) -> Result<PositionResponse, String> {
    let crumb = state.get_crumb();
    let info = yahoo::validate_symbol(&state.http_client, &symbol, crumb.as_deref())
        .ok_or_else(|| format!("Unknown symbol: {}", symbol))?;

    let conn = state.db.lock().map_err(db_err)?;
    let id = crud::create_position(&conn, &symbol, Some(&info.name), shares, avg_cost).map_err(db_err)?;

    // Save live price snapshot immediately
    let price_data = crud::PriceData {
        price: Some(info.price),
        prev_close: None,
        day_high: None,
        day_low: None,
        volume: None,
        market_cap: None,
        name: Some(info.name),
    };
    crud::save_price_snapshot(&conn, &symbol.to_uppercase(), &price_data).ok();

    let enriched = enrich_positions(&conn)?;
    enriched.into_iter().find(|p| p.id == id)
        .ok_or_else(|| "Position created but not found".to_string())
}

#[tauri::command]
pub fn update_position(
    id: i64,
    shares: Option<f64>,
    avg_cost: Option<f64>,
    state: tauri::State<'_, AppState>,
) -> Result<PositionResponse, String> {
    let conn = state.db.lock().map_err(db_err)?;
    let found = crud::update_position(&conn, id, shares, avg_cost).map_err(db_err)?;
    if !found {
        return Err(format!("Position {} not found", id));
    }
    let enriched = enrich_positions(&conn)?;
    enriched.into_iter().find(|p| p.id == id)
        .ok_or_else(|| "Position not found after update".to_string())
}

#[tauri::command]
pub fn delete_position(id: i64, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(db_err)?;
    let deleted = crud::delete_position(&conn, id).map_err(db_err)?;
    if !deleted {
        return Err(format!("Position {} not found", id));
    }
    Ok(())
}

// ── Performance ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_portfolio_performance(days: i64, state: tauri::State<'_, AppState>) -> Result<Vec<PerformancePoint>, String> {
    let conn = state.db.lock().map_err(db_err)?;
    crud::get_portfolio_performance(&conn, days).map_err(db_err)
}

// ── Price bars ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_price_bars(
    symbols: Vec<String>,
    period: String,
    state: tauri::State<'_, AppState>,
) -> Result<HashMap<String, Vec<BarData>>, String> {
    let days = period_to_days(&period);
    let start = days_ago_str(days);
    let end = today_str();
    let conn = state.db.lock().map_err(db_err)?;
    let crumb = state.get_crumb();

    let mut result = HashMap::new();
    for sym in &symbols {
        let bars = crud::get_historical_bars(&conn, sym, &start, &end).map_err(db_err)?;
        if bars.is_empty() {
            // Fetch on demand and cache
            let raw = yahoo::get_historical_bars(
                &state.http_client, sym, None, &start, crumb.as_deref()
            );
            if !raw.is_empty() {
                crud::save_historical_bars(&conn, sym, &raw).ok();
                let cached = crud::get_historical_bars(&conn, sym, &start, &end).map_err(db_err)?;
                result.insert(sym.to_uppercase(), cached);
            } else {
                result.insert(sym.to_uppercase(), vec![]);
            }
        } else {
            result.insert(sym.to_uppercase(), bars);
        }
    }
    Ok(result)
}

// ── Symbol validation ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn validate_symbol(symbol: String, state: tauri::State<'_, AppState>) -> Result<SymbolInfo, String> {
    let crumb = state.get_crumb();
    yahoo::validate_symbol(&state.http_client, &symbol, crumb.as_deref())
        .ok_or_else(|| format!("Symbol not found: {}", symbol))
}

// ── Manual refresh & backfill ─────────────────────────────────────────────────

#[tauri::command]
pub fn manual_refresh(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    std::thread::Builder::new()
        .name("manual-refresh".into())
        .spawn(move || scheduler::refresh_prices_now(db))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn trigger_backfill(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    std::thread::Builder::new()
        .name("manual-backfill".into())
        .spawn(move || {
            let client = Client::builder()
                .user_agent("Mozilla/5.0")
                .cookie_store(true)
                .build()
                .unwrap_or_default();
            let crumb = yahoo::fetch_crumb(&client);
            scheduler::backfill_historical_data(&client, &db, crumb.as_deref());
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Transactions ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_transactions(
    symbol: Option<String>,
    side: Option<String>,
    page: i64,
    page_size: i64,
    state: tauri::State<'_, AppState>,
) -> Result<TransactionPage, String> {
    let conn = state.db.lock().map_err(db_err)?;
    let (items, total) = crud::get_transactions(
        &conn,
        symbol.as_deref(),
        side.as_deref(),
        page,
        page_size,
    ).map_err(db_err)?;
    Ok(TransactionPage { items, total, page, page_size })
}

#[tauri::command]
pub fn get_transaction_symbols(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(db_err)?;
    crud::get_transaction_symbols(&conn).map_err(db_err)
}

#[tauri::command]
pub fn get_derived_positions(state: tauri::State<'_, AppState>) -> Result<Vec<DerivedPosition>, String> {
    let conn = state.db.lock().map_err(db_err)?;
    let mut cached = crud::get_cached_positions(&conn).map_err(db_err)?;
    if cached.is_empty() {
        let txns = crud::get_all_transactions_sorted(&conn).map_err(db_err)?;
        if txns.is_empty() { return Ok(vec![]); }
        crud::sync_cache_and_positions(&conn).map_err(db_err)?;
        cached = crud::get_cached_positions(&conn).map_err(db_err)?;
        if cached.is_empty() { return Ok(vec![]); }
    }
    let symbols: Vec<String> = cached.iter().map(|c| c.symbol.clone()).collect();
    let latest = crud::get_latest_prices(&conn, &symbols).map_err(db_err)?;
    let total_mv: f64 = cached.iter()
        .filter_map(|c| latest.get(&c.symbol).and_then(|s| s.price).map(|p| c.quantity * p))
        .sum();

    let mut result: Vec<DerivedPosition> = cached.iter().map(|cp| {
        let snap = latest.get(&cp.symbol);
        let price = snap.and_then(|s| s.price);
        let mv = price.map(|p| cp.quantity * p);
        let unreal = mv.map(|m| m - cp.cost_basis);
        let unreal_pct = unreal.map(|u| if cp.cost_basis > 0.0 { u / cp.cost_basis * 100.0 } else { 0.0 });
        let wt = mv.map(|m| if total_mv > 0.0 { m / total_mv * 100.0 } else { 0.0 });
        DerivedPosition {
            symbol: cp.symbol.clone(),
            quantity: cp.quantity,
            avg_cost: cp.avg_cost,
            cost_basis: cp.cost_basis,
            current_price: price.map(r4),
            market_value: mv.map(r2),
            unrealized: unreal.map(r2),
            unrealized_pct: unreal_pct.map(r2),
            weight_pct: wt.map(|w| r1(w)),
            first_lot_date: cp.first_lot_date.clone(),
        }
    }).collect();
    result.sort_by(|a, b| b.cost_basis.partial_cmp(&a.cost_basis).unwrap_or(std::cmp::Ordering::Equal));
    Ok(result)
}

#[tauri::command]
pub fn get_transaction_summary(state: tauri::State<'_, AppState>) -> Result<TransactionSummary, String> {
    let conn = state.db.lock().map_err(db_err)?;
    let mut metrics = crud::get_cached_metrics(&conn).map_err(db_err)?;
    if metrics.as_ref().map(|m| m.fills == 0).unwrap_or(true) {
        let txns = crud::get_all_transactions_sorted(&conn).map_err(db_err)?;
        if txns.is_empty() {
            return Ok(TransactionSummary {
                fills: 0, invested: 0.0, realized: 0.0,
                unrealized: None, active_positions: 0, last_fill: None, filename: None,
            });
        }
        crud::sync_cache_and_positions(&conn).map_err(db_err)?;
        metrics = crud::get_cached_metrics(&conn).map_err(db_err)?;
    }
    let Some(m) = metrics else {
        return Ok(TransactionSummary {
            fills: 0, invested: 0.0, realized: 0.0,
            unrealized: None, active_positions: 0, last_fill: None, filename: None,
        });
    };
    let cached = crud::get_cached_positions(&conn).map_err(db_err)?;
    let symbols: Vec<String> = cached.iter().map(|c| c.symbol.clone()).collect();
    let latest = crud::get_latest_prices(&conn, &symbols).map_err(db_err)?;
    let unrealized: Option<f64> = if cached.is_empty() {
        None
    } else {
        Some(cached.iter().filter_map(|cp| {
            latest.get(&cp.symbol).and_then(|s| s.price)
                .map(|p| cp.quantity * p - cp.cost_basis)
        }).sum())
    };
    Ok(TransactionSummary {
        fills: m.fills,
        invested: r2(m.total_invested),
        realized: r2(m.realized_pnl),
        unrealized: unrealized.map(r2),
        active_positions: m.active_positions,
        last_fill: m.last_fill,
        filename: None,
    })
}

#[tauri::command]
pub fn get_year_activity(state: tauri::State<'_, AppState>) -> Result<Vec<YearActivity>, String> {
    let conn = state.db.lock().map_err(db_err)?;
    let txns = crud::get_all_transactions_sorted(&conn).map_err(db_err)?;
    Ok(crud::get_year_activity(&txns))
}

#[tauri::command]
pub fn upload_transactions(
    csv_content: String,
    state: tauri::State<'_, AppState>,
) -> Result<TransactionUploadResult, String> {
    let conn = state.db.lock().map_err(db_err)?;

    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(csv_content.as_bytes());

    // Normalize headers
    {
        let headers = rdr.headers().map_err(|e| e.to_string())?.clone();
        let normalized: Vec<String> = headers.iter()
            .map(|h| h.trim().to_lowercase().replace('/', "_").replace(' ', "_"))
            .collect();
        rdr.set_headers(csv::StringRecord::from(normalized));
    }

    let date_formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y",
    ];

    let mut added = 0i64;
    let mut duplicates = 0i64;
    let mut errors = 0i64;
    let mut total = 0i64;

    for result in rdr.deserialize::<HashMap<String, String>>() {
        total += 1;
        let row = match result {
            Ok(r) => r,
            Err(e) => { log::warn!("CSV parse error row {}: {}", total, e); errors += 1; continue; }
        };

        let sym = row.get("symbol").map(|s| s.trim().to_uppercase()).unwrap_or_default();
        let dt_raw = row.get("date_time").or_else(|| row.get("date")).map(|s| s.trim().to_string()).unwrap_or_default();
        let qty_raw = row.get("quantity").map(|s| s.trim().to_string()).unwrap_or_default();
        let price_raw = row.get("price").map(|s| s.trim().to_string()).unwrap_or_default();
        let commission_raw = row.get("commission").map(|s| s.trim().to_string()).unwrap_or_default();
        let listing_exchange = row.get("listing_exchange")
            .or_else(|| row.get("listingexchange"))
            .or_else(|| row.get("listingexch"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if sym.is_empty() || dt_raw.is_empty() { errors += 1; continue; }

        let qty: f64 = match qty_raw.parse() {
            Ok(v) => v,
            Err(_) => { errors += 1; continue; }
        };
        let price: f64 = match price_raw.parse() {
            Ok(v) => v,
            Err(_) => { errors += 1; continue; }
        };
        let commission: f64 = commission_raw.parse().unwrap_or(0.0);

        if qty == 0.0 || price <= 0.0 { errors += 1; continue; }

        let dt = date_formats.iter().find_map(|fmt| {
            chrono::NaiveDateTime::parse_from_str(&dt_raw, fmt).ok()
                .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
                .or_else(|| chrono::NaiveDate::parse_from_str(&dt_raw, fmt).ok()
                    .map(|d| format!("{} 09:30:00", d.format("%Y-%m-%d"))))
        });

        let dt = match dt {
            Some(d) => d,
            None => { errors += 1; continue; }
        };

        match crud::create_transaction(
            &conn, &sym, listing_exchange.as_deref(), &dt, qty, price, commission
        ) {
            Ok(true) => added += 1,
            Ok(false) => duplicates += 1,
            Err(e) => { log::warn!("DB insert error: {}", e); errors += 1; }
        }
    }

    if added > 0 {
        crud::sync_cache_and_positions(&conn).map_err(db_err)?;
    }

    Ok(TransactionUploadResult { added, duplicates, errors, total_rows: total })
}

#[tauri::command]
pub fn reset_transactions(state: tauri::State<'_, AppState>) -> Result<TransactionUploadResult, String> {
    let conn = state.db.lock().map_err(db_err)?;
    crud::delete_all_transactions(&conn).map_err(db_err)?;
    crud::clear_cache(&conn).map_err(db_err)?;

    let sample = sample_transactions();
    let mut added = 0i64;
    for (sym, dt, qty, price, commission) in &sample {
        if crud::create_transaction(&conn, sym, None, dt, *qty, *price, *commission).map_err(db_err)? {
            added += 1;
        }
    }
    crud::sync_cache_and_positions(&conn).map_err(db_err)?;

    // Trigger backfill in background
    let db2 = Arc::clone(&state.db);
    std::thread::Builder::new().name("backfill-reset".into()).spawn(move || {
        let client = Client::builder().user_agent("Mozilla/5.0").cookie_store(true).build().unwrap_or_default();
        let crumb = yahoo::fetch_crumb(&client);
        scheduler::backfill_historical_data(&client, &db2, crumb.as_deref());
    }).ok();

    Ok(TransactionUploadResult { added, duplicates: 0, errors: 0, total_rows: sample.len() as i64 })
}

#[tauri::command]
pub fn clear_transactions(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(db_err)?;
    crud::delete_all_transactions(&conn).map_err(db_err)?;
    crud::clear_cache(&conn).map_err(db_err)?;
    conn.execute_batch("DELETE FROM positions").map_err(db_err)?;
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn r1(v: f64) -> f64 { (v * 10.0).round() / 10.0 }
fn r2(v: f64) -> f64 { (v * 100.0).round() / 100.0 }
fn r4(v: f64) -> f64 { (v * 10_000.0).round() / 10_000.0 }

fn period_to_days(period: &str) -> i64 {
    if period.ends_with('y') {
        period.trim_end_matches('y').parse::<i64>().unwrap_or(2) * 365
    } else if period.ends_with("mo") {
        period.trim_end_matches("mo").parse::<i64>().unwrap_or(3) * 30
    } else {
        730
    }
}

fn days_ago_str(days: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    unix_to_date(now - days * 86400)
}

fn today_str() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    unix_to_date(now)
}

fn unix_to_date(unix: i64) -> String {
    let days = unix / 86400;
    let mut y = 1970i64;
    let mut d = days;
    loop {
        let diy = if is_leap(y) { 366 } else { 365 };
        if d < diy { break; }
        d -= diy;
        y += 1;
    }
    let md: [i64; 12] = if is_leap(y) {
        [31,29,31,30,31,30,31,31,30,31,30,31]
    } else {
        [31,28,31,30,31,30,31,31,30,31,30,31]
    };
    let mut m = 0usize;
    for (i, &days_m) in md.iter().enumerate() {
        if d < days_m { m = i + 1; break; }
        d -= days_m;
    }
    format!("{:04}-{:02}-{:02}", y, m, d + 1)
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn sample_transactions() -> Vec<(&'static str, &'static str, f64, f64, f64)> {
    vec![
        ("VTI",  "2017-03-14 09:30:00",  200.0,  125.00, 1.0),
        ("VTI",  "2018-06-20 10:15:00",  150.0,  144.20, 1.0),
        ("VTI",  "2019-11-08 11:00:00",  140.0,  203.00, 1.0),
        ("BND",  "2019-05-30 10:00:00",  600.0,   78.60, 1.0),
        ("BND",  "2022-09-12 09:15:00",  620.0,   71.25, 1.0),
        ("BND",  "2026-02-19 14:18:32",  420.0,   74.10, 1.0),
        ("IXUS", "2020-09-11 11:00:00",  800.0,   59.28, 1.0),
        ("IXUS", "2023-06-05 09:30:00",  220.0,   63.90, 1.0),
        ("IXUS", "2025-04-30 11:00:01",  250.0,   67.20, 1.0),
        ("IEF",  "2021-02-04 10:30:00",  200.0,  124.00, 1.0),
        ("IEF",  "2022-04-20 11:15:00",  220.0,  109.11, 1.0),
        ("IEF",  "2025-03-12 10:14:22",  340.0,   84.10, 1.0),
        ("USMV", "2021-07-29 09:45:00",  250.0,   76.00, 1.0),
        ("USMV", "2022-12-08 10:00:00",  180.0,   72.40, 1.0),
        ("USMV", "2025-08-25 10:08:14",  120.0,   86.10, 1.0),
        ("USMV", "2026-03-04 11:42:17",   40.0,   90.40, 1.0),
        ("SCHP", "2022-06-09 09:30:00",  510.0,   54.80, 1.0),
        ("SCHP", "2025-06-18 09:45:30",  360.0,   48.40, 1.0),
        ("IEMG", "2022-01-18 10:00:00",  400.0,   62.40, 1.0),
        ("IEMG", "2023-08-14 09:45:00",  340.0,   56.34, 1.0),
        ("IEMG", "2025-10-02 13:31:09", -200.0,   55.40, 1.0),
        ("IAU",  "2022-10-04 10:00:00",  300.0,   33.10, 1.0),
        ("IAU",  "2024-09-23 11:28:00",  180.0,   46.20, 1.0),
        ("SGOV", "2025-11-14 09:51:48",  165.0,  100.20, 0.0),
        ("VTI",  "2025-01-06 09:35:50",   90.0,  278.40, 1.0),
        ("VTI",  "2026-01-05 10:00:00",   60.0,  310.20, 1.0),
        ("VTI",  "2026-04-12 09:33:08",   32.0,  316.10, 1.0),
    ]
}
