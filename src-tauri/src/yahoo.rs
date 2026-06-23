use reqwest::blocking::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use log::{info, warn};
use crate::crud::{PriceData, HistBar};
use crate::models::SymbolInfo;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Exchange suffix map (matches Python version)
fn exchange_suffix(exchange: &str) -> &'static str {
    match exchange.to_uppercase().as_str() {
        "NYSE" | "NASDAQ" | "NASDAQ_CM" | "NASDAQ_GM" | "NASDAQ_GS"
        | "ARCA" | "BATS" | "AMEX" | "CBOE" | "IEX" => "",
        "LSE" | "LSEETF" => ".L",
        "TSX" | "TSE" => ".TO",
        "TSXV" | "CVE" => ".V",
        "XETRA" => ".DE",
        "FWB" => ".F",
        "ASX" => ".AX",
        "HKEX" | "HKG" => ".HK",
        "TSE_JP" => ".T",
        "EURONEXT" => ".PA",
        "AEX" => ".AS",
        "BRU" => ".BR",
        "SWX" => ".SW",
        "SGX" => ".SI",
        _ => "",
    }
}

pub fn yf_ticker(symbol: &str, exchange: Option<&str>) -> String {
    let sym = symbol.to_uppercase();
    match exchange {
        Some(ex) if !ex.is_empty() => format!("{}{}", sym, exchange_suffix(ex)),
        _ => sym,
    }
}

fn build_client() -> Client {
    Client::builder()
        .user_agent(UA)
        .cookie_store(true)
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default()
}

/// Fetch Yahoo Finance crumb (required since 2024 API changes).
/// Returns None if fetch fails — callers should proceed without crumb in that case.
pub fn fetch_crumb(client: &Client) -> Option<String> {
    // Warm up cookie store
    client.get("https://fc.yahoo.com").send().ok();
    std::thread::sleep(Duration::from_millis(500));
    let resp = client
        .get("https://query1.finance.yahoo.com/v1/test/getcrumb")
        .header("Accept", "text/plain")
        .send()
        .ok()?;
    if resp.status().is_success() {
        let crumb = resp.text().ok()?;
        let crumb = crumb.trim().to_string();
        if !crumb.is_empty() && crumb != "Unauthorized" {
            info!("Yahoo crumb obtained: {}", &crumb[..crumb.len().min(6)]);
            return Some(crumb);
        }
    }
    None
}

fn chart_url(ticker: &str, interval: &str, range: &str, crumb: Option<&str>) -> String {
    let base = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval={}&range={}",
        ticker, interval, range
    );
    match crumb {
        Some(c) if !c.is_empty() => format!("{}&crumb={}", base, c),
        _ => base,
    }
}

fn parse_meta(meta: &Value) -> PriceData {
    let price = meta["regularMarketPrice"].as_f64()
        .or_else(|| meta["regularMarketPreviousClose"].as_f64());
    let prev_close = meta["regularMarketPreviousClose"].as_f64()
        .or_else(|| meta["chartPreviousClose"].as_f64());
    PriceData {
        price,
        prev_close,
        day_high: meta["regularMarketDayHigh"].as_f64(),
        day_low: meta["regularMarketDayLow"].as_f64(),
        volume: meta["regularMarketVolume"].as_f64(),
        market_cap: meta["marketCap"].as_f64(),
        name: meta["longName"].as_str()
            .or_else(|| meta["shortName"].as_str())
            .map(|s| s.to_string()),
    }
}

