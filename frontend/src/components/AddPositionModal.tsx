import { useState, useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";
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
    if (isNaN(sharesNum) || sharesNum <= 0) { setError("Shares must be a positive number"); return; }
    if (isNaN(costNum) || costNum <= 0) { setError("Average cost must be a positive number"); return; }
    setSaving(true);
    try {
      if (editing) {
        await updatePosition(editing.id, { shares: sharesNum, avg_cost: costNum });
      } else {
        if (!symbolInfo) { setError("Please wait for symbol validation"); setSaving(false); return; }
        const body: PositionCreate = { symbol: symbol.toUpperCase(), shares: sharesNum, avg_cost: costNum };
        await addPosition(body);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to save position";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm">
      <div className="bg-card-bg border border-parchment-border rounded w-full max-w-md mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-parchment-border">
          <div>
            <p className="section-label mb-0.5">{editing ? "Edit Position" : "Add Position"}</p>
            <h2 className="font-serif text-xl text-ink">{editing ? editing.symbol : "New holding"}</h2>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Symbol */}
          <div>
            <label className="block section-label mb-1.5">Ticker Symbol</label>
            <div className="relative">
              <input
                type="text"
                value={symbol}
                onChange={(e) => !editing && handleSymbolChange(e.target.value)}
                disabled={!!editing}
                placeholder="e.g. VTI"
                required
                className="w-full bg-parchment border border-parchment-border rounded px-3 py-2 text-ink text-sm placeholder-ink-5 focus:outline-none focus:border-ink-3 disabled:opacity-50 pr-8 font-mono"
              />
              {validating && (
                <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-4 animate-spin" />
              )}
            </div>
            {symbolInfo && (
              <p className="mt-1 text-xs pos">{symbolInfo.name} — ${symbolInfo.price.toFixed(2)}</p>
            )}
            {symbolError && <p className="mt-1 text-xs neg">{symbolError}</p>}
          </div>

          {/* Shares */}
          <div>
            <label className="block section-label mb-1.5">Shares</label>
            <input
              type="number" step="any" min="0.000001"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="e.g. 100"
              required
              className="w-full bg-parchment border border-parchment-border rounded px-3 py-2 text-ink text-sm placeholder-ink-5 focus:outline-none focus:border-ink-3"
            />
          </div>

          {/* Avg cost */}
          <div>
            <label className="block section-label mb-1.5">Average Cost Per Share ($)</label>
            <input
              type="number" step="any" min="0.000001"
              value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)}
              placeholder="e.g. 218.40"
              required
              className="w-full bg-parchment border border-parchment-border rounded px-3 py-2 text-ink text-sm placeholder-ink-5 focus:outline-none focus:border-ink-3"
            />
          </div>

          {shares && avgCost && (
            <div className="text-xs text-ink-4 border border-parchment-border rounded px-3 py-2 bg-parchment">
              Cost basis:&nbsp;
              <span className="text-ink font-medium">
                ${(parseFloat(shares || "0") * parseFloat(avgCost || "0")).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {error && (
            <p className="text-xs neg border border-negative/20 bg-negative-bg rounded px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded border border-parchment-border text-ink-3 hover:text-ink text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!editing && (!symbolInfo || !!symbolError))}
              className="flex-1 px-4 py-2 rounded bg-ink hover:bg-ink-2 disabled:opacity-40 text-parchment text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {editing ? "Save Changes" : "Add Position"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
