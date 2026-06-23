use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use log::{info, warn, error};
use reqwest::blocking::Client;
use rusqlite::Connection;
use crate::{crud, fifo, yahoo};

const REFRESH_INTERVAL_SECS: u64 = 300;
const BACKFILL_START_DAYS: i64 = 730;

pub fn start(db: Arc<Mutex<Connection>>) {
    let db_clone = Arc::clone(&db);
    std::thread::Builder::new()
        .name("price-scheduler".into())
        .spawn(move || {
            let client = build_client();
            let crumb = Arc::new(Mutex::new(yahoo::fetch_crumb(&client)));

            // Initial refresh + backfill on startup
            let crumb_val = crumb.lock().ok().and_then(|g| g.clone());
            refresh_prices_inner(&client, &db_clone, crumb_val.as_deref());

            let db2 = Arc::clone(&db_clone);
            let client2 = build_client();
            let crumb2 = crumb_val.clone();
            std::thread::Builder::new()
                .name("hist-backfill".into())
                .spawn(move || {
                    backfill_historical_data(&client2, &db2, crumb2.as_deref());
                })
                .ok();

            loop {
                std::thread::sleep(Duration::from_secs(REFRESH_INTERVAL_SECS));
                let mut crumb_guard = crumb.lock().unwrap();
                // Re-fetch crumb every hour (it can expire)
                if crumb_guard.is_none() {
                    *crumb_guard = yahoo::fetch_crumb(&client);
                }
                let crumb_val = crumb_guard.clone();
                drop(crumb_guard);
                refresh_prices_inner(&client, &db_clone, crumb_val.as_deref());
            }
        })
        .ok();
}

fn build_client() -> Client {
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .cookie_store(true)
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

pub fn refresh_prices_now(db: Arc<Mutex<Connection>>) {
    let client = build_client();
    let crumb = yahoo::fetch_crumb(&client);
    refresh_prices_inner(&client, &db, crumb.as_deref());
}

fn refresh_prices_inner(client: &Client, db: &Arc<Mutex<Connection>>, crumb: Option<&str>) {
    let (positions, cached_pos) = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => { error!("DB lock error: {}", e); return; }
        };
        let positions = crud::get_positions(&conn).unwrap_or_default();
        let cached_pos = crud::get_cached_positions(&conn).unwrap_or_default();
        (positions, cached_pos)
    };

    let pos_symbols: std::collections::HashSet<String> =
        positions.iter().map(|p| p.symbol.to_uppercase()).collect();
    let cached_symbols: std::collections::HashSet<String> =
        cached_pos.iter().map(|c| c.symbol.to_uppercase()).collect();
    let exchange_map: HashMap<String, String> = cached_pos.iter()
        .filter_map(|c| c.listing_exchange.as_ref().map(|e| (c.symbol.to_uppercase(), e.to_uppercase())))
        .collect();

    let all_symbols: Vec<String> = pos_symbols.union(&cached_symbols).cloned().collect();
    if all_symbols.is_empty() {
        info!("Scheduler: no symbols to refresh");
        return;
    }

    info!("Scheduler: refreshing {} symbols", all_symbols.len());
    let sym_pairs: Vec<(String, Option<String>)> = all_symbols.iter()
        .map(|s| (s.clone(), exchange_map.get(s).cloned()))
        .collect();

    let prices = yahoo::get_current_prices(client, &sym_pairs, crumb);

    let mut names_to_update = HashMap::new();
    {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => { error!("DB lock error saving prices: {}", e); return; }
        };
        for (sym, data) in &prices {
            if data.price.is_some() {
                if let Err(e) = crud::save_price_snapshot(&conn, sym, data) {
                    warn!("Failed to save price snapshot for {}: {}", sym, e);
                }
            }
            if let Some(name) = &data.name {
                if !name.is_empty() && name != sym {
                    names_to_update.insert(sym.clone(), name.clone());
                }
            }
        }
        if !names_to_update.is_empty() {
            crud::update_position_names(&conn, &names_to_update).ok();
        }

        // Portfolio snapshot
        let all_syms: Vec<String> = all_symbols.clone();
        if let Ok(latest) = crud::get_latest_prices(&conn, &all_syms) {
            let mut total_value = 0.0f64;
            let mut total_cost = 0.0f64;
            let mut day_gain = 0.0f64;
            for pos in &positions {
                let sym = pos.symbol.to_uppercase();
                let cost = pos.shares * pos.avg_cost;
                total_cost += cost;
                if let Some(snap) = latest.get(&sym) {
                    if let Some(price) = snap.price {
                        total_value += pos.shares * price;
                        if let Some(prev) = snap.prev_close {
                            day_gain += pos.shares * (price - prev);
                        }
                    }
                }
            }
            if total_value > 0.0 {
                crud::save_portfolio_snapshot(&conn, total_value, total_cost, day_gain).ok();
                info!("Scheduler: portfolio value = ${:.2}", total_value);
            }
        }
    }
}

