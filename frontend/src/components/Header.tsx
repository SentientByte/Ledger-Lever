type Tab = "OVERVIEW" | "HOLDINGS" | "RISK" | "PERFORMANCE" | "TRANSACTIONS" | "DOCUMENTS";

interface Props {
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
  lastUpdated: string | null;
}

const TABS: Tab[] = ["OVERVIEW", "HOLDINGS", "RISK", "PERFORMANCE", "TRANSACTIONS", "DOCUMENTS"];

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) + " ET";
}

function fmtDate(iso: string | null) {
  if (!iso) {
    return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export type { Tab };

export default function Header({ activeTab, onTabChange, lastUpdated }: Props) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) + " ET";
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <header className="bg-parchment border-b border-parchment-border sticky top-0 z-40">
      {/* Row 1: Logo · Account · Tabs · Live · Avatar */}
      <div className="flex items-stretch border-b border-parchment-border" style={{ minHeight: 44 }}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 border-r border-parchment-border shrink-0">
          <span className="text-ink text-xs">●</span>
          <span className="font-serif text-base font-medium text-ink tracking-tight whitespace-nowrap">
            Ledger &amp; Lever
          </span>
        </div>

        {/* Account badge */}
        <div className="flex items-center px-4 border-r border-parchment-border shrink-0">
          <span className="section-label whitespace-nowrap">
            Personal Portfolio&nbsp;·&nbsp;Acct #4421-08
          </span>
        </div>

        {/* Nav tabs */}
        <nav className="flex items-stretch flex-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={[
                "px-4 text-2xs font-medium tracking-widest whitespace-nowrap border-r border-parchment-border transition-colors",
                activeTab === tab
                  ? "text-ink border-b-2 border-b-ink bg-parchment-dark"
                  : "text-ink-4 hover:text-ink-2",
              ].join(" ")}
              style={{ letterSpacing: "0.08em" }}
            >
              {tab}
            </button>
          ))}
        </nav>

        {/* Live indicator + date */}
        <div className="flex items-center gap-2 px-4 border-l border-parchment-border shrink-0">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-positive" />
          <span className="section-label whitespace-nowrap">
            Live&nbsp;·&nbsp;NYSE {timeStr}&nbsp;&nbsp;{dateStr}
          </span>
        </div>

        {/* Avatar */}
        <div className="flex items-center px-4 border-l border-parchment-border shrink-0">
          <div className="w-7 h-7 rounded-full bg-ink-2 flex items-center justify-center">
            <span className="text-parchment font-sans font-medium" style={{ fontSize: "0.6rem" }}>ER</span>
          </div>
        </div>
      </div>

      {/* Row 2: Sub-header meta */}
      <div className="flex items-center gap-0 overflow-x-auto" style={{ minHeight: 32 }}>
        {[
          ["BASE CCY", "USD"],
          ["RISK PROFILE", "CONSERVATIVE-GROWTH (4 / 10)"],
          ["TIME HORIZON", "18 YRS"],
          ["WITHDRAWAL TARGET", "2049"],
          ["LAST RECONCILED", fmtTime(lastUpdated) === "—" ? "06:00 ET" : fmtTime(lastUpdated)],
        ].map(([label, val], i) => (
          <div
            key={label}
            className={[
              "flex items-center gap-2 px-5 h-full",
              i < 4 ? "border-r border-parchment-border" : "",
            ].join(" ")}
          >
            <span className="section-label whitespace-nowrap">{label}</span>
            <span className="text-ink-3 font-medium whitespace-nowrap" style={{ fontSize: "0.65rem" }}>
              ·&nbsp;{val}
            </span>
          </div>
        ))}
      </div>
    </header>
  );
}
