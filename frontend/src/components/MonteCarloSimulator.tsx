import { useMemo, useState } from "react";
import type { Position, BarsResult } from "../types";
import {
  buildSimAsset,
  correlationMatrix,
  runMonteCarlo,
  computeMetrics,
  histogramData,
  type SimAsset,
  type MacroState,
  type SimResult,
} from "../utils/montecarlo";

interface Props {
  positions: Position[];
  barsData: BarsResult;
}

const BENCHMARKS = ["SPY", "QQQ", "AGG", "IEF"];
const DEFAULT_MACRO: MacroState = {
  rateShock: 0,
  macroSlowdown: 0,
  bubbleRisk: 0.3,
  oilShock: 0,
  goldShock: 0,
};

const fmtPct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const fmtPctSigned = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

type WeightMap = Record<string, number>;

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

/* ── Return-distribution histogram (parchment theme) ─────────────────────── */
function Histogram({ result, color }: { result: SimResult; color: string }) {
  const data = result.hist;
  const varLine = -result.metrics.var95;
  const width = 520, height = 200;
  const maxFreq = Math.max(...data.map((d) => d.freq), 0.0001);
  const minX = data[0]?.x0 ?? -0.5;
  const maxX = data[data.length - 1]?.x1 ?? 0.5;
  const xScale = (x: number) => ((x - minX) / (maxX - minX || 1)) * (width - 40) + 30;
  const yScale = (f: number) => height - 26 - (f / maxFreq) * (height - 46);
  const zeroX = xScale(0);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      <line x1="30" y1={height - 26} x2={width - 10} y2={height - 26} stroke="#D8CFBF" strokeWidth="1" />
      {zeroX >= 30 && zeroX <= width - 10 && (
        <line x1={zeroX} y1="8" x2={zeroX} y2={height - 26} stroke="#C8BFB3" strokeWidth="1" strokeDasharray="3,3" />
      )}
      {data.map((d, i) => {
        const x = xScale(d.x0);
        const w = Math.max(1, xScale(d.x1) - xScale(d.x0) - 1);
        const y = yScale(d.freq);
        const barColor = d.x1 <= 0 ? "#B81C1C" : color;
        return <rect key={i} x={x} y={y} width={w} height={height - 26 - y} fill={barColor} opacity={0.85} />;
      })}
      {varLine > minX && varLine < maxX && (
        <>
          <line x1={xScale(varLine)} y1="6" x2={xScale(varLine)} y2={height - 26} stroke="#B8860B" strokeWidth="1.5" strokeDasharray="5,3" />
          <text x={xScale(varLine)} y="14" fill="#B8860B" fontSize="9" textAnchor="middle" fontFamily="ui-monospace, monospace">VaR95</text>
        </>
      )}
      <text x={zeroX} y={height - 10} fill="#9B9088" fontSize="9" textAnchor="middle" fontFamily="ui-monospace, monospace">0%</text>
      <text x="30" y={height - 10} fill="#9B9088" fontSize="9" textAnchor="start" fontFamily="ui-monospace, monospace">{fmtPct(minX, 0)}</text>
      <text x={width - 10} y={height - 10} fill="#9B9088" fontSize="9" textAnchor="end" fontFamily="ui-monospace, monospace">{fmtPct(maxX, 0)}</text>
    </svg>
  );
}

function Slider({
  label, sub, value, min, max, step, display, onChange,
}: {
  label: string; sub: string; value: number; min: number; max: number; step: number; display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink">{label}</span>
      <span className="text-2xs text-ink-4 leading-tight min-h-[28px]">{sub}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-ink"
      />
      <span className="font-mono text-xs text-ink-2">{display}</span>
    </div>
  );
}

