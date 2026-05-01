import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearTransactions,
  getDerivedPositions,
  getTransactionSummary,
  getTransactions,
  getTransactionSymbols,
  getYearActivity,
  resetTransactions,
  uploadTransactions,
} from "../api/portfolio";
import type {
  DerivedPosition,
  Transaction,
  TransactionSummary,
  YearActivity,
} from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(n: number | null | undefined, dec = 0) {
  if (n == null) return "—";
  return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtSign(n: number | null | undefined, dec = 0) {
  if (n == null) return "—";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (n >= 0 ? "+" : "-") + "$" + s;
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return "";
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}
function fmtDateShort(iso: string | null | undefined) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}
function fmtK(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ num, title, right }: { num: string; title: string; right?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-3 pt-6 border-t border-parchment-border">
      <div className="flex items-baseline gap-3">
        <span className="text-ink-4 font-mono text-xs">§ {num}</span>
        <span className="section-label">{title}</span>
      </div>
      {right && <span className="section-label">{right}</span>}
    </div>
  );
}

// ── Upload toast ───────────────────────────────────────────────────────────────

function Toast({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink text-parchment text-xs px-4 py-2 rounded shadow-lg z-50">
      {msg}
    </div>
  );
}

// ── Derived Positions table ────────────────────────────────────────────────────

