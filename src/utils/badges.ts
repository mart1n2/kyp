// Single source of truth for the status-color language.
// Every gate/risk/score/severity color on the site comes from here —
// edit once, consistent everywhere.

const gateBadge: Record<string, string> = {
  Pass:         'bg-ok/10 text-ok border-ok/40',
  Conditional:  'bg-warn/10 text-warn border-warn/40',
  Watchlist:    'bg-info/10 text-info border-info/40',
  Fail:         'bg-danger/10 text-danger border-danger/40',
  Inconclusive: 'bg-ink/5 text-ink-2 border-line-2',
};

export function gateBadgeClass(gate?: string): string {
  return gateBadge[gate ?? ''] ?? gateBadge.Inconclusive;
}

const riskText: Record<string, string> = {
  Critical: 'text-danger',
  High: 'text-hot',
  Medium: 'text-warn',
  Low: 'text-ok',
};

export function riskTextClass(level?: string): string {
  return riskText[level ?? ''] ?? 'text-ink-2';
}

// Severity shares the risk palette deliberately — one mental model.
export const severityTextClass = riskTextClass;

export function scoreTextClass(score?: number | null): string {
  if (score == null) return 'text-ink-2';
  if (score >= 70) return 'text-ok';
  if (score >= 40) return 'text-warn';
  return 'text-danger';
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
