use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: i64,
    pub symbol: String,
    pub name: Option<String>,
    pub shares: f64,
    pub avg_cost: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionResponse {
    pub id: i64,
    pub symbol: String,
    pub name: Option<String>,
    pub shares: f64,
    pub avg_cost: f64,
    pub current_price: Option<f64>,
    pub prev_close: Option<f64>,
    pub market_value: Option<f64>,
    pub cost_basis: f64,
    pub total_gain: Option<f64>,
    pub total_gain_pct: Option<f64>,
    pub day_gain: Option<f64>,
    pub day_gain_pct: Option<f64>,
    pub day_high: Option<f64>,
    pub day_low: Option<f64>,
    pub volume: Option<f64>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PositionCreate {
    pub symbol: String,
    pub shares: f64,
    pub avg_cost: f64,
}

#[derive(Debug, Deserialize)]
pub struct PositionUpdate {
    pub shares: Option<f64>,
    pub avg_cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceSnapshot {
    pub symbol: String,
    pub price: Option<f64>,
    pub prev_close: Option<f64>,
    pub day_high: Option<f64>,
    pub day_low: Option<f64>,
    pub volume: Option<f64>,
    pub market_cap: Option<f64>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioSummary {
    pub total_value: f64,
    pub total_cost: f64,
    pub total_gain: f64,
    pub total_gain_pct: f64,
    pub day_gain: f64,
    pub day_gain_pct: f64,
    pub positions_count: i64,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformancePoint {
    pub timestamp: String,
    pub total_value: f64,
    pub total_cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: i64,
    pub symbol: String,
    pub listing_exchange: Option<String>,
    pub dt: String,
    pub quantity: f64,
    pub price: f64,
    pub commission: f64,
    pub side: String,
    pub notional: f64,
    pub net: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionPage {
    pub items: Vec<Transaction>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedPosition {
    pub symbol: String,
    pub listing_exchange: Option<String>,
    pub quantity: f64,
    pub avg_cost: f64,
    pub cost_basis: f64,
    pub first_lot_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedMetrics {
    pub fills: i64,
    pub realized_pnl: f64,
    pub total_invested: f64,
    pub active_positions: i64,
    pub last_fill: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerivedPosition {
    pub symbol: String,
    pub quantity: f64,
    pub avg_cost: f64,
    pub cost_basis: f64,
    pub current_price: Option<f64>,
    pub market_value: Option<f64>,
    pub unrealized: Option<f64>,
    pub unrealized_pct: Option<f64>,
    pub weight_pct: Option<f64>,
    pub first_lot_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionSummary {
    pub fills: i64,
    pub invested: f64,
    pub realized: f64,
    pub unrealized: Option<f64>,
    pub active_positions: i64,
    pub last_fill: Option<String>,
    pub filename: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionUploadResult {
    pub added: i64,
    pub duplicates: i64,
    pub errors: i64,
    pub total_rows: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YearActivity {
    pub year: i64,
    pub notional: f64,
    pub buys: i64,
    pub sells: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BarData {
    pub date: String,
    pub close: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInfo {
    pub symbol: String,
    pub name: String,
    pub price: f64,
}

/// Raw transaction row used internally by FIFO and scheduler.
#[derive(Debug, Clone)]
pub struct TxnRow {
    pub symbol: String,
    pub listing_exchange: Option<String>,
    pub dt: String,
    pub quantity: f64,
    pub price: f64,
    pub commission: f64,
    pub side: String,
}