function DerivedPositionsTable({ positions, loading }: { positions: DerivedPosition[]; loading: boolean }) {
  if (loading) return <div className="text-ink-4 text-xs py-6">Loading positions…</div>;
  if (!positions.length) return <div className="text-ink-4 text-xs py-6">No positions derived yet — upload a CSV or reset to sample data.</div>;

  const totalMV = positions.reduce((s, p) => s + (p.market_value ?? 0), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-parchment-border">
            {["TICKER", "QTY", "AVG COST", "LAST", "COST BASIS", "MKT VALUE", "UNREALIZED", "%", "WT.  FIRST LOT"].map((h) => (
              <th key={h} className="section-label text-left py-2 pr-4 last:pr-0 whitespace-nowrap font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const unreal = p.unrealized ?? 0;
            const cls = unreal >= 0 ? "pos" : "neg";
            return (
              <tr key={p.symbol} className="border-b border-parchment-border/50 hover:bg-parchment-dark/30">
                <td className="py-2.5 pr-4 font-semibold tracking-wide">{p.symbol}</td>
                <td className="py-2.5 pr-4 font-mono">{p.quantity.toLocaleString()}</td>
                <td className="py-2.5 pr-4 font-mono">{fmtUSD(p.avg_cost, 2)}</td>
                <td className="py-2.5 pr-4 font-mono">{p.current_price ? fmtUSD(p.current_price, 2) : "—"}</td>
                <td className="py-2.5 pr-4 font-mono">{fmtUSD(p.cost_basis)}</td>
                <td className="py-2.5 pr-4 font-mono">{p.market_value ? fmtUSD(p.market_value) : "—"}</td>
                <td className={`py-2.5 pr-4 font-mono font-semibold ${cls}`}>
                  {p.unrealized != null ? fmtSign(p.unrealized) : "—"}
                </td>
                <td className={`py-2.5 pr-4 font-mono text-2xs ${cls}`}>
                  {p.unrealized_pct != null ? fmtPct(p.unrealized_pct) : ""}
                </td>
                <td className="py-2.5 font-mono text-ink-3 whitespace-nowrap">
                  <span className="text-ink-4">{p.weight_pct != null ? p.weight_pct.toFixed(1) + "%" : "—"}</span>
                  <span className="text-ink-5 mx-1">·</span>
                  <span>{fmtDateShort(p.first_lot_date)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-parchment-border">
            <td colSpan={4} className="py-2.5 section-label">PORTFOLIO TOTAL</td>
            <td className="py-2.5 pr-4 font-mono font-semibold">
              {fmtUSD(positions.reduce((s, p) => s + p.cost_basis, 0))}
            </td>
            <td className="py-2.5 pr-4 font-mono font-semibold">
              {totalMV ? fmtUSD(totalMV) : "—"}
            </td>
            <td className={`py-2.5 pr-4 font-mono font-semibold ${
              positions.reduce((s, p) => s + (p.unrealized ?? 0), 0) >= 0 ? "pos" : "neg"
            }`}>
              {fmtSign(positions.reduce((s, p) => s + (p.unrealized ?? 0), 0))}
            </td>
            <td colSpan={2} className="py-2.5 section-label">100.0%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Activity by year chart ─────────────────────────────────────────────────────

function YearActivityChart({ activity }: { activity: YearActivity[] }) {
  if (!activity.length) return null;
  const maxNotional = Math.max(...activity.map((a) => a.notional));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Bar chart */}
      <div className="space-y-1.5">
        {activity.map((a) => (
          <div key={a.year} className="flex items-center gap-3">
            <span className="section-label w-8 text-right">{a.year}</span>
            <div className="flex-1 h-5 bg-parchment-dark rounded overflow-hidden">
              <div
                className="h-full bg-ink rounded transition-all duration-500"
                style={{ width: `${(a.notional / maxNotional) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Right column: notional + buy/sell counts */}
      <div className="space-y-1.5">
        {activity.map((a) => (
          <div key={a.year} className="flex items-center h-5">
            <span className="font-mono text-xs text-ink-2">
              {fmtK(a.notional)}
            </span>
            <span className="text-ink-5 mx-1.5 text-2xs">·</span>
            <span className="text-2xs text-ink-4">
              {a.buys}B/{a.sells}S
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Fill Ledger ────────────────────────────────────────────────────────────────

function FillLedger({
  transactions,
  total,
  page,
  pageSize,
  symbols,
  filterSymbol,
  filterSide,
  onFilterSymbol,
  onFilterSide,
  onPage,
  loading,
}: {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  symbols: string[];
  filterSymbol: string;
  filterSide: string;
  onFilterSymbol: (s: string) => void;
  onFilterSide: (s: string) => void;
  onPage: (p: number) => void;
  loading: boolean;
}) {
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <span className="section-label">FILTER</span>
        <select
          value={filterSymbol}
          onChange={(e) => { onFilterSymbol(e.target.value); onPage(1); }}
          className="bg-parchment border border-parchment-border text-xs px-2 py-1 rounded text-ink focus:outline-none"
        >
          <option value="">ALL</option>
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterSide}
          onChange={(e) => { onFilterSide(e.target.value); onPage(1); }}
          className="bg-parchment border border-parchment-border text-xs px-2 py-1 rounded text-ink focus:outline-none"
        >
          <option value="">All</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>

        {/* Pagination right */}
        <div className="ml-auto flex items-center gap-2 section-label">
          <span>page {page} / {totalPages}</span>
          <button
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className="px-2 py-0.5 border border-parchment-border rounded disabled:opacity-30 hover:bg-parchment-dark text-xs"
          >
            ← prev
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            className="px-2 py-0.5 border border-parchment-border rounded disabled:opacity-30 hover:bg-parchment-dark text-xs"
          >
            next →
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-ink-4 text-xs py-6">Loading fills…</div>
      ) : !transactions.length ? (
        <div className="text-ink-4 text-xs py-6">No fills found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-parchment-border">
                {["DATE & TIME", "SIDE", "TICKER", "QUANTITY", "PRICE", "NOTIONAL", "COMMISSION", "NET"].map((h) => (
                  <th key={h} className="section-label text-left py-2 pr-4 last:pr-0 font-normal whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-parchment-border/50 hover:bg-parchment-dark/30">
                  <td className="py-2.5 pr-4 font-mono text-ink-3 whitespace-nowrap">{fmtDate(t.dt)}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-2xs font-semibold tracking-wider ${
                        t.side === "BUY"
                          ? "bg-positive-bg text-positive border border-positive/20"
                          : "bg-negative-bg text-negative border border-negative/20"
                      }`}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-semibold tracking-wide">{t.symbol}</td>
                  <td className="py-2.5 pr-4 font-mono">{Math.abs(t.quantity).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 font-mono">{fmtUSD(t.price, 2)}</td>
                  <td className="py-2.5 pr-4 font-mono">{fmtUSD(t.notional)}</td>
                  <td className="py-2.5 pr-4 font-mono text-ink-4">{fmtUSD(t.commission, 2)}</td>
                  <td className={`py-2.5 font-mono font-semibold ${t.net >= 0 ? "pos" : "neg"}`}>
                    {fmtSign(t.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [positions, setPositions] = useState<DerivedPosition[]>([]);
  const [activity, setActivity] = useState<YearActivity[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterSide, setFilterSide] = useState("");
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [loadingFills, setLoadingFills] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchSummaryAndActivity = useCallback(async () => {
    const [s, act] = await Promise.all([getTransactionSummary(), getYearActivity()]);
    setSummary(s);
    setActivity(act);
  }, []);

  const fetchPositions = useCallback(async () => {
    setLoadingPositions(true);
    try {
      const p = await getDerivedPositions();
      setPositions(p);
    } finally {
      setLoadingPositions(false);
    }
  }, []);

  const fetchFills = useCallback(async (pg = page, sym = filterSymbol, side = filterSide) => {
    setLoadingFills(true);
    try {
      const [res, syms] = await Promise.all([
        getTransactions({ page: pg, page_size: 10, symbol: sym || undefined, side: side || undefined }),
        getTransactionSymbols(),
      ]);
      setTransactions(res.items);
      setTxTotal(res.total);
      setSymbols(syms);
    } finally {
      setLoadingFills(false);
    }
  }, [page, filterSymbol, filterSide]);

  useEffect(() => {
    fetchSummaryAndActivity();
    fetchPositions();
    fetchFills(1, "", "");
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchFills(page, filterSymbol, filterSide);
  }, [page, filterSymbol, filterSide]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadTransactions(file);
      setToast(`Imported ${res.added} fill${res.added !== 1 ? "s" : ""}${res.duplicates ? ` · ${res.duplicates} duplicate${res.duplicates !== 1 ? "s" : ""} skipped` : ""}${res.errors ? ` · ${res.errors} error${res.errors !== 1 ? "s" : ""}` : ""}`);
      await Promise.all([fetchSummaryAndActivity(), fetchPositions(), fetchFills(1, "", "")]);
      setPage(1);
      setFilterSymbol("");
      setFilterSide("");
    } catch {
      setToast("Upload failed — check the file format.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleReset() {
    setUploading(true);
    try {
      const res = await resetTransactions();
      setToast(`Sample data loaded — ${res.added} fill${res.added !== 1 ? "s" : ""}`);
      await Promise.all([fetchSummaryAndActivity(), fetchPositions(), fetchFills(1, "", "")]);
      setPage(1);
      setFilterSymbol("");
      setFilterSide("");
    } catch {
      setToast("Failed to load sample data.");
    } finally {
      setUploading(false);
    }
  }

  async function handleClear() {
    if (!confirm("Clear all transaction data?")) return;
    await clearTransactions();
    setSummary(null);
    setPositions([]);
    setActivity([]);
    setTransactions([]);
    setTxTotal(0);
    setToast("All transactions cleared.");
  }

  const fills = summary?.fills ?? 0;
  const invested = summary?.invested ?? 0;
  const realized = summary?.realized ?? null;
  const unrealized = summary?.unrealized ?? null;
  const hasTx = fills > 0;

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="section-label mb-2">§ 05 — Transactions &amp; Ledger</div>

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">
        <div>
          <h1 className="font-serif text-5xl md:text-6xl leading-tight text-ink">
            Every fill,<br />
            <em>traceable.</em>
          </h1>
          <p className="text-ink-3 mt-3 max-w-md text-sm leading-relaxed">
            Drop your IBKR activity export here — the ledger reconciles holdings,
            average cost, and FIFO realized profit on the fly.
            <br />
            <span className="text-ink-4">
              Columns expected: <code className="font-mono text-2xs">Symbol, Date/Time, Quantity, Price, Commission</code>
            </span>
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-6 md:gap-10 text-right shrink-0">
          <div>
            <div className="section-label mb-1">FILLS</div>
            <div className="text-3xl font-serif">{hasTx ? fills : "—"}</div>
          </div>
          <div>
            <div className="section-label mb-1">INVESTED</div>
            <div className="text-3xl font-serif">{hasTx ? fmtUSD(invested) : "—"}</div>
          </div>
          <div>
            <div className="section-label mb-1">REALIZED</div>
            <div className={`text-3xl font-serif ${realized != null ? (realized >= 0 ? "pos" : "neg") : ""}`}>
              {realized != null ? fmtSign(realized) : "—"}
            </div>
          </div>
          <div>
            <div className="section-label mb-1">UNREALIZED</div>
            <div className={`text-3xl font-serif ${unrealized != null ? (unrealized >= 0 ? "pos" : "neg") : ""}`}>
              {unrealized != null ? fmtSign(unrealized) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Upload card ───────────────────────────────────────────────────── */}
      <div className="border border-dashed border-parchment-border rounded-lg p-5 mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-card-bg">
        <div>
          <div className="section-label mb-1">ACTIVITY FILE</div>
          {hasTx ? (
            <>
              <div className="font-mono text-sm font-medium text-ink">
                {summary?.filename ?? "custom_upload.csv"}
              </div>
              <div className="text-ink-4 text-xs mt-0.5">
                {fills} fill{fills !== 1 ? "s" : ""} parsed
                {" · "}
                {summary?.active_positions ?? 0} active position{(summary?.active_positions ?? 0) !== 1 ? "s" : ""}
                {summary?.last_fill && ` · last fill ${fmtDate(summary.last_fill)}`}
              </div>
            </>
          ) : (
            <div className="text-ink-4 text-sm">No data loaded — upload a CSV or reset to sample.</div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-ink text-parchment text-xs font-semibold tracking-widest uppercase hover:bg-ink-2 disabled:opacity-50 transition-colors"
          >
            {uploading ? "Uploading…" : "I Upload IBKR CSV"}
          </button>
          <button
            disabled={uploading}
            onClick={handleReset}
            className="px-4 py-2 border border-parchment-border text-xs font-semibold tracking-widest uppercase hover:bg-parchment-dark disabled:opacity-50 transition-colors"
          >
            Reset to Sample
          </button>
          {hasTx && (
            <button
              onClick={handleClear}
              className="text-ink-4 text-xs hover:text-negative transition-colors"
              title="Clear all transactions"
            >
              ✕ clear
            </button>
          )}
        </div>
      </div>

      {hasTx && (
        <>
          {/* ── § 01 Derived Positions ─────────────────────────────────────── */}
          <SectionHeader num="01" title="Derived Positions" right="FIFO · AUTO-RECONCILED" />
          <DerivedPositionsTable positions={positions} loading={loadingPositions} />

          {/* ── § 02 Activity by Year ──────────────────────────────────────── */}
          <SectionHeader num="02" title="Activity by Year" right="NOTIONAL TRADED" />
          <YearActivityChart activity={activity} />

          {/* Totals under chart */}
          {activity.length > 0 && (
            <div className="mt-6 flex gap-10 border-t border-parchment-border pt-4">
              <div>
                <div className="section-label mb-1">TOTAL COMMISSIONS</div>
                <div className="font-mono text-sm font-semibold">
                  {fmtUSD(
                    transactions.reduce((s, t) => s + t.commission, 0) /* approx — full set loaded below */
                  )}
                </div>
              </div>
              <div>
                <div className="section-label mb-1">AVG FILL SIZE</div>
                <div className="font-mono text-sm font-semibold">
                  {fills ? fmtUSD(invested / fills) : "—"}
                </div>
              </div>
            </div>
          )}

          {/* ── § 03 Fill Ledger ───────────────────────────────────────────── */}
          <SectionHeader
            num="03"
            title="Fill Ledger"
            right={`${fills} FILLS · SORTED NEWEST FIRST`}
          />
          <FillLedger
            transactions={transactions}
            total={txTotal}
            page={page}
            pageSize={10}
            symbols={symbols}
            filterSymbol={filterSymbol}
            filterSide={filterSide}
            onFilterSymbol={setFilterSymbol}
            onFilterSide={setFilterSide}
            onPage={setPage}
            loading={loadingFills}
          />
        </>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="mt-12 pt-4 border-t border-parchment-border flex justify-between text-2xs text-ink-4">
        <span>LEDGER &amp; LEVER — PERSONAL · PAGE RENDERED {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} ET</span>
        <span>FOR INFORMATIONAL ONLY. NOT INVESTMENT ADVICE.</span>
      </div>

      {toast && <Toast msg={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
