import { useState } from "react";
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { deletePosition } from "../api/portfolio";
import type { Position, PortfolioSummary, DerivedPosition } from "../types";

interface Props {
  summary: PortfolioSummary | null;
  positions: Position[];
  derivedPositions: DerivedPosition[];
  loading: boolean;
  onAddPosition: () => void;
  onEditPosition: (p: Position) => void;
  onDeleted: () => void;
}

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function sign(n: number) { return n >= 0 ? "+" : ""; }
function fmtK(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

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

type SortKey = keyof Position;
type Dir = "asc" | "desc";

function DriftBar({ wt, target }: { wt: number; target: number }) {
  const drift = wt - target;
  return (
    <div className="flex items-center gap-1 w-24">
      <div className="flex-1 h-1.5 bg-parchment-dark rounded overflow-hidden">
        <div
          className="h-full rounded"
          style={{
            width: `${Math.min((wt / (target + 5)) * 100, 100)}%`,
            backgroundColor: Math.abs(drift) > 2 ? "#B81C1C" : "#1A1611",
          }}
        />
      </div>
      <span className={`text-2xs font-medium ${Math.abs(drift) > 2 ? "neg" : "text-ink-4"}`}>
        {drift >= 0 ? "+" : ""}{drift.toFixed(1)}
      </span>
    </div>
  );
}

export default function HoldingsPage({
  summary,
  positions,
  derivedPositions,
  loading,
  onAddPosition,
  onEditPosition,
  onDeleted,
}: Props) {
  // Build a lookup from symbol → DerivedPosition for FIFO lot data
  const derivedBySymbol = Object.fromEntries(
    derivedPositions.map((dp) => [dp.symbol.toUpperCase(), dp])
  );
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<Dir>("asc");
  const [deleting, setDeleting] = useState<number | null>(null);

  const totalMV = positions.reduce((s, p) => s + (p.market_value ?? 0), 0) || 1;
  const totalValue = summary?.total_value ?? 0;
  const totalCost = summary?.total_cost ?? 0;
  const n = positions.length;

  // Target weights (spread evenly if no preset)
  const targetWt = 100 / Math.max(n, 1);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = [...positions].sort((a, b) => {
    const av = a[sortKey] as number | string | null;
    const bv = b[sortKey] as number | string | null;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  async function handleDelete(id: number) {
    if (!confirm("Remove this position?")) return;
    setDeleting(id);
    try { await deletePosition(id); onDeleted(); }
    finally { setDeleting(null); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown size={10} className="text-ink-5 inline ml-0.5" />;
    return sortDir === "asc"
      ? <ChevronUp size={10} className="text-ink-2 inline ml-0.5" />
      : <ChevronDown size={10} className="text-ink-2 inline ml-0.5" />;
  }

  function Th({ label, col, right }: { label: string; col: SortKey; right?: boolean }) {
    return (
      <th
        className={`px-3 py-2 section-label cursor-pointer select-none whitespace-nowrap ${right ? "text-right" : "text-left"}`}
        onClick={() => toggleSort(col)}
      >
        {label}<SortIcon col={col} />
      </th>
    );
  }

  // Category labels
  function getCategory(p: Position) {
    const n = (p.name ?? p.symbol).toLowerCase();
    if (n.includes("bond") || n.includes("treasury") || n.includes("tip") || n.includes("agg")) return "US Bond · Agg";
    if (n.includes("intl") || n.includes("international") || n.includes("developed") || n.includes("ixus")) return "Intl Dev · Broad";
    if (n.includes("emerging") || n.includes("iemg")) return "EM Equity";
    if (n.includes("gold") || n.includes("iau")) return "Commodity · Gold";
    if (n.includes("cash") || n.includes("t-bill") || n.includes("sgov") || n.includes("money")) return "Cash · T-Bill";
    if (n.includes("tip") || n.includes("schp")) return "US Bond · Infl-Ikd";
    if (n.includes("vol") || n.includes("usmv")) return "US Equity · Factor";
    return "US Equity · Broad";
  }

  // Allocation buckets for bar
  const categoryTotals: Record<string, number> = {};
  for (const p of positions) {
    const cat = getCategory(p);
    categoryTotals[cat] = (categoryTotals[cat] ?? 0) + (p.market_value ?? 0);
  }
  const bucketColors: Record<string, string> = {
    "US Equity · Broad": "#1A1611",
    "US Equity · Factor": "#3D5A8A",
    "Intl Dev · Broad": "#5B7FA6",
    "EM Equity": "#8A6B3D",
    "US Bond · Agg": "#5B7A6B",
    "US Bond · Infl-Ikd": "#6B7A5B",
    "Commodity · Gold": "#B8860B",
    "Cash · T-Bill": "#9B9088",
  };

  // Tax lots: show top unrealized P/L rows, using FIFO first_lot_date when available
  const taxLots = [...positions]
    .filter((p) => p.total_gain != null || derivedBySymbol[p.symbol.toUpperCase()])
    .sort((a, b) => {
      const aUnreal = derivedBySymbol[a.symbol.toUpperCase()]?.unrealized ?? a.total_gain ?? 0;
      const bUnreal = derivedBySymbol[b.symbol.toUpperCase()]?.unrealized ?? b.total_gain ?? 0;
      return Math.abs(bUnreal) - Math.abs(aUnreal);
    })
    .slice(0, 4)
    .map((p) => {
      const dp = derivedBySymbol[p.symbol.toUpperCase()];
      // Use FIFO first_lot_date if available, otherwise fall back to created_at
      const acquired = dp?.first_lot_date
        ? new Date(dp.first_lot_date)
        : new Date(p.created_at);
      const now = new Date();
      const months = (now.getTime() - acquired.getTime()) / (1000 * 60 * 60 * 24 * 30);
      const term = months > 12 ? "LT" : "ST";
      const unrealizedPnl = dp?.unrealized ?? p.total_gain;
      const costBasis = dp?.cost_basis ?? p.cost_basis;
      return { ...p, term, acquired, unrealizedPnl, costBasis };
    });

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="text-ink-4 text-sm">Loading…</span></div>;
  }

  return (
    <div className="max-w-[1200px] mx-auto px-8 pb-16">
      {/* ── Editorial header ─────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-8 py-10 border-b border-parchment-border">
        <div className="col-span-3">
          <p className="section-label mb-3">§ 02 — Holdings Register</p>
          <h1 className="font-serif text-6xl text-ink leading-tight mb-1">
            {n > 0 ? toWords(n) + " position" + (n !== 1 ? "s," : ",") : "No positions,"}
          </h1>
          <h1 className="font-serif text-6xl text-ink italic leading-tight mb-5">one mandate.</h1>
          <p className="text-ink-3 text-sm leading-relaxed max-w-lg">
            Every line below earns its keep against three filters: cost (expense ratio under 25 bps),
            liquidity (median spread under 2 bps), and a defensible role in either compounding or cushioning.
          </p>
        </div>
        <div className="col-span-2 flex items-center gap-8 pl-8 border-l border-parchment-border">
          <div>
            <p className="section-label mb-1">Positions</p>
            <p className="font-sans font-semibold text-4xl text-ink">{n}</p>
          </div>
          <div>
            <p className="section-label mb-1">Wtd. ER</p>
            <p className="font-sans font-semibold text-4xl text-ink">0.07%</p>
          </div>
          <div>
            <p className="section-label mb-1">Aggregate</p>
            <p className="font-sans font-semibold text-2xl text-ink">${Math.round(totalValue).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* ── §01 By Category ─────────────────────────────────── */}
      <SectionHeader num="01" title="By Category" right="vs Target Glidepath" />
      <div className="flex h-4 rounded overflow-hidden mb-3 border border-parchment-border">
        {Object.entries(categoryTotals).map(([cat, val]) => (
          <div
            key={cat}
            style={{ width: `${(val / totalMV) * 100}%`, backgroundColor: bucketColors[cat] ?? "#9B9088" }}
            title={`${cat}: ${((val / totalMV) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mb-1">
        {Object.entries(categoryTotals).map(([cat, val]) => (
          <span key={cat} className="flex items-center gap-1 text-2xs text-ink-3">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: bucketColors[cat] ?? "#9B9088" }} />
            {cat} {((val / totalMV) * 100).toFixed(1)}%
          </span>
        ))}
      </div>

      {/* ── §02 Position Detail ─────────────────────────────── */}
      <SectionHeader
        num="02"
        title="Position Detail"
        right={`${String(n).padStart(2, "0")} of ${String(n).padStart(2, "0")} Positions · As of ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ET`}
      />

      <div className="flex items-center justify-between mb-3">
        <span className="text-ink-4 text-xs">All positions in USD · Market value at last trade</span>
        <button
          onClick={onAddPosition}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-ink text-parchment text-xs font-medium rounded hover:bg-ink-2 transition-colors"
        >
          <Plus size={11} />
          Add Position
        </button>
      </div>

      <div className="border border-parchment-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-parchment-dark border-b border-parchment-border">
                <Th label="TICKER" col="symbol" />
                <Th label="NAME" col="name" />
                <th className="px-3 py-2 section-label text-left whitespace-nowrap">CATEGORY</th>
                <Th label="SHARES" col="shares" right />
                <Th label="LAST" col="current_price" right />
                <Th label="AVG COST" col="avg_cost" right />
                <Th label="MKT VALUE" col="market_value" right />
                <th className="px-3 py-2 section-label text-left whitespace-nowrap">WT % DRIFT</th>
                <Th label="YTD" col="total_gain_pct" right />
                <Th label="DAY ∆" col="day_gain_pct" right />
                <Th label="TOTAL GAIN" col="total_gain" right />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-ink-4 text-sm">
                    No positions yet.{" "}
                    <button onClick={onAddPosition} className="underline text-ink-2">Add the first one</button>
                  </td>
                </tr>
              ) : (
                sorted.map((p) => {
                  const wt = ((p.market_value ?? 0) / totalMV) * 100;
                  const dayPos = (p.day_gain_pct ?? 0) >= 0;
                  const totalPos = (p.total_gain ?? 0) >= 0;
                  return (
                    <tr key={p.id} className="border-b border-parchment-border last:border-b-0 hover:bg-parchment/60 transition-colors group">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onEditPosition(p)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-4 hover:text-ink transition-opacity"
                            title="Edit"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={() => handleDelete(p.id)}
                            disabled={deleting === p.id}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-4 hover:text-negative transition-opacity disabled:opacity-50"
                            title="Delete"
                          >
                            <Trash2 size={11} />
                          </button>
                          <span className="font-mono font-semibold text-xs text-ink">{p.symbol}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-3 max-w-[160px] truncate">{p.name ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-4 whitespace-nowrap">{getCategory(p)}</td>
                      <td className="px-3 py-2.5 text-xs text-right text-ink">{p.shares.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-xs text-right font-medium text-ink">
                        {p.current_price != null ? `$${fmt(p.current_price)}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-right text-ink-3">${fmt(p.avg_cost)}</td>
                      <td className="px-3 py-2.5 text-xs text-right font-medium text-ink">
                        {p.market_value != null ? `$${fmt(p.market_value)}` : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <DriftBar wt={wt} target={targetWt} />
                      </td>
                      <td className={`px-3 py-2.5 text-xs text-right font-medium ${totalPos ? "pos" : "neg"}`}>
                        {p.total_gain_pct != null ? `${sign(p.total_gain_pct)}${fmt(p.total_gain_pct)}%` : "—"}
                      </td>
                      <td className={`px-3 py-2.5 text-xs text-right ${dayPos ? "pos" : "neg"}`}>
                        {p.day_gain_pct != null ? `${sign(p.day_gain_pct)}${fmt(p.day_gain_pct)}%` : "—"}
                      </td>
                      <td className={`px-3 py-2.5 text-xs text-right font-medium ${totalPos ? "pos" : "neg"}`}>
                        {p.total_gain != null ? `${sign(p.total_gain)}$${fmt(Math.abs(p.total_gain))}` : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="bg-parchment-dark border-t border-parchment-border">
                  <td colSpan={3} className="px-3 py-2 text-xs font-semibold text-ink section-label">PORTFOLIO TOTAL</td>
                  <td className="px-3 py-2 text-xs text-right text-ink-3">—</td>
                  <td className="px-3 py-2 text-xs text-right text-ink-3">—</td>
                  <td className="px-3 py-2 text-xs text-right text-ink-3">${fmt(totalCost)}</td>
                  <td className="px-3 py-2 text-xs text-right font-semibold text-ink">${fmt(totalValue)}</td>
                  <td className="px-3 py-2 text-xs text-right text-ink-3">100.0%</td>
                  <td className={`px-3 py-2 text-xs text-right font-semibold ${(summary?.total_gain_pct ?? 0) >= 0 ? "pos" : "neg"}`}>
                    {summary?.total_gain_pct != null ? `${sign(summary.total_gain_pct)}${fmt(summary.total_gain_pct)}%` : "—"}
                  </td>
                  <td className={`px-3 py-2 text-xs text-right ${(summary?.day_gain_pct ?? 0) >= 0 ? "pos" : "neg"}`}>
                    {summary?.day_gain_pct != null ? `${sign(summary.day_gain_pct)}${fmt(summary.day_gain_pct)}%` : "—"}
                  </td>
                  <td className={`px-3 py-2 text-xs text-right font-semibold ${(summary?.total_gain ?? 0) >= 0 ? "pos" : "neg"}`}>
                    {summary?.total_gain != null ? `${sign(summary.total_gain)}$${fmt(Math.abs(summary.total_gain))}` : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── §03 Tax-Lot Status ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-8 mt-0">
        <div>
          <SectionHeader num="03" title="Tax-Lot Status" right="Top 4 by Unrealized P/L" />
          <div className="border border-parchment-border rounded overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-parchment-dark border-b border-parchment-border">
                  {["TICKER", "LOT · ACQUIRED", "COST BASIS", "UNREAL. P/L", "TERM", "WASH RISK"].map((h) => (
                    <th key={h} className="px-3 py-2 section-label text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {taxLots.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-ink-4 text-xs">No data</td></tr>
                ) : (
                  taxLots.map((p) => {
                    const pos = (p.unrealizedPnl ?? 0) >= 0;
                    return (
                      <tr key={p.id} className="border-b border-parchment-border last:border-b-0">
                        <td className="px-3 py-2.5 font-mono font-medium text-xs text-ink">{p.symbol}</td>
                        <td className="px-3 py-2.5 text-xs text-ink-3">
                          {p.acquired.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-ink">${fmt(p.costBasis)}</td>
                        <td className={`px-3 py-2.5 text-xs font-medium ${pos ? "pos" : "neg"}`}>
                          {p.unrealizedPnl != null ? `${sign(p.unrealizedPnl)}$${fmt(Math.abs(p.unrealizedPnl))}` : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${p.term === "LT" ? "bg-parchment-dark text-ink-3" : "bg-parchment-dark text-ink-2"}`}>
                            {p.term}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-ink-4">— clear</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── §04 Cost · Quality · Liquidity ───────────────── */}
        <div>
          <SectionHeader num="04" title="Cost · Quality · Liquidity" right="Bps Where Applicable" />
          <div className="grid grid-cols-2 gap-px bg-parchment-border border border-parchment-border rounded overflow-hidden">
            {[
              { label: "Wtd. Expense Ratio", value: "7.0 bps", sub: "vs ind. avg 47 bps" },
              { label: "Median Bid/Ask", value: "1.4 bps", sub: "all positions" },
              { label: "AUM (Smallest)", value: "$2.1 B", sub: "IAU sleeve" },
              { label: "Tracking Error", value: "0.18%", sub: "vs stated index" },
              { label: "Securities-Lending", value: "0", sub: "opted out" },
              { label: "Domicile", value: "US 96%", sub: "Ireland 4%" },
            ].map((item) => (
              <div key={item.label} className="bg-card-bg p-4">
                <p className="section-label mb-1">{item.label}</p>
                <p className="font-sans font-semibold text-xl text-ink leading-tight">{item.value}</p>
                <p className="text-ink-4 text-xs mt-0.5">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom bar ─────────────────────────────────────── */}
      <div className="mt-12 pt-4 border-t border-parchment-border flex items-center justify-between">
        <span className="section-label">Ledger &amp; Lever — Personal · Page rendered {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ET</span>
        <span className="section-label">Data: NYSE TAQ · ICE BofA · Bloomberg BBALT · Lipper</span>
        <span className="section-label">For informational use only. Not investment advice.</span>
      </div>
    </div>
  );
}

function toWords(n: number): string {
  const words = ["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
    "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen","Twenty"];
  return words[n] ?? String(n);
}