pub fn get_current_prices(
    client: &Client,
    symbols: &[(String, Option<String>)], // (symbol, exchange)
    crumb: Option<&str>,
) -> HashMap<String, PriceData> {
    let mut result = HashMap::new();

    for (idx, (sym, exchange)) in symbols.iter().enumerate() {
        if idx > 0 {
            // Small jittered gap to stay polite to Yahoo while keeping a full
            // refresh comfortably under the 30s live-poll window.
            let delay_ms = 700 + rand::random::<u64>() % 700;
            std::thread::sleep(Duration::from_millis(delay_ms));
        }

        let ticker = yf_ticker(sym, exchange.as_deref());
        info!("Fetching price for {} (ticker={})", sym, ticker);

        let mut success = false;
        for attempt in 0..3u32 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_secs(10 * attempt as u64));
            }
            let url = chart_url(&ticker, "1d", "1d", crumb);
            match client.get(&url).header("Accept", "application/json").send() {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(json) = resp.json::<Value>() {
                        if let Some(meta) = json["chart"]["result"][0]["meta"].as_object() {
                            let data = parse_meta(&Value::Object(meta.clone()));
                            if data.price.is_some() {
                                result.insert(sym.to_uppercase(), data);
                                success = true;
                                break;
                            }
                        }
                    }
                }
                Ok(resp) if resp.status().as_u16() == 429 => {
                    warn!("Rate limited for {}, retrying...", sym);
                    continue;
                }
                Ok(resp) => {
                    warn!("HTTP {} for {}", resp.status(), sym);
                    break;
                }
                Err(e) => {
                    warn!("Request error for {}: {}", sym, e);
                    break;
                }
            }
        }
        if !success {
            warn!("Could not fetch price for {}", sym);
        }
    }
    result
}

pub fn get_historical_bars(
    client: &Client,
    symbol: &str,
    exchange: Option<&str>,
    start_date: &str,
    crumb: Option<&str>,
) -> Vec<HistBar> {
    let ticker = yf_ticker(symbol, exchange);
    let url = chart_url(&ticker, "1d", "max", crumb);

    let mut backoff = 5u64;
    for attempt in 0..4u32 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_secs(backoff));
            backoff *= 2;
        }
        match client.get(&url).header("Accept", "application/json").send() {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(json) = resp.json::<Value>() {
                    let result = &json["chart"]["result"][0];
                    if result.is_null() { break; }
                    let timestamps = result["timestamp"].as_array();
                    let quotes = &result["indicators"]["adjclose"][0]["adjclose"];
                    let opens = &result["indicators"]["quote"][0]["open"];
                    let highs = &result["indicators"]["quote"][0]["high"];
                    let lows = &result["indicators"]["quote"][0]["low"];
                    let volumes = &result["indicators"]["quote"][0]["volume"];

                    if let Some(ts_arr) = timestamps {
                        let mut bars = Vec::new();
                        for (i, ts) in ts_arr.iter().enumerate() {
                            let unix = ts.as_i64().unwrap_or(0);
                            let date = unix_to_date(unix);
                            if date.as_str() < start_date { continue; }
                            let close = quotes[i].as_f64()
                                .or_else(|| result["indicators"]["quote"][0]["close"][i].as_f64());
                            if let Some(close) = close {
                                bars.push(HistBar {
                                    date,
                                    open: opens[i].as_f64(),
                                    high: highs[i].as_f64(),
                                    low: lows[i].as_f64(),
                                    close,
                                    volume: volumes[i].as_f64(),
                                });
                            }
                        }
                        if !bars.is_empty() {
                            return bars;
                        }
                    }
                }
                break;
            }
            Ok(resp) if resp.status().as_u16() == 429 => {
                warn!("Rate limited fetching history for {}", symbol);
                continue;
            }
            Ok(resp) => {
                warn!("HTTP {} fetching history for {}", resp.status(), symbol);
                break;
            }
            Err(e) => {
                warn!("Request error fetching history for {}: {}", symbol, e);
                break;
            }
        }
    }
    vec![]
}

pub fn validate_symbol(client: &Client, symbol: &str, crumb: Option<&str>) -> Option<SymbolInfo> {
    let ticker = symbol.to_uppercase();
    let url = chart_url(&ticker, "1d", "1d", crumb);
    let resp = client.get(&url).header("Accept", "application/json").send().ok()?;
    if !resp.status().is_success() { return None; }
    let json: Value = resp.json().ok()?;
    let meta = &json["chart"]["result"][0]["meta"];
    if meta.is_null() { return None; }
    let price = meta["regularMarketPrice"].as_f64()
        .or_else(|| meta["regularMarketPreviousClose"].as_f64())?;
    let name = meta["longName"].as_str()
        .or_else(|| meta["shortName"].as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| ticker.clone());
    Some(SymbolInfo { symbol: ticker, name, price })
}

fn unix_to_date(unix: i64) -> String {
    // Simple Unix timestamp → YYYY-MM-DD conversion (UTC)
    let days = unix / 86400;
    // Reference: 1970-01-01 = day 0
    let mut y = 1970i64;
    let mut d = days;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if d < days_in_year { break; }
        d -= days_in_year;
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
