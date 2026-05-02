import { useState } from "react";

type Category = "ALL" | "PERFORMANCE" | "RISK" | "POSITION" | "LEDGER" | "DATA";

interface MetricEntry {
  name: string;
  category: Exclude<Category, "ALL">;
  location: string;
  what: string;
  formula: string;
  interpret: string;
  note?: string;
}

const METRICS: MetricEntry[] = [
  // ── Performance ─────────────────────────────────────────────────────────────
  {
    name: "Total Return",
    category: "PERFORMANCE",
    location: "Overview · Holdings · Performance",
    what: "The percentage gain or loss on a position or the whole portfolio since purchase, measured against original cost basis.",
    formula: "(Current Market Value − Cost Basis) ÷ Cost Basis × 100",
    interpret: "A positive number means the investment has grown beyond what you paid. A figure of +25% means every $1 invested is now worth $1.25. This ignores the time it took — use Annualized Return for a time-adjusted view.",
  },
  {
    name: "Annualized Return (CAGR)",
    category: "PERFORMANCE",
    location: "Performance · Risk",
    what: "The compound annual growth rate that, if applied uniformly each year, would produce the observed total return over the measurement window.",
    formula: "(End Value ÷ Start Value)^(365 ÷ Days) − 1",
    interpret: "Allows fair comparison across positions held for different lengths of time. A CAGR of +8% means the portfolio grew at the same rate as if it compounded at 8% per year. Computed over the full available price-snapshot history.",
    note: "Requires at least 2 data points separated by at least 1 day.",
  },
  {
    name: "MTD (Month-to-Date)",
    category: "PERFORMANCE",
    location: "Performance",
    what: "Portfolio return from the first trading day of the current calendar month to today.",
    formula: "(Current Value − Value at start of month) ÷ Value at start of month × 100",
    interpret: "Useful for comparing against monthly benchmarks or tracking a monthly contribution strategy. A value of −1.2% means the portfolio is down 1.2% since the start of this month.",
  },
  {
    name: "QTD (Quarter-to-Date)",
    category: "PERFORMANCE",
    location: "Performance",
    what: "Portfolio return from the first day of the current calendar quarter (Jan/Apr/Jul/Oct 1) to today.",
    formula: "(Current Value − Value at start of quarter) ÷ Value at start of quarter × 100",
    interpret: "Useful for quarterly reviews and comparing against quarterly fund reports. Quarters are calendar quarters: Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec.",
  },
  {
    name: "YTD (Year-to-Date)",
    category: "PERFORMANCE",
    location: "Performance",
    what: "Portfolio return from Jan 1 of the current year to today.",
    formula: "(Current Value − Value on Jan 1) ÷ Value on Jan 1 × 100",
    interpret: "The most commonly cited return figure in financial media. Allows direct comparison with index fund annual returns. Keep in mind it resets every January.",
  },
  {
    name: "Monthly Returns",
    category: "PERFORMANCE",
    location: "Performance",
    what: "The percentage change in portfolio value within each calendar month, shown as a bar chart for the last 24 months.",
    formula: "(Last portfolio value in month − First portfolio value in month) ÷ First value × 100",
    interpret: "Green bars are positive months; red bars are negative. Use the distribution of bars to assess consistency — a portfolio with mostly small positive months and occasional large negative ones has different risk characteristics than one with large swings in both directions.",
  },
  {
    name: "Rolling 12-Month Return",
    category: "PERFORMANCE",
    location: "Performance",
    what: "For each date in the chart, the 12-month return ending on that date. Shows how the annual performance has evolved over time.",
    formula: "For each point i: (Value[i] − Value[i−252]) ÷ Value[i−252] × 100",
    interpret: "A peak in the rolling return chart means that 12-month window was particularly strong. A trough means a weak 12-month period. Useful for identifying regime changes in portfolio performance.",
    note: "Requires at least 13 months of price history.",
  },

  // ── Risk ─────────────────────────────────────────────────────────────────────
  {
    name: "Annualized Volatility",
    category: "RISK",
    location: "Risk",
    what: "The standard deviation of daily returns, scaled up to an annual figure. Measures how much the portfolio value fluctuates day-to-day.",
    formula: "σ_daily × √252  where  σ_daily = stdDev(daily returns)",
    interpret: "A volatility of 15% means the portfolio swings by about ±15% per year on average. Lower is generally more stable. US equity index funds run roughly 15–20%; a diversified multi-asset portfolio typically targets 8–12%.",
    note: "Requires ≥20 daily return observations.",
  },
  {
    name: "Max Drawdown",
    category: "RISK",
    location: "Risk · Performance",
    what: "The largest peak-to-trough decline in portfolio value over the measurement window, expressed as a percentage of the peak value.",
    formula: "min over all t: (Value[t] − Peak Value up to t) ÷ Peak Value up to t × 100",
    interpret: "A max drawdown of −18% means at some point the portfolio fell 18% from its high-water mark. This is a measure of the worst-case loss an investor would have experienced if they bought at the peak and held to the trough. Institutional mandates often cap max drawdown at 10–15%.",
  },
  {
    name: "Sharpe Ratio",
    category: "RISK",
    location: "Risk",
    what: "Risk-adjusted return: how many units of excess return (above the risk-free rate) you earn per unit of total volatility.",
    formula: "(Annualized Return − Risk-Free Rate) ÷ Annualized Volatility  [Risk-free rate: 5%]",
    interpret: "Above 1.0 is generally considered good; above 2.0 is excellent; below 0 means the portfolio underperforms the risk-free rate. The Sharpe ratio rewards steady positive returns and penalizes all volatility equally — both up and down swings reduce it.",
    note: "Requires ≥20 daily return observations. Risk-free rate is fixed at 5% annual.",
  },
  {
    name: "Sortino Ratio",
    category: "RISK",
    location: "Risk",
    what: "Like the Sharpe ratio, but only penalizes downside volatility (days with negative returns). Upside swings do not hurt this metric.",
    formula: "(Annualized Return − Risk-Free Rate) ÷ (Downside Deviation × √252)",
    interpret: "A Sortino ratio higher than the Sharpe ratio indicates the portfolio's volatility is mostly on the upside (good). Sortino > 1 is considered acceptable; > 2 is strong. Preferred over Sharpe for strategies with asymmetric returns (e.g., momentum, covered calls).",
    note: "Downside deviation uses only observations with negative daily returns.",
  },
  {
    name: "Calmar Ratio",
    category: "RISK",
    location: "Risk",
    what: "The ratio of annualized return to the absolute value of the maximum drawdown. Measures how much return you earn per unit of worst-case loss.",
    formula: "Annualized Return % ÷ |Max Drawdown %|",
    interpret: "A Calmar ratio of 0.5 means the portfolio earns 0.5% of annual return for each 1% of max drawdown endured. Values above 0.5 are reasonable; above 1.0 is strong. Particularly useful for evaluating hedge funds and trend-following strategies.",
  },
  {
    name: "Value at Risk — VaR 95%",
    category: "RISK",
    location: "Risk",
    what: "The 1-day loss that will not be exceeded with 95% probability. Computed using the historical simulation method from observed daily returns.",
    formula: "5th-percentile of the sorted distribution of historical daily returns × 100",
    interpret: "A VaR of −1.8% means that on 95% of trading days, the portfolio loses less than 1.8%. Conversely, there is a 5% chance of losing more than that amount in a single day. The dollar equivalent is shown below the figure.",
    note: "Historical (non-parametric) method — no assumption of normality. Requires ≥20 observations.",
  },
  {
    name: "CVaR / Expected Shortfall (ES 95%)",
    category: "RISK",
    location: "Risk",
    what: "The average loss on the worst 5% of trading days. Also called Expected Shortfall. Answers: 'When things are bad, how bad are they on average?'",
    formula: "Mean of all daily returns in the worst 5% of the historical distribution × 100",
    interpret: "CVaR is always worse (more negative) than VaR. If VaR is −1.8% and CVaR is −3.2%, it means on the worst days you lose an average of 3.2%, not just 1.8%. CVaR is a more coherent risk measure — it is preferred by Basel III bank regulations for this reason.",
  },
  {
    name: "Volatility Contribution",
    category: "RISK",
    location: "Risk",
    what: "Each position's contribution to overall portfolio volatility, approximated as position weight × estimated annual volatility for that asset class.",
    formula: "Position Weight × σ_estimated  (normalized to 100% across all positions)",
    interpret: "Positions with high weight or high individual volatility dominate the risk budget. A diversified portfolio spreads risk contributions roughly evenly. Equity ETFs typically contribute disproportionately more risk than bond ETFs of equal weight.",
    note: "Uses long-run category-average volatility estimates, not live computed values.",
  },
  {
    name: "Trailing-Stop P(Hit) — 30D",
    category: "RISK",
    location: "Risk",
    what: "Probability that the stock price will touch a specified stop-loss level within the next 30 trading days, using a Geometric Brownian Motion approximation.",
    formula: "2 × [1 − Φ(stop% ÷ (σ_daily × √30))]  where Φ is the standard normal CDF",
    interpret: "A P(Hit) of 25% means there is a 1-in-4 chance the trailing stop will be triggered within 30 days. Higher stop percentages and lower volatility reduce this probability. The figure is a rough guide — real markets have fat tails and trending behaviour that GBM ignores.",
  },

  // ── Position ─────────────────────────────────────────────────────────────────
  {
    name: "Market Value",
    category: "POSITION",
    location: "Overview · Holdings · Transactions",
    what: "The current dollar value of a position: number of shares held multiplied by the latest observed price.",
    formula: "Shares × Current Price",
    interpret: "Represents what the position could be liquidated for at the current market price, before commissions and slippage. The sum across all positions is the total portfolio market value.",
  },
  {
    name: "Cost Basis",
    category: "POSITION",
    location: "Holdings · Transactions",
    what: "The total amount paid to acquire the shares currently held, derived using the FIFO (First-In, First-Out) lot accounting method.",
    formula: "Sum of (shares acquired × price paid) for all open lots, net of any FIFO-matched sells",
    interpret: "When a position has a market value higher than its cost basis, the difference is an unrealized gain. The cost basis is essential for calculating capital gains tax when you eventually sell.",
  },
  {
    name: "Unrealized P&L",
    category: "POSITION",
    location: "Holdings · Transactions",
    what: "Paper profit or loss on currently open positions — the gain or loss that would be realized if all shares were sold today at the current price.",
    formula: "Market Value − Cost Basis",
    interpret: "Positive = the position has gained. Negative = it is underwater. This figure changes every time the price moves. It is not taxable until you actually sell.",
  },
  {
    name: "Day Gain / Day Change",
    category: "POSITION",
    location: "Overview · Holdings",
    what: "The change in market value since the previous trading day's close, both in dollars and as a percentage.",
    formula: "Shares × (Current Price − Previous Close)  and  (Current Price − Previous Close) ÷ Previous Close × 100",
    interpret: "Shows intra-day or session-over-session movement. A large positive day gain does not necessarily mean the investment is doing well long-term — check total return for the full picture.",
  },
  {
    name: "Position Weight",
    category: "POSITION",
    location: "Overview · Holdings · Transactions",
    what: "The fraction of total portfolio market value represented by a single holding.",
    formula: "Position Market Value ÷ Total Portfolio Market Value × 100",
    interpret: "A weight of 30% means nearly a third of the portfolio is in that one security. Concentration risk increases as individual weights grow. Standard diversification guidance suggests no single position exceeding 10–20% for long-only portfolios.",
  },
  {
    name: "Average Cost",
    category: "POSITION",
    location: "Holdings · Transactions",
    what: "The weighted-average price paid per share across all open lots for a symbol, derived from FIFO lot accounting.",
    formula: "Cost Basis ÷ Total Shares Held",
    interpret: "The 'break-even' price for the position — the price at which unrealized P&L is zero. If the current price is above average cost, the position is in profit; below, it is at a loss.",
  },

  // ── Ledger ────────────────────────────────────────────────────────────────────
  {
    name: "Total Invested",
    category: "LEDGER",
    location: "Performance · Transactions",
    what: "The cumulative dollar amount deployed into the market across all buy transactions, including commissions paid.",
    formula: "Sum of (|Quantity| × Price + Commission) for all BUY fills",
    interpret: "This represents total cash outflows from your account for purchases. It is not the same as current cost basis — sold positions reduce cost basis but do not reduce total invested. Use it to understand total capital committed over time.",
  },
  {
    name: "Realized P&L",
    category: "LEDGER",
    location: "Performance · Transactions",
    what: "Profit or loss that has been 'locked in' by selling shares. Computed using FIFO lot matching.",
    formula: "Sum of (Sell Proceeds − Matched Buy Cost − Commission) across all closed lots",
    interpret: "Positive realized P&L means you have booked profits from past sales. This amount is generally taxable as capital gains (short-term or long-term depending on holding period). It does not change unless you make new sell transactions.",
  },
  {
    name: "FIFO (First-In, First-Out)",
    category: "LEDGER",
    location: "Transactions · Holdings",
    what: "The cost accounting method used to match buy lots with sell transactions. The oldest shares purchased are considered sold first.",
    formula: "When selling N shares: deplete the earliest-dated lots until N shares are fully matched",
    interpret: "FIFO is the IRS default method and is common for individual investors. It tends to realize longer-held (and often lower-cost) lots first, which may result in larger long-term capital gains. Specific identification would allow choosing which lots to sell, but requires broker support.",
    note: "All realized P&L and cost basis figures in this app use FIFO.",
  },
  {
    name: "Net Cash Flow",
    category: "LEDGER",
    location: "Transactions",
    what: "The signed cash impact of each transaction: negative for purchases, positive for sales.",
    formula: "BUY: −(Notional + Commission)   SELL: +(Notional − Commission)",
    interpret: "Summing all net cash flows gives the total cash invested in the portfolio over its lifetime. Useful for tracking how much 'new money' versus 'compound growth' contributed to portfolio size.",
  },

  // ── Data ─────────────────────────────────────────────────────────────────────
  {
    name: "Price Snapshots (Live)",
    category: "DATA",
    location: "All pages",
    what: "Current price data captured from Yahoo Finance every 60 seconds while the app is running and stored in the database.",
    formula: "Via yfinance fast_info: last_price, previous_close, day_high, day_low, volume, market_cap",
    interpret: "Used for all live market value, day gain, and live summary card calculations. The 60-second interval provides near-real-time data without overwhelming the Yahoo Finance API. Snapshots persist across restarts.",
  },
  {
    name: "Historical Price Bars (Backfill)",
    category: "DATA",
    location: "Performance · Risk",
    what: "Two years of daily OHLCV (Open/High/Low/Close/Volume) bars fetched from Yahoo Finance on startup and cached in the database for fast offline access.",
    formula: "Via yfinance history(start=2yr_ago): daily adjusted closing prices for all held symbols",
    interpret: "Enables performance and risk metrics (Sharpe, Sortino, VaR, max drawdown, etc.) immediately without waiting for the app to accumulate live snapshots. Updated on each app restart; new data is fetched only for dates not already cached.",
    note: "Bars are inserted with INSERT OR IGNORE — existing data is never overwritten.",
  },
  {
    name: "Portfolio Snapshots",
    category: "DATA",
    location: "Performance · Risk",
    what: "Time-series of total portfolio market value and cost basis, stored once per trading day from the historical backfill and once per minute from the live scheduler.",
    formula: "Backfill: FIFO positions as-of each trading day × historical closing prices. Live: current positions × latest snapshot prices.",
    interpret: "This is the raw data series from which all performance metrics are computed. Aggregated to one data point per calendar day before being served to the frontend, so metrics reflect true daily returns rather than 60-second micro-fluctuations.",
  },
];