pub fn backfill_historical_data(client: &Client, db: &Arc<Mutex<Connection>>, crumb: Option<&str>) {
    let (txns, positions) = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => { error!("Backfill: DB lock error: {}", e); return; }
        };
        let txns = crud::get_all_transactions_sorted(&conn).unwrap_or_default();
        let positions = crud::get_positions(&conn).unwrap_or_default();
        (txns, positions)
    };

    let mut all_symbols: std::collections::HashSet<String> = std::collections::HashSet::new();
    for t in &txns { all_symbols.insert(t.symbol.to_uppercase()); }
    for p in &positions { all_symbols.insert(p.symbol.to_uppercase()); }
    if all_symbols.is_empty() {
        info!("Backfill: no symbols");
        return;
    }

    let ex_map = fifo::exchange_map(&txns);
    let start_date = days_ago_date(BACKFILL_START_DAYS);
    let today = today_date();

    // Step 1: fetch missing historical bars
    for symbol in &all_symbols {
        let oldest = {
            let conn = db.lock().unwrap();
            crud::get_oldest_bar_date(&conn, symbol).unwrap_or(None)
        };
        let needs_fetch = match &oldest {
            None => true,
            Some(d) => d.as_str() > days_ago_date(BACKFILL_START_DAYS - 7).as_str(),
        };
        if needs_fetch {
            info!("Backfill: fetching history for {} (oldest={:?})", symbol, oldest);
            let bars = yahoo::get_historical_bars(
                client, symbol,
                ex_map.get(symbol).map(|s| s.as_str()),
                &start_date,
                crumb,
            );
            if !bars.is_empty() {
                let conn = db.lock().unwrap();
                let n = crud::save_historical_bars(&conn, symbol, &bars).unwrap_or(0);
                info!("Backfill: stored {} bars for {}", n, symbol);
            } else {
                warn!("Backfill: no bars for {}", symbol);
            }
            // Rate limit between symbols
            let delay_ms = 4000 + rand::random::<u64>() % 4000;
            std::thread::sleep(Duration::from_millis(delay_ms));
        }
    }

    // Step 2: reconstruct daily portfolio values
    let all_sym_vec: Vec<String> = all_symbols.into_iter().collect();
    let (all_hist, existing_dates) = {
        let conn = db.lock().unwrap();
        let hist = crud::get_all_hist_bars_for_backfill(&conn, &all_sym_vec, &start_date)
            .unwrap_or_default();
        let dates = crud::get_existing_snapshot_dates(&conn, &start_date)
            .unwrap_or_default();
        (hist, dates)
    };

    // Union of all trading dates
    let mut trading_dates: Vec<String> = all_hist.values()
        .flat_map(|m| m.keys().cloned())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    trading_dates.sort();

    if trading_dates.is_empty() {
        info!("Backfill: no trading dates, skipping snapshot generation");
        return;
    }

    let mut snapshots: Vec<(f64, f64, f64, String)> = Vec::new();

    if !txns.is_empty() {
        // FIFO single-pass replay
        let mut lots: HashMap<String, std::collections::VecDeque<(f64, f64)>> = HashMap::new();
        let mut txn_idx = 0usize;

        for trade_date in &trading_dates {
            while txn_idx < txns.len() && txns[txn_idx].dt.get(..10).unwrap_or("") <= trade_date.as_str() {
                let t = &txns[txn_idx];
                let sym = t.symbol.to_uppercase();
                if t.quantity > 0.0 {
                    lots.entry(sym).or_default().push_back((t.quantity, t.price));
                } else {
                    let mut remaining = t.quantity.abs();
                    if let Some(q) = lots.get_mut(&sym) {
                        while remaining > 1e-9 {
                            if let Some(front) = q.front_mut() {
                                if front.0 <= remaining + 1e-9 {
                                    remaining -= front.0;
                                    q.pop_front();
                                } else {
                                    front.0 -= remaining;
                                    remaining = 0.0;
                                }
                            } else { break; }
                        }
                    }
                }
                txn_idx += 1;
            }

            if existing_dates.contains(trade_date.as_str()) { continue; }

            let mut total_value = 0.0f64;
            let mut total_cost = 0.0f64;
            let mut has_price = false;
            for (sym, queue) in &lots {
                if queue.is_empty() { continue; }
                let qty: f64 = queue.iter().map(|(q, _)| q).sum();
                let cost: f64 = queue.iter().map(|(q, p)| q * p).sum();
                total_cost += cost;
                if let Some(price) = all_hist.get(sym).and_then(|d| d.get(trade_date.as_str())) {
                    total_value += qty * price;
                    has_price = true;
                }
            }
            if has_price && total_value > 0.0 {
                let ts = format!("{} 16:00:00", trade_date);
                snapshots.push((round2(total_value), round2(total_cost), 0.0, ts));
            }
        }
    } else {
        // No transactions — use current positions
        for trade_date in &trading_dates {
            if existing_dates.contains(trade_date.as_str()) { continue; }
            let mut total_value = 0.0f64;
            let mut total_cost = 0.0f64;
            let mut has_price = false;
            for p in &positions {
                let sym = p.symbol.to_uppercase();
                total_cost += p.shares * p.avg_cost;
                if let Some(price) = all_hist.get(&sym).and_then(|d| d.get(trade_date.as_str())) {
                    total_value += p.shares * price;
                    has_price = true;
                }
            }
            if has_price && total_value > 0.0 {
                let ts = format!("{} 16:00:00", trade_date);
                snapshots.push((round2(total_value), round2(total_cost), 0.0, ts));
            }
        }
    }

    if !snapshots.is_empty() {
        let conn = db.lock().unwrap();
        crud::bulk_save_portfolio_snapshots(&conn, &snapshots).ok();
        info!("Backfill: inserted {} portfolio snapshots", snapshots.len());
    } else {
        info!("Backfill: no new snapshots needed");
    }
}

fn days_ago_date(days: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let past = now - days * 86400;
    unix_to_date(past)
}

fn today_date() -> String {
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
    let month_days: [i64; 12] = if is_leap(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if d < md { m = i + 1; break; }
        d -= md;
    }
    format!("{:04}-{:02}-{:02}", y, m, d + 1)
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn round2(v: f64) -> f64 { (v * 100.0).round() / 100.0 }