export default function MonteCarloSimulator({ positions, barsData }: Props) {
  const [nSims, setNSims] = useState(10000);
  const [seed, setSeed] = useState(42);
  const [riskFree, setRiskFree] = useState(0.045);
  const [macro, setMacro] = useState<MacroState>(DEFAULT_MACRO);
  const [view, setView] = useState<"current" | "proposed" | "compare">("current");

  // ── Asset universe: held symbols + available benchmark ETFs ────────────────
  const spyBars = barsData["SPY"] ?? [];

  const universe = useMemo(() => {
    const seen = new Set<string>();
    const list: { symbol: string; name: string | null }[] = [];
    for (const p of positions) {
      const s = p.symbol.toUpperCase();
      if (!seen.has(s)) { seen.add(s); list.push({ symbol: s, name: p.name }); }
    }
    for (const b of BENCHMARKS) {
      if (!seen.has(b) && (barsData[b]?.length ?? 0) > 0) { seen.add(b); list.push({ symbol: b, name: b }); }
    }
    return list;
  }, [positions, barsData]);

  const assets = useMemo(() => {
    const map = new Map<string, SimAsset>();
    for (const u of universe) {
      map.set(u.symbol, buildSimAsset(u.symbol, u.name, barsData[u.symbol] ?? [], spyBars, riskFree));
    }
    return map;
  }, [universe, barsData, spyBars, riskFree]);

  // Current weights = market-value weights of real holdings.
  const currentWeights: WeightMap = useMemo(() => {
    const totalMV = positions.reduce((s, p) => s + (p.market_value ?? 0), 0) || 1;
    const w: WeightMap = {};
    for (const p of positions) {
      const s = p.symbol.toUpperCase();
      w[s] = (w[s] ?? 0) + (p.market_value ?? 0) / totalMV;
    }
    return w;
  }, [positions]);

  const [proposedWeights, setProposedWeights] = useState<WeightMap | null>(null);
  const proposed = proposedWeights ?? currentWeights;

  function setProposed(sym: string, pct: number) {
    setProposedWeights({ ...proposed, [sym]: pct / 100 });
  }
  function removeProposed(sym: string) {
    const next = { ...proposed };
    delete next[sym];
    setProposedWeights(next);
  }
  function addProposed(sym: string) {
    setProposedWeights({ ...proposed, [sym]: 0.02 });
  }
  function normalizeProposed() {
    const sum = Object.values(proposed).reduce((a, b) => a + b, 0);
    if (sum <= 0) return;
    const next: WeightMap = {};
    for (const [k, v] of Object.entries(proposed)) next[k] = v / sum;
    setProposedWeights(next);
  }

  // ── Build sim inputs (assets/weights/corr) for an active weight map ────────
  function prepare(weights: WeightMap) {
    const symbols = Object.keys(weights).filter((s) => weights[s] > 1e-5 && assets.has(s));
    const a = symbols.map((s) => assets.get(s)!);
    const w = symbols.map((s) => weights[s]);
    const corr = correlationMatrix(symbols, barsData);
    const wsum = w.reduce((x, y) => x + y, 0) || 1;
    const beta = a.reduce((acc, asset, i) => acc + (w[i] / wsum) * asset.beta, 0);
    return { symbols, assets: a, weights: w, corr, beta };
  }

  function simulate(weights: WeightMap, seedOffset: number): SimResult | null {
    const prep = prepare(weights);
    if (prep.assets.length === 0) return null;
    const returns = runMonteCarlo({
      assets: prep.assets, weights: prep.weights, corr: prep.corr,
      nSims, horizonYears: 1, macro, seed: seed + seedOffset,
    });
    if (!returns) return null;
    return { metrics: computeMetrics(returns, prep.beta, riskFree), hist: histogramData(returns, 44), returns };
  }

  const currentResult = useMemo(
    () => simulate(currentWeights, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentWeights, assets, nSims, seed, riskFree, macro, barsData]
  );
  const proposedResult = useMemo(
    () => simulate(proposed, 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposed, assets, nSims, seed, riskFree, macro, barsData]
  );

  const currentTotalW = Object.values(currentWeights).reduce((a, b) => a + b, 0);
  const proposedTotalW = Object.values(proposed).reduce((a, b) => a + b, 0);

  if (positions.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 border border-parchment-border rounded">
        <p className="text-ink-4 text-sm">Load positions to run the Monte-Carlo simulator.</p>
      </div>
    );
  }

  const addable = universe.filter((u) => !(u.symbol in proposed));

  return (
    <div>
      {/* Controls */}
      <div className="border border-parchment-border rounded bg-card-bg p-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
          <Slider
            label="Interest-rate shock" sub="− cuts (tailwind) · + hikes (headwind)"
            value={macro.rateShock} min={-2} max={2} step={0.1}
            display={`${macro.rateShock >= 0 ? "+" : ""}${macro.rateShock.toFixed(1)}`}
            onChange={(v) => setMacro({ ...macro, rateShock: v })}
          />
          <Slider
            label="Macro slowdown" sub="0 none · 2 severe, scaled by β"
            value={macro.macroSlowdown} min={0} max={2} step={0.1}
            display={macro.macroSlowdown.toFixed(1)}
            onChange={(v) => setMacro({ ...macro, macroSlowdown: v })}
          />
          <Slider
            label="AI / tech bubble risk" sub={`correction prob ≈ ${(Math.min(0.35, 0.04 + 0.12 * macro.bubbleRisk) * 100).toFixed(0)}%`}
            value={macro.bubbleRisk} min={0} max={1} step={0.05}
            display={`${(macro.bubbleRisk * 100).toFixed(0)}%`}
            onChange={(v) => setMacro({ ...macro, bubbleRisk: v })}
          />
          <Slider
            label="Oil price shock" sub="− collapse · + spike"
            value={macro.oilShock} min={-2} max={2} step={0.1}
            display={`${macro.oilShock >= 0 ? "+" : ""}${macro.oilShock.toFixed(1)}`}
            onChange={(v) => setMacro({ ...macro, oilShock: v })}
          />
          <Slider
            label="Gold price shock" sub="+ gold rallies (risk-off)"
            value={macro.goldShock} min={-2} max={2} step={0.1}
            display={`${macro.goldShock >= 0 ? "+" : ""}${macro.goldShock.toFixed(1)}`}
            onChange={(v) => setMacro({ ...macro, goldShock: v })}
          />
        </div>
        <div className="flex items-end gap-5 mt-5 pt-4 border-t border-parchment-border flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="section-label">Risk-free rate</span>
            <input
              type="number" step="0.005" value={riskFree}
              onChange={(e) => setRiskFree(parseFloat(e.target.value) || 0)}
              className="w-24 px-2 py-1 text-xs font-mono border border-parchment-border rounded bg-parchment"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="section-label">Simulations</span>
            <select
              value={nSims} onChange={(e) => setNSims(parseInt(e.target.value))}
              className="px-2 py-1 text-xs font-mono border border-parchment-border rounded bg-parchment"
            >
              {[5000, 10000, 20000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="section-label">Seed</span>
            <input
              type="number" value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
              className="w-24 px-2 py-1 text-xs font-mono border border-parchment-border rounded bg-parchment"
            />
          </label>
          <button
            onClick={() => setSeed(seed + 1)}
            className="px-3 py-1.5 text-xs border border-parchment-border rounded text-ink-3 hover:bg-parchment-dark"
          >
            Re-roll seed
          </button>
          <button
            onClick={() => { setMacro(DEFAULT_MACRO); setProposedWeights(null); }}
            className="px-3 py-1.5 text-xs border border-parchment-border rounded text-ink-3 hover:bg-parchment-dark"
          >
            Reset
          </button>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-2 mt-4">
        {(["current", "proposed", "compare"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={[
              "px-4 py-1.5 text-2xs font-medium tracking-widest uppercase rounded-full border transition-colors",
              view === v ? "bg-ink text-parchment border-ink" : "border-parchment-border text-ink-4 hover:text-ink-2",
            ].join(" ")}
          >
            {v === "current" ? "Current" : v === "proposed" ? "Proposed" : "Side-by-Side"}
          </button>
        ))}
      </div>

      {/* Weights editor (current/proposed) */}
      {view !== "compare" && (
        <WeightsPanel
          editable={view === "proposed"}
          weights={view === "current" ? currentWeights : proposed}
          assets={assets}
          totalW={view === "current" ? currentTotalW : proposedTotalW}
          onChange={setProposed}
          onRemove={removeProposed}
          onNormalize={normalizeProposed}
          onReset={() => setProposedWeights(null)}
          addable={addable}
          onAdd={addProposed}
        />
      )}

      {/* Results */}
      {view === "current" && currentResult && <ResultsView title="Current Portfolio" result={currentResult} color="#1A1611" />}
      {view === "proposed" && proposedResult && <ResultsView title="Proposed Portfolio" result={proposedResult} color="#3D5A8A" />}
      {view === "compare" && currentResult && proposedResult && (
        <CompareView current={currentResult} proposed={proposedResult} />
      )}

      <p className="text-2xs text-ink-4 mt-4 leading-relaxed">
        Engine: geometric Brownian motion with Cholesky-correlated shocks (realized correlations from 2-yr daily bars)
        plus a bubble-driven correction tail and linear macro adjustments. σ and β are derived from each holding's price
        history; μ uses CAPM (risk-free + β·5% equity premium). A decision-support tool, not a forecast — not investment advice.
      </p>
    </div>
  );
}

/* ── Weights panel ─────────────────────────────────────────────────────────── */
function WeightsPanel({
  editable, weights, assets, totalW, onChange, onRemove, onNormalize, onReset, addable, onAdd,
}: {
  editable: boolean;
  weights: WeightMap;
  assets: Map<string, SimAsset>;
  totalW: number;
  onChange: (s: string, pct: number) => void;
  onRemove: (s: string) => void;
  onNormalize: () => void;
  onReset: () => void;
  addable: { symbol: string; name: string | null }[];
  onAdd: (s: string) => void;
}) {
  const rows = Object.keys(weights).filter((s) => weights[s] > 1e-5).sort((a, b) => weights[b] - weights[a]);
  const balanced = Math.abs(totalW - 1) < 0.005;
  return (
    <div className="border border-parchment-border rounded bg-card-bg p-5 mt-4">
      <div className="flex items-center justify-between mb-3">
        <span className="section-label">{editable ? "Proposed weights — editable" : "Current weights — market value"}</span>
        <span className={`text-xs font-mono px-2 py-0.5 rounded ${balanced ? "text-positive" : "neg"}`}>
          total {fmtPct(totalW)}
        </span>
      </div>
      {editable && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button onClick={onNormalize} className="px-3 py-1 text-2xs border border-parchment-border rounded text-ink-3 hover:bg-parchment-dark">Normalize to 100%</button>
          <button onClick={onReset} className="px-3 py-1 text-2xs border border-parchment-border rounded text-ink-3 hover:bg-parchment-dark">Reset to current</button>
          {addable.length > 0 && (
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { onAdd(e.target.value); e.target.value = ""; } }}
              className="px-2 py-1 text-2xs font-mono border border-parchment-border rounded bg-parchment text-ink-3"
            >
              <option value="">+ add symbol…</option>
              {addable.map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol}</option>)}
            </select>
          )}
        </div>
      )}
      <div className="space-y-1">
        {rows.map((s) => {
          const a = assets.get(s);
          const pct = weights[s] * 100;
          return (
            <div key={s} className="flex items-center gap-3 py-1">
              <div className="w-32 shrink-0">
                <span className="font-mono font-medium text-xs text-ink">{s}</span>
                {a && <span className="text-2xs text-ink-4 ml-2">{!a.sourced ? "est." : `σ ${fmtPct(a.sigma)} · β ${a.beta.toFixed(2)}`}</span>}
              </div>
              {editable ? (
                <input
                  type="range" min={0} max={60} step={0.5} value={pct}
                  onChange={(e) => onChange(s, parseFloat(e.target.value))}
                  className="flex-1 accent-ink"
                />
              ) : (
                <div className="flex-1 h-1.5 bg-parchment-dark rounded overflow-hidden">
                  <div className="h-full bg-ink rounded" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              )}
              <span className="w-14 text-right font-mono text-xs text-ink">{pct.toFixed(1)}%</span>
              {editable ? (
                <button onClick={() => onRemove(s)} className="w-6 text-ink-4 hover:text-negative text-xs" title={`Remove ${s}`}>×</button>
              ) : (
                <span className="w-6" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Results view ──────────────────────────────────────────────────────────── */
function Kpi({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="bg-card-bg border border-parchment-border rounded p-3">
      <p className="section-label mb-1">{label}</p>
      <p className={`font-mono font-bold text-lg ${cls ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

function ResultsView({ title, result, color }: { title: string; result: SimResult; color: string }) {
  const m = result.metrics;
  const riskCells: [string, string, string][] = [
    ["VaR 95%", fmtPct(m.var95), "Loss not exceeded 95% of the time"],
    ["VaR 99%", fmtPct(m.var99), "Loss not exceeded 99% of the time"],
    ["CVaR 95%", fmtPct(m.cvar95), "Avg loss in the worst 5% of paths"],
    ["CVaR 99%", fmtPct(m.cvar99), "Avg loss in the worst 1% of paths"],
    ["Sharpe", m.sharpe.toFixed(2), "Return per unit of total vol"],
    ["Sortino", m.sortino.toFixed(2), "Return per unit of downside vol"],
    ["Portfolio β", m.beta.toFixed(2), "Weighted sensitivity to the market"],
    ["P(severe loss >20%)", fmtPct(m.probSevereLoss), "Share of sims losing >20%"],
    ["Skewness", m.skew.toFixed(2), "Negative = fatter loss tail"],
    ["Excess kurtosis", m.kurt.toFixed(2), "Higher = fatter tails than normal"],
    ["Worst path", fmtPctSigned(m.worst), "Single worst simulated outcome"],
    ["Best path", fmtPctSigned(m.best), "Single best simulated outcome"],
  ];
  return (
    <div className="mt-4">
      <p className="section-label mb-3">{title} — 12-Month Outcome Distribution</p>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
        <Kpi label="Expected (mean)" value={fmtPctSigned(m.mean)} cls={m.mean >= 0 ? "pos" : "neg"} />
        <Kpi label="Median" value={fmtPctSigned(m.median)} />
        <Kpi label="Volatility (σ)" value={fmtPct(m.sigma)} />
        <Kpi label="P75 upper" value={fmtPctSigned(m.p75)} cls="pos" />
        <Kpi label="P25 lower" value={fmtPctSigned(m.p25)} cls="neg" />
        <Kpi label="Prob. of loss" value={fmtPct(m.probLoss)} />
      </div>
      <div className="border border-parchment-border rounded bg-card-bg p-3 mb-4">
        <p className="text-2xs text-ink-4 mb-1 font-mono">Distribution of simulated 12-month returns</p>
        <Histogram result={result} color={color} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {riskCells.map(([label, value, desc]) => (
          <div key={label} className="bg-card-bg border border-parchment-border rounded p-3">
            <p className="section-label mb-0.5">{label}</p>
            <p className="font-mono font-bold text-base text-ink mb-0.5">{value}</p>
            <p className="text-2xs text-ink-4 leading-tight">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Compare view ──────────────────────────────────────────────────────────── */
function CompareView({ current, proposed }: { current: SimResult; proposed: SimResult }) {
  const cm = current.metrics, pm = proposed.metrics;
  const rows: [string, string, string, number, boolean | null][] = [
    ["Expected return (mean)", fmtPctSigned(cm.mean), fmtPctSigned(pm.mean), pm.mean - cm.mean, true],
    ["Median return", fmtPctSigned(cm.median), fmtPctSigned(pm.median), pm.median - cm.median, true],
    ["Volatility (σ)", fmtPct(cm.sigma), fmtPct(pm.sigma), pm.sigma - cm.sigma, false],
    ["VaR 95%", fmtPct(cm.var95), fmtPct(pm.var95), pm.var95 - cm.var95, false],
    ["CVaR 95%", fmtPct(cm.cvar95), fmtPct(pm.cvar95), pm.cvar95 - cm.cvar95, false],
    ["Sharpe ratio", cm.sharpe.toFixed(2), pm.sharpe.toFixed(2), pm.sharpe - cm.sharpe, true],
    ["Sortino ratio", cm.sortino.toFixed(2), pm.sortino.toFixed(2), pm.sortino - cm.sortino, true],
    ["Portfolio β", cm.beta.toFixed(2), pm.beta.toFixed(2), pm.beta - cm.beta, null],
    ["Prob. of any loss", fmtPct(cm.probLoss), fmtPct(pm.probLoss), pm.probLoss - cm.probLoss, false],
    ["Prob. severe loss (>20%)", fmtPct(cm.probSevereLoss), fmtPct(pm.probSevereLoss), pm.probSevereLoss - cm.probSevereLoss, false],
    ["Worst simulated path", fmtPctSigned(cm.worst), fmtPctSigned(pm.worst), pm.worst - cm.worst, true],
  ];
  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="border border-parchment-border rounded bg-card-bg p-3">
          <p className="text-2xs font-mono mb-1" style={{ color: "#1A1611" }}>■ Current portfolio</p>
          <Histogram result={current} color="#1A1611" />
        </div>
        <div className="border border-parchment-border rounded bg-card-bg p-3">
          <p className="text-2xs font-mono mb-1" style={{ color: "#3D5A8A" }}>■ Proposed portfolio</p>
          <Histogram result={proposed} color="#3D5A8A" />
        </div>
      </div>
      <div className="border border-parchment-border rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment-dark border-b border-parchment-border">
              {["METRIC", "CURRENT", "PROPOSED", "Δ (PROP − CUR)"].map((h, i) => (
                <th key={h} className={`px-4 py-2 section-label ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cv, pv, delta, higherIsBetter], i) => {
              const good = higherIsBetter === null ? null : higherIsBetter ? delta > 0 : delta < 0;
              const cls = good === null ? "text-ink-3" : good ? "pos" : "neg";
              const deltaStr = (delta >= 0 ? "+" : "") + (Math.abs(delta) < 5 ? delta.toFixed(2) : delta.toFixed(0));
              return (
                <tr key={label} className={`border-b border-parchment-border last:border-b-0 ${i % 2 ? "bg-parchment/40" : ""}`}>
                  <td className="px-4 py-2 text-xs text-ink-3">{label}</td>
                  <td className="px-4 py-2 text-xs text-right font-mono text-ink">{cv}</td>
                  <td className="px-4 py-2 text-xs text-right font-mono text-ink">{pv}</td>
                  <td className={`px-4 py-2 text-xs text-right font-mono ${cls}`}>{deltaStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
