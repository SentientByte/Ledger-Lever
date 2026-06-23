use std::collections::{HashMap, VecDeque};
use crate::models::TxnRow;

pub struct FifoPosition {
    pub symbol: String,
    pub quantity: f64,
    pub avg_cost: f64,
    pub cost_basis: f64,
    pub first_lot_date: Option<String>,
}

pub struct FifoResult {
    pub positions: HashMap<String, FifoPosition>,
    pub realized_pnl: f64,
    pub total_invested: f64,
}

/// Single-pass FIFO replay. Transactions must be sorted by dt ascending.
pub fn compute(transactions: &[TxnRow]) -> FifoResult {
    // lots[sym] = VecDeque of (qty, price)
    let mut lots: HashMap<String, VecDeque<(f64, f64)>> = HashMap::new();
    let mut first_dates: HashMap<String, String> = HashMap::new();
    let mut realized_pnl = 0.0f64;
    let mut total_invested = 0.0f64;

    for txn in transactions {
        let sym = txn.symbol.to_uppercase();

        if txn.quantity > 0.0 {
            // BUY
            let queue = lots.entry(sym.clone()).or_default();
            if queue.is_empty() {
                first_dates.insert(sym.clone(), txn.dt.clone());
            }
            queue.push_back((txn.quantity, txn.price));
            total_invested += txn.quantity * txn.price + txn.commission;
        } else {
            // SELL
            let mut qty_to_sell = txn.quantity.abs();
            if let Some(queue) = lots.get_mut(&sym) {
                let mut cost_basis_sold = 0.0f64;
                while qty_to_sell > 1e-9 {
                    if let Some(front) = queue.front_mut() {
                        let (lot_qty, lot_price) = *front;
                        if lot_qty <= qty_to_sell + 1e-9 {
                            cost_basis_sold += lot_qty * lot_price;
                            qty_to_sell -= lot_qty;
                            queue.pop_front();
                        } else {
                            cost_basis_sold += qty_to_sell * lot_price;
                            front.0 -= qty_to_sell;
                            qty_to_sell = 0.0;
                        }
                    } else {
                        break;
                    }
                }
                realized_pnl += txn.quantity.abs() * txn.price - cost_basis_sold - txn.commission;
            }
        }
    }

    let mut positions = HashMap::new();
    for (sym, queue) in &lots {
        if queue.is_empty() {
            continue;
        }
        let total_qty: f64 = queue.iter().map(|(q, _)| q).sum();
        let total_cost: f64 = queue.iter().map(|(q, p)| q * p).sum();
        let first_lot_date = first_dates.get(sym).cloned();
        positions.insert(
            sym.clone(),
            FifoPosition {
                symbol: sym.clone(),
                quantity: round6(total_qty),
                avg_cost: if total_qty > 0.0 { round4(total_cost / total_qty) } else { 0.0 },
                cost_basis: round2(total_cost),
                first_lot_date,
            },
        );
    }

    FifoResult {
        positions,
        realized_pnl: round2(realized_pnl),
        total_invested: round2(total_invested),
    }
}

/// Exchange map: most-recently-seen listing_exchange per symbol.
pub fn exchange_map(transactions: &[TxnRow]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for txn in transactions {
        if let Some(ex) = &txn.listing_exchange {
            if !ex.is_empty() {
                map.insert(txn.symbol.to_uppercase(), ex.to_uppercase());
            }
        }
    }
    map
}

fn round2(v: f64) -> f64 { (v * 100.0).round() / 100.0 }
fn round4(v: f64) -> f64 { (v * 10_000.0).round() / 10_000.0 }
fn round6(v: f64) -> f64 { (v * 1_000_000.0).round() / 1_000_000.0 }
