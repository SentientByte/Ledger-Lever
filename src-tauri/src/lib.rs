mod commands;
mod crud;
mod db;
mod fifo;
mod models;
mod scheduler;
mod yahoo;

use commands::AppState;
use rusqlite::Connection;
use tauri::Manager;
use std::sync::Arc;

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let conn = db::open().expect("Failed to open database");

            // Seed sample data on first launch (empty transactions table)
            let txn_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
                .unwrap_or(0);
            if txn_count == 0 {
                seed_sample(&conn);
            }

            let state = AppState::new(conn);
            let db_for_scheduler = Arc::clone(&state.db);
            app.manage(state);
            scheduler::start(db_for_scheduler);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_portfolio_summary,
            commands::get_positions,
            commands::add_position,
            commands::update_position,
            commands::delete_position,
            commands::get_portfolio_performance,
            commands::get_price_bars,
            commands::validate_symbol,
            commands::manual_refresh,
            commands::trigger_backfill,
            commands::get_transactions,
            commands::get_transaction_symbols,
            commands::get_derived_positions,
            commands::get_transaction_summary,
            commands::get_year_activity,
            commands::upload_transactions,
            commands::reset_transactions,
            commands::clear_transactions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ledger Lever");
}

fn seed_sample(conn: &Connection) {
    let sample: &[(&str, &str, f64, f64, f64)] = &[
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
    ];
    for (sym, dt, qty, price, comm) in sample {
        crud::create_transaction(conn, sym, None, dt, *qty, *price, *comm).ok();
    }
    crud::sync_cache_and_positions(conn).ok();
}