function SectionHeader({
  num,
  title,
  right,
}: {
  num: string;
  title: string;
  right?: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-4 pt-8 border-t border-parchment-border">
      <div className="flex items-baseline gap-3">
        <span className="text-ink-4 font-mono text-xs">§ {num}</span>
        <span className="section-label">{title}</span>
      </div>
      {right && <span className="section-label text-ink-4">{right}</span>}
    </div>
  );
}

const CAT_LABELS: Record<Exclude<Category, "ALL">, string> = {
  PERFORMANCE: "Performance",
  RISK: "Risk",
  POSITION: "Position",
  LEDGER: "Ledger",
  DATA: "Data",
};

const CAT_SECTION: Record<Exclude<Category, "ALL">, { num: string; title: string; subtitle: string }> = {
  PERFORMANCE: {
    num: "01",
    title: "Performance Metrics",
    subtitle: "How returns are measured and presented across time horizons.",
  },
  RISK: {
    num: "02",
    title: "Risk Metrics",
    subtitle: "Quantifying volatility, downside exposure, and risk-adjusted efficiency.",
  },
  POSITION: {
    num: "03",
    title: "Position Metrics",
    subtitle: "Per-holding values, costs, and weights within the portfolio.",
  },
  LEDGER: {
    num: "04",
    title: "Ledger & P&L Metrics",
    subtitle: "Transaction accounting, FIFO lot matching, and realized/unrealized gains.",
  },
  DATA: {
    num: "05",
    title: "Data & Methodology",
    subtitle: "How price data is sourced, cached, and used in calculations.",
  },
};

