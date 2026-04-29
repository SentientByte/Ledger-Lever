import { useState, useEffect, useRef } from "react";
import { X, Search, Loader2 } from "lucide-react";
import { addPosition, updatePosition, validateSymbol } from "../api/portfolio";
import type { Position, PositionCreate } from "../types";

interface Props {
  editing: Position | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function AddPositionModal({ editing, onClose, onSaved }: Props) {
  const [symbol, setSymbol] = useState(editing?.symbol ?? "");
  const [shares, setShares] = useState(editing ? String(editing.shares) : "");
  const [avgCost, setAvgCost] = useState(editing ? String(editing.avg_cost) : "");
  const [validating, setValidating] = useState(false);
  const [symbolInfo, setSymbolInfo] = useState<{ name: string; price: number } | null>(null);
  const [symbolError, setSymbolError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) {
      setSymbolInfo({ name: editing.name ?? editing.symbol, price: editing.current_price ?? 0 });
    }
  }, [editing]);

  function handleSymbolChange(val: string) {
    setSymbol(val.toUpperCase());
    setSymbolInfo(null);
    setSymbolError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 1) return;
    debounceRef.current = setTimeout(async () => {
      setValidating(true);
      try {
        const info = await validateSymbol(val.toUpperCase());
        setSymbolInfo(info);
      } catch {
        setSymbolError(`"${val.toUpperCase()}" not found`);
      } finally {
        setValidating(false);
      }
    }, 600);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const sharesNum = parseFloat(shares);
    const costNum = parseFloat(avgCost);
    if (isNaN(sharesNum) || sharesNum <= 0) {
      setError("Shares must be a positive number");
      return;
    }
    if (isNaN(costNum) || costNum <= 0) {
      setError("Average cost must be a positive number");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updatePosition(editing.id, { shares: sharesNum, avg_cost: costNum });
      } else {
        if (!symbolInfo) {
          setError("Please wait for symbol validation");
          setSaving(false);
          return;
        }
        const body: PositionCreate = {
          symbol: symbol.toUpperCase(),
          shares: sharesNum,
          avg_cost: costNum,
        };
        await addPosition(body);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to save position";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-card border border-surface-border rounded-2xl w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h2 className="text-base font-semibold text-slate-100">
            {editing ? "Edit Position" : "Add Position"}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Symbol */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Ticker Symbol</label>
            <div className="relative">
              <input
                type="text"
                value={symbol}
                onChange={(e) => !editing && handleSymbolChange(e.target.value)}
                disabled={!!editing}
                placeholder="e.g. AAPL"
                required
                className="w-full bg-slate-800 border border-surface-border rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 disabled:opacity-50 pr-8"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {validating && <Loader2 size={14} className="text-slate-400 animate-spin" />}
                {!validating && !symbolError && symbolInfo && (
                  <Search size={14} className="text-green-400" />
                )}
              </span>
            </div>
            {symbolInfo && (
              <p className="mt-1 text-xs text-green-400">
                {symbolInfo.name} — ${symbolInfo.price.toFixed(2)}
              </p>
            )}
            {symbolError && <p className="mt-1 text-xs text-red-400">{symbolError}</p>}
          </div>

          {/* Shares */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Shares</label>
            <input
              type="number"
              step="any"
              min="0.000001"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="e.g. 10"
              required
              className="w-full bg-slate-800 border border-surface-border rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Average cost */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Average Cost Per Share ($)</label>
            <input
              type="number"
              step="any"
              min="0.000001"
              value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)}
              placeholder="e.g. 150.00"
              required
              className="w-full bg-slate-800 border border-surface-border rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {shares && avgCost && (
            <div className="text-xs text-slate-500">
              Total cost basis:{" "}
              <span className="text-slate-300 font-medium">
                ${(parseFloat(shares || "0") * parseFloat(avgCost || "0")).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-slate-400 hover:text-slate-200 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!editing && (!symbolInfo || !!symbolError))}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editing ? "Save Changes" : "Add Position"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
