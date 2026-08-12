/**
 * Where each note that used to live at /notes/<slug> now lives.
 *
 * Frozen at the 2026-08-12 split. The notes collection was removed from this
 * repo, so this map is the only remaining record of the old URL space — do not
 * regenerate it, and only append if an old URL is discovered to be missing.
 */
export const NOTES_HOME = 'https://mart1n.xyz';

export const MOVED_NOTES: Record<string, string> = {
  'zerolend-liquidity-index-manipulation':
    'https://mart1n.xyz/security/zerolend-liquidity-index-manipulation',
  'hinkal-usdc-shielded-pool-drain':
    'https://mart1n.xyz/security/hinkal-usdc-shielded-pool-drain',
  'summerfi-fleetcommander-nav-donation-drain':
    'https://mart1n.xyz/security/summerfi-fleetcommander-nav-donation-drain',
  'allbridge-core-solana-same-pool-account-aliasing-drain':
    'https://mart1n.xyz/security/allbridge-core-solana-same-pool-account-aliasing-drain',
  'processor-role-design-in-credit-vaults':
    'https://mart1n.xyz/research/processor-role-design-in-credit-vaults',
  // Was KYP-specific meta content and did not move; send it to the writing index.
  'welcome-to-kyp-notes': NOTES_HOME,
};