function MetricCard({ m }: { m: MetricEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-parchment-border rounded overflow-hidden">
      <button
        className="w-full text-left px-5 py-3.5 bg-card-bg hover:bg-parchment-dark/60 transition-colors flex items-center justify-between gap-4"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-4 min-w-0">
          <span className="font-sans font-semibold text-sm text-ink shrink-0">{m.name}</span>
          <span className="text-ink-5 text-xs hidden sm:block truncate">{m.location}</span>
        </div>
        <span className="text-ink-4 text-xs shrink-0 font-mono">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="border-t border-parchment-border bg-parchment px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="section-label mb-1.5">What it is</p>
              <p className="text-sm text-ink-3 leading-relaxed">{m.what}</p>
            </div>
            <div>
              <p className="section-label mb-1.5">Formula</p>
              <pre className="text-xs font-mono text-ink-2 bg-parchment-dark border border-parchment-border rounded px-3 py-2 whitespace-pre-wrap leading-relaxed">
                {m.formula}
              </pre>
            </div>
            <div>
              <p className="section-label mb-1.5">How to interpret</p>
              <p className="text-sm text-ink-3 leading-relaxed">{m.interpret}</p>
            </div>
          </div>
          {m.note && (
            <div className="flex items-start gap-2 pt-1 border-t border-parchment-border">
              <span className="text-ink-4 text-xs font-mono mt-0.5">↳</span>
              <p className="text-xs text-ink-4 leading-relaxed">{m.note}</p>
            </div>
          )}
          <p className="text-2xs text-ink-5">Found in: {m.location}</p>
        </div>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  const [filter, setFilter] = useState<Category>("ALL");
  const [search, setSearch] = useState("");

  const categories = Object.keys(CAT_LABELS) as Exclude<Category, "ALL">[];
  const sectionOrder = categories;

  const visible = METRICS.filter((m) => {
    const matchCat = filter === "ALL" || m.category === filter;
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      m.name.toLowerCase().includes(q) ||
      m.what.toLowerCase().includes(q) ||
      m.interpret.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  return (
    <div className="max-w-[1200px] mx-auto px-8 pb-16">
      {/* Editorial header */}
      <div className="grid grid-cols-5 gap-8 py-10 border-b border-parchment-border">
        <div className="col-span-3">
          <p className="section-label mb-3">§ 07 — Reference</p>
          <h1 className="font-serif text-6xl text-ink leading-tight mb-1">
            Numbers explained,
          </h1>
          <h1 className="font-serif text-6xl text-ink italic leading-tight mb-5">
            nothing hidden.
          </h1>
          <p className="text-ink-3 text-sm leading-relaxed max-w-lg">
            Every metric, formula, and methodology used in Ledger &amp; Lever — documented
            plainly so you know exactly what each figure means and how to act on it.
          </p>
        </div>
        <div className="col-span-2 flex items-start gap-8 pl-8 border-l border-parchment-border pt-2">
          <div>
            <p className="section-label mb-1">Metrics documented</p>
            <p className="font-sans font-semibold text-4xl text-ink">{METRICS.length}</p>
          </div>
          <div>
            <p className="section-label mb-1">Categories</p>
            <p className="font-sans font-semibold text-4xl text-ink">{categories.length}</p>
          </div>
          <div>
            <p className="section-label mb-1">Data source</p>
            <p className="font-sans font-semibold text-base text-ink mt-1">Yahoo Finance</p>
            <p className="text-ink-4 text-xs mt-0.5">via yfinance · daily bars</p>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 py-5 border-b border-parchment-border">
        <div className="flex flex-wrap gap-1.5">
          {(["ALL", ...categories] as Category[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                filter === cat
                  ? "bg-ink text-parchment border-ink"
                  : "bg-parchment-dark text-ink-3 border-parchment-border hover:border-ink-4"
              }`}
            >
              {cat === "ALL" ? "All" : CAT_LABELS[cat]}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search metrics…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:ml-auto border border-parchment-border rounded px-3 py-1.5 text-xs bg-card-bg text-ink placeholder:text-ink-5 focus:outline-none focus:border-ink-4 w-48"
        />
      </div>

      {/* Sections */}
      {filter === "ALL" && !search ? (
        sectionOrder.map((cat) => {
          const sec = CAT_SECTION[cat];
          const items = METRICS.filter((m) => m.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <SectionHeader num={sec.num} title={sec.title} right={sec.subtitle} />
              <div className="space-y-2">
                {items.map((m) => (
                  <MetricCard key={m.name} m={m} />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <div>
          <div className="mt-6 mb-4 flex items-center gap-2">
            <span className="section-label">
              {visible.length} result{visible.length !== 1 ? "s" : ""}
            </span>
            {search && (
              <span className="text-xs text-ink-4">
                matching &ldquo;{search}&rdquo;
              </span>
            )}
          </div>
          {visible.length === 0 ? (
            <div className="flex items-center justify-center h-32 border border-parchment-border rounded">
              <p className="text-ink-4 text-sm">No metrics match your search.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((m) => (
                <MetricCard key={m.name} m={m} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Methodology note */}
      <SectionHeader num="06" title="General Methodology Notes" />
      <div className="grid grid-cols-2 gap-6">
        {[
          {
            title: "Trading Days vs Calendar Days",
            body: "Most risk metrics (volatility, Sharpe, VaR) use the convention of 252 trading days per year. Annualizing daily standard deviation: σ_annual = σ_daily × √252. The performance API aggregates to one data point per calendar day — weekends and holidays are excluded from the trading-day count.",
          },
          {
            title: "Risk-Free Rate",
            body: "The Sharpe and Sortino ratios use a fixed risk-free rate of 5% per annum, approximating the current US T-bill rate. This is not automatically updated; if the risk-free rate changes materially, ratio comparisons with historical periods may need adjustment.",
          },
          {
            title: "Historical Simulation vs Parametric",
            body: "VaR and CVaR use the historical simulation method: returns are sorted and percentiles are read directly from observed data. This makes no assumption of normality and automatically captures fat tails and skewness present in the actual return history.",
          },
          {
            title: "FIFO Accounting",
            body: "All lot-level P&L calculations (cost basis, realized gains, average cost) use FIFO (First-In, First-Out). This is the IRS default for most taxable accounts. Short-selling and fractional shares are supported. The FIFO state is persisted in the database and recomputed whenever transactions change.",
          },
          {
            title: "Data Freshness",
            body: "Live prices are refreshed every 60 seconds via the Yahoo Finance fast_info endpoint. Historical daily bars (2-year backfill) are fetched once on app startup and cached. The cache is updated on each restart, fetching only bars not yet stored. Prices reflect US market hours; after-hours data may appear in the last close.",
          },
          {
            title: "Illustrative vs Computed Data",
            body: "Some data on the Risk page is illustrative: the correlation matrix uses long-run category averages, factor exposures use allocation-weighted estimates, and stress-test scenarios use historical/simulated figures. These are clearly labeled with '(est.)' or '(illustrative)'. All return, volatility, and drawdown metrics are computed from real portfolio snapshot data.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="border border-parchment-border rounded p-5 bg-card-bg"
          >
            <p className="font-sans font-semibold text-sm text-ink mb-2">{item.title}</p>
            <p className="text-sm text-ink-3 leading-relaxed">{item.body}</p>
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div className="mt-12 pt-4 border-t border-parchment-border flex items-center justify-between">
        <span className="section-label">
          Ledger &amp; Lever — Personal · Page rendered{" "}
          {new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}{" "}
          ET
        </span>
        <span className="section-label">
          For informational use only. Not investment advice.
        </span>
      </div>
    </div>
  );
}
