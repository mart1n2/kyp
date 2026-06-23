// Single source of truth for the status-color language.
// Every gate/risk/score/severity color on the site comes from here —
// edit once, consistent everywhere.

const gateBadge: Record<string, string> = {
  Pass:         'bg-green-900/50 text-green-200 border-green-700',
  Conditional:  'bg-yellow-900/40 text-yellow-200 border-yellow-700',
  Watchlist:    'bg-blue-900/40 text-blue-200 border-blue-700',
  Fail:         'bg-red-900/50 text-red-200 border-red-700',
  Inconclusive: 'bg-slate-800 text-slate-300 border-slate-700',
};

export function gateBadgeClass(gate?: string): string {
  return gateBadge[gate ?? ''] ?? gateBadge.Inconclusive;
}

const riskText: Record<string, string> = {
  Critical: 'text-red-300',
  High: 'text-orange-300',
  Medium: 'text-yellow-200',
  Low: 'text-green-300',
};

export function riskTextClass(level?: string): string {
  return riskText[level ?? ''] ?? 'text-slate-300';
}

// Severity shares the risk palette deliberately — one mental model.
export const severityTextClass = riskTextClass;

export function scoreTextClass(score?: number | null): string {
  if (score == null) return 'text-slate-300';
  if (score >= 70) return 'text-green-300';
  if (score >= 40) return 'text-yellow-300';
  return 'text-red-300';
}

const explorerBase: Record<string, string> = {
  Ethereum: 'https://etherscan.io/address/',
  BSC: 'https://bscscan.com/address/',
  Arbitrum: 'https://arbiscan.io/address/',
  Optimism: 'https://optimistic.etherscan.io/address/',
  Polygon: 'https://polygonscan.com/address/',
  Base: 'https://basescan.org/address/',
  Avalanche: 'https://snowtrace.io/address/',
  HyperEVM: 'https://hyperevmscan.io/address/',
  Mezo: 'https://explorer.mezo.org/address/',
};

export function explorerUrlFor(chain?: string): string {
  return explorerBase[chain ?? ''] ?? 'https://etherscan.io/address/';
}
