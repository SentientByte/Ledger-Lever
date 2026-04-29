import { useState } from "react";
import { Pencil, Trash2, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { deletePosition } from "../api/portfolio";
import type { Position } from "../types";

interface Props {
  positions: Position[];
  onEdit: (p: Position) => void;
  onDeleted: () => void;
}

type SortKey = keyof Position;
type Dir = "asc" | "desc";

function fmt(n: number | null | undefined, decimals = 2, prefix = "") {
  if (n == null) return "—";
  return prefix + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function GainCell({ value, pct }: { value: number | null; pct: number | null }) {
  if (value == null) return <td className="px-4 py-3 text-slate-500 text-right">—</td>;
  const pos = value >= 0;
  return (
    <td className={`px-4 py-3 text-right text-sm ${pos ? "text-green-400" : "text-red-400"}`}>
      <div>{pos ? "+" : ""}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
      {pct != null && (
        <div className="text-xs opacity-75">{pos ? "+" : ""}{pct.toFixed(2)}%</div>
      )}
    </td>
  );
}

export default function HoldingsTable({ positions, onEdit, onDeleted }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<Dir>("asc");
  const [deleting, setDeleting] = useState<number | null>(null);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
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
    try {
      await deletePosition(id);
      onDeleted();
    } finally {
      setDeleting(null);
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown size={12} className="text-slate-600" />;
    return sortDir === "asc" ? (
      <ChevronUp size={12} className="text-blue-400" />
    ) : (
      <ChevronDown size={12} className="text-blue-400" />
    );
  }

  function Th({ label, col, right }: { label: string; col: SortKey; right?: boolean }) {
    return (
      <th
        className={`px-4 py-3 text-xs font-medium text-slate-500 cursor-pointer select-none whitespace-nowrap ${right ? "text-right" : "text-left"}`}
        onClick={() => toggleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <SortIcon col={col} />
        </span>
      </th>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-xl p-8 text-center">
        <p className="text-slate-500">No positions yet. Click "Add Position" to get started.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 border-b border-surface-border">
            <tr>
              <Th label="Symbol" col="symbol" />
              <Th label="Shares" col="shares" right />
              <Th label="Avg Cost" col="avg_cost" right />
              <Th label="Price" col="current_price" right />
              <Th label="Day Range" col="day_high" right />
              <Th label="Market Value" col="market_value" right />
              <Th label="Cost Basis" col="cost_basis" right />
              <Th label="Day Gain" col="day_gain" right />
              <Th label="Total Return" col="total_gain" right />
              <th className="px-4 py-3 text-xs font-medium text-slate-500 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {sorted.map((p) => (
              <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-100">{p.symbol}</div>
                  <div className="text-xs text-slate-500 truncate max-w-[140px]">{p.name ?? "—"}</div>
                </td>
                <td className="px-4 py-3 text-right text-slate-300">{p.shares.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-300">{fmt(p.avg_cost, 2, "$")}</td>
                <td className="px-4 py-3 text-right">
                  {p.current_price != null ? (
                    <span className="text-slate-100 font-medium">${p.current_price.toFixed(2)}</span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-500">
                  {p.day_high != null && p.day_low != null ? (
                    <span>
                      ${p.day_low.toFixed(2)} – ${p.day_high.toFixed(2)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-200 font-medium">
                  {fmt(p.market_value, 2, "$")}
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{fmt(p.cost_basis, 2, "$")}</td>
                <GainCell value={p.day_gain} pct={p.day_gain_pct} />
                <GainCell value={p.total_gain} pct={p.total_gain_pct} />
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => onEdit(p)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-950/40 transition-colors"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={deleting === p.id}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
