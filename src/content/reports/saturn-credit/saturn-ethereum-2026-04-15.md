# Saturn Credit — Long-form Analysis

> Compliance-enabled stablecoin protocol on Ethereum. Wraps M0's `$M` token into `USDat` and offers a yield-bearing vault (`sUSDat`) backed by structured-credit (STRC) exposure managed through an off-chain processor.

## 1. Executive Summary

Saturn Credit is a four-contract stablecoin system on Ethereum mainnet, operated by a small team and audited three times prior to this assessment. The engineering is competent — modern Solidity, OpenZeppelin v5.x upgradeable contracts, comprehensive reentrancy protection, hardened oracle wiring, and ERC4626 inflation-attack defense.

The governance posture, however, is concentrated. Three of the four core upgradeable contracts — `USDat`, `sUSDat`, and the `Withdraw` queue — share a single externally-owned account as proxy admin and `DEFAULT_ADMIN_ROLE`. There is no timelock or multisig on these paths. The fourth contract (`SwapFacility`) is the exception: its proxy admin is a `TimelockController` with a 72-hour delay.

The deal-breaker gate fails on three items: EOA upgrade control, EOA fund control, and timelock backdoors. Twelve of the remaining twenty deal-breaker checks pass, three are inconclusive (deeper review halted at the gate), and five are not applicable (cross-chain / governance items for a single-chain non-DAO protocol).

## 2. Protocol Overview

Saturn Credit is built on top of M0's token infrastructure. Two assets are central:

- **`USDat`** — a compliance-enabled wrapper around M0's `$M` token (which is itself backed by U.S. treasuries). `USDat` exposes whitelist, blacklist, freeze, and forced-transfer capabilities through M0's JMI Extension framework. Minting is gated by the underlying `$M` wrapping, so there is no unbacked path; supply tracks the M0 reserve 1:1.
- **`sUSDat`** — an ERC4626 vault that accepts `USDat` deposits and produces yield through STRC (Structured Credit) exposure managed by an off-chain processor.

Yield generation runs through a `PROCESSOR_ROLE` that converts `USDat` ⇄ STRC off-chain and settles the accounting on-chain. Conversions are validated against an oracle-derived price within a configurable tolerance (`toleranceBps`, currently `2000` = 20%). Reward distribution is rate-limited via a vesting mechanism with `maxRewardsBps = 2.5%` per cycle, capping share-price impact per distribution.

Withdrawals are asynchronous. A user calls `requestRedeem` on the `Withdraw` queue (`WithdrawalQueueERC721`) and receives an ERC-721 NFT representing their position. The processor settles requests on-chain via `processRequests`, validating prices against the oracle within `toleranceBps`. Slippage protection is exposed at the entry points: `depositWithMinShares`, `mintWithMaxAssets`, and `requestRedeem(minUsdatReceived)`.

The `StrcPriceOracle` wraps a Chainlink STRC feed and adds a staleness check (26 hours) and price bounds ($20–$150). Admin can call `updateOracle(address)` to replace the wrapped feed at any time. The `SwapFacility` (Mint/Redeem) handles swaps between M extensions, the `$M` token, and JMI-supported assets — this is M0 infrastructure rather than Saturn-specific code.

The deployment is Ethereum-only. Ten contracts are in scope (six proxy/implementation pairs across the four upgradeable systems, plus `StrcPriceOracle` and the Chainlink feed wrapper). All ten are verified on Etherscan; full addresses are in §9.

## 3. Findings

### 3.1 Single EOA controls upgrades on three of four core contracts

The proxy admin owners for `USDat`, `sUSDat`, and the `Withdraw` queue all resolve to the same externally-owned account: `0x6101…6820`. On-chain `EXTCODESIZE` returns zero, confirming this is an EOA — a single key, not a contract.

The same EOA also holds `DEFAULT_ADMIN_ROLE` on `sUSDat` (an ERC1967Proxy / UUPS contract). UUPS upgrades are gated by `_authorizeUpgrade`, which is implemented to require this role. Because `sUSDat` custodies all deposited `USDat`, a single transaction signed by the holder of this key — `upgradeTo(<malicious_impl>)` — replaces the vault implementation. The new implementation can then transfer the entire `USDat` balance to any address. There is no on-chain delay, no co-signer requirement, no veto period, and no public warning.

The fourth core contract — the `SwapFacility` (Mint/Redeem) — is the exception. Its proxy admin is the `TimelockController` at `0x23CA…A468`, configured with a 72-hour delay. An admin-initiated upgrade on this path is publicly visible for 72 hours before it can execute. The asymmetry is informative: the team plainly knows the timelock pattern, since they used it for `SwapFacility`. Its absence on the other three contracts is the gap.

This is the dominant trust assumption in the protocol. A compromise of `0x6101…6820` — through key mismanagement, phishing, insider threat, or any other vector — is sufficient to drain user deposits in a single block.

### 3.2 No timelock on the price oracle

`StrcPriceOracle` exposes an admin function `updateOracle(address)` that replaces the underlying Chainlink feed wrapper. The same EOA holds `DEFAULT_ADMIN_ROLE`. There is no timelock or multisig on this path.

The oracle is consumed by `sUSDat.processRequests` and conversion logic to validate processor settlements within `toleranceBps`. A malicious or substituted oracle could report any STRC price, allowing a settlement at an attacker-chosen ratio — within tolerance, the on-chain check passes. Combined with `PROCESSOR_ROLE`'s direct access to vault assets (§3.4), oracle substitution is a viable single-transaction extraction path that does not require a proxy upgrade.

The Chainlink STRC feed itself is owned by a 4-of-9 Gnosis Safe (`0x21f7…73CA`). That governance posture is appropriate for the underlying feed. The trust gap is in `StrcPriceOracle`, the Saturn-side wrapper around it.

### 3.3 Wide conversion tolerance

The processor settles `USDat` ⇄ STRC conversions using the oracle price within a configurable tolerance. The current value is `toleranceBps = 2000`, i.e. 20%. The on-chain check passes any conversion that lands within ±20% of the oracle price.

20% is wide. If the processor settles at the edge of the band repeatedly — within tolerance, but unfavorable to the vault — share-price degradation accumulates without ever triggering an on-chain revert. The vesting mechanism (`maxRewardsBps = 2.5%` per cycle) limits the *positive* update rate but does not constrain settlement asymmetry.

A tighter bound (5–10%) — or a dynamic tolerance scaled to oracle volatility — would shrink the trust assumption on the off-chain processor without preventing legitimate price drift. This is engineering recommendation territory, not a deal-breaker, but it materially shapes the trust model.

### 3.4 PROCESSOR_ROLE has unbounded operational authority

`PROCESSOR_ROLE` is granted to a single off-chain key (configured at `sUSDat` initialization). The role can:

- Convert `USDat` ⇄ STRC, drawing from `sUSDat`'s internal balances.
- Distribute rewards via the vesting mechanism.
- Lock, unlock, and process withdrawal requests on the `Withdraw` queue.

There are no on-chain rate limits, per-cycle conversion caps, processor-balance ceilings, or maximum-pending-withdrawal constraints. The role is bounded only by code logic (e.g., `toleranceBps` on conversions) and by the trust assumption that the off-chain operator behaves correctly.

In ordinary operation this is unremarkable — many vaults rely on a trusted operator. The asymmetry here is the absence of *defense-in-depth* checks that would limit the blast radius of a compromised processor key. A rate limit ("processor cannot move more than X per epoch") would not prevent gradual misbehavior but would rule out single-block extraction.

### 3.5 No public bug bounty program

The Immunefi page for Saturn Credit returns 404. No alternate public coordinated-disclosure channel was discovered (no `security.txt` on the website, no security disclosure email in the documentation). Independent researchers who find vulnerabilities have no documented path to report them responsibly, and no incentive structure to do so rather than disclose elsewhere.

For a protocol of this complexity carrying real user deposits, an Immunefi program with a max bounty of $100K+ is the standard expectation.

## 4. Deal Breaker Analysis

The framework's deal-breaker gate is a fixed checklist of conditions that, if any FAIL, halt the assessment with a `Fail` outcome. Of 23 items, 12 PASS, 3 FAIL, 5 are N/A (cross-chain / governance items not applicable to a single-chain non-DAO protocol), and 3 are Inconclusive (deeper review halted at the gate).

### 4.1 Access Control & Governance

| Item | Status | Notes |
| --- | --- | --- |
| EOA Upgrade Control | **FAIL** | Single EOA controls proxy upgrades on `USDat`, `sUSDat`, and `Withdraw`. |
| EOA Fund Control | **FAIL** | Same EOA holds `DEFAULT_ADMIN_ROLE` on `sUSDat` — UUPS upgrade enables full fund extraction. |
| >60% Governance Centralization | N/A | No governance token. |
| Governance Mechanism Bypass | N/A | No governance voting mechanism. |
| Timelock Backdoors | **FAIL** | Zero timelock on `USDat`, `sUSDat`, `Withdraw`, `StrcPriceOracle` admin ops. Only `SwapFacility` has a 72h `TimelockController`. |
| No Emergency Controls | PASS | Pause/unpause via `COMPLIANCE_ROLE` (pause) and `DEFAULT_ADMIN_ROLE` (unpause) on every contract. |

### 4.2 Oracle & Price Integrity

| Item | Status | Notes |
| --- | --- | --- |
| Direct Pool Price Oracle | PASS | Uses Chainlink STRC feed via `StrcPriceOracle` with staleness check (26h) and price bounds ($20–$150). Not a DEX spot price. |
| Manual Price Control | PASS | Admin cannot set prices directly, but `updateOracle()` can redirect the oracle wrapper instantly. Aggravating factor (see §3.2). |

### 4.3 Smart Contract Architecture

| Item | Status | Notes |
| --- | --- | --- |
| Known Compiler Bugs | PASS | Solidity `0.8.20` and `0.8.26`. 198 files compile cleanly, no known-bug warnings. |
| No Reentrancy Protection | PASS | OZ `ReentrancyGuard` on `StakedUSDat` and `Withdraw`; custom transient-storage lock on `SwapFacility`. |
| Unlimited Minting | PASS | `USDat` minting gated by `$M` wrapping (1:1 backed). No unbacked path. |
| Unsafe Delegatecall | PASS | No `delegatecall` or unvalidated `.call{}` in Saturn contracts (only OZ proxy infrastructure). |
| Uninitialized Implementation | PASS | All five implementations call `_disableInitializers()` in their constructor. |
| Unprotected Initializer | PASS | All `initialize()` use the `initializer` modifier; `SwapFacility` uses `reinitializer(2)` for V2 upgrade. |

### 4.4 Audit & Verification

| Item | Status | Notes |
| --- | --- | --- |
| No Audit + High TVL | PASS | Three audits completed (Three Sigma + 2× Certora). TVL not tracked on DeFiLlama. |
| Unverified Contracts | PASS | 10 of 10 in-scope contracts verified on Etherscan. |
| Critical Unfixed Issues | Inconclusive | Detailed audit findings not re-reviewed in this assessment (pipeline halted at the gate). |

### 4.5 Economic & Liquidity

| Item | Status | Notes |
| --- | --- | --- |
| Zero Flash Loan Protection | Inconclusive | Internal balance tracking (`usdatBalance`, `strcBalance`) is used; deeper flash-loan analysis was not performed. |
| Broken Tokenomics | Inconclusive | 11%+ yield from STRC credit; revenue source not independently verified. Vesting caps reward distribution at 2.5% of `totalAssets` per cycle. |
| No Slippage Protection | PASS | `depositWithMinShares`, `mintWithMaxAssets`, `requestRedeem(minUsdatReceived)`. `processRequests` validates against oracle within `toleranceBps`. |

### 4.6 Cross-Chain & Bridges

| Item | Status | Notes |
| --- | --- | --- |
| Centralized Bridge | N/A | Single-chain (Ethereum only). |
| No Transfer Limits | N/A | Not a bridge. |
| No Token Verification | N/A | Not a bridge. |

## 5. Trust & Permissions

The trust posture concentrates almost entirely on a single EOA — `0x6101…6820`. This account holds:

| Surface | Controller | Type | Min delay | Worst case |
| --- | --- | --- | --- | --- |
| `USDat` — Proxy upgrade | `0x6101…6820` | EOA | Instant | Replace `USDat` implementation; instant token redirection or freeze |
| `USDat` — `DEFAULT_ADMIN_ROLE` | `0x6101…6820` | EOA | Instant | Grant/revoke any role on `USDat` |
| `sUSDat` — UUPS upgrade & `DEFAULT_ADMIN_ROLE` | `0x6101…6820` | EOA | Instant | Replace vault implementation; full drainage of deposited `USDat` |
| `Withdraw` — UUPS upgrade & `DEFAULT_ADMIN_ROLE` | `0x6101…6820` | EOA | Instant | Replace withdrawal queue; redirect funds in flight |
| `StrcPriceOracle` — `DEFAULT_ADMIN_ROLE` | `0x6101…6820` | EOA | Instant | Redirect oracle to attacker feed; instant NAV manipulation |
| Mint/Redeem (`SwapFacility`) — Proxy upgrade | `0x23CA…A468` | Timelock | 72h | Mint/Redeem upgrade; 72h public delay before exposure |
| Chainlink STRC Feed — Owner | `0x21f7…73CA` | Multisig 4/9 | Instant | Replace Chainlink STRC price-feed implementation |

Three observations follow from this posture:

The first is the **concentration of upgrade authority**. Every contract that custodies user value — `USDat` (the asset), `sUSDat` (the vault), `Withdraw` (the queue) — sits behind the same single key. There is no defense-in-depth: no second signer, no public delay, no governance vote.

The second is the **uneven application of the timelock pattern**. The team has clearly used `TimelockController` correctly for `SwapFacility`. The choice to omit it elsewhere is therefore deliberate (or at least not from ignorance). Migrating `USDat`, `sUSDat`, and `Withdraw` to the same pattern would resolve the EOA deal-breakers.

The third is the **Chainlink feed governance** is the better posture in the system. The 4-of-9 Safe at `0x21f7…73CA` is appropriate for the underlying feed. The trust gap is in the Saturn-side wrapper around that feed (`StrcPriceOracle`), not the feed itself.

## 6. Architecture Notes

### 6.1 Upgrade pattern

The four core contracts use mixed proxy patterns:

- `USDat` and `Mint/Redeem` use OZ `TransparentUpgradeableProxy`, with admin authority indirected through a `ProxyAdmin` contract.
- `sUSDat` and `Withdraw` use UUPS (`ERC1967Proxy`), with upgrade authorization implemented in the contract itself via `_authorizeUpgrade(...) onlyRole(DEFAULT_ADMIN_ROLE)`.
- `StrcPriceOracle` is non-upgradeable (deployed as immutable).

All five upgradeable implementations call `_disableInitializers()` in their constructor, mitigating the classic "uninitialized implementation" attack. `initialize()` uses the OZ `initializer` modifier; `SwapFacility` uses `reinitializer(2)` to support its V2 upgrade.

### 6.2 Oracle integration

`StrcPriceOracle` wraps a Chainlink STRC aggregator (`0xf4d2…8d23`, an `EACAggregatorProxy`). The wrapper layers two safety checks: a 26-hour staleness rejection, and a price-bounds rejection ($20–$150). Both check the latest answer from the underlying feed before returning it.

The wrapped feed address is mutable via `updateOracle(address)` and is gated only by `DEFAULT_ADMIN_ROLE`. This is the gap discussed in §3.2.

### 6.3 Reentrancy and locking

`StakedUSDat` and `Withdraw` use OZ `ReentrancyGuard` (`nonReentrant`) on every state-mutating external entry point. `SwapFacility` uses a custom transient-storage (EIP-1153) lock pattern — slightly more efficient than OZ's storage-slot guard and equivalently safe.

### 6.4 Reward and vesting mechanics

Rewards distributed by the processor are subject to a vesting mechanism. The vault tracks a `lockedAmount` that decays linearly over a vesting window; distributions add to it, and the share price reflects only the unlocked portion. This prevents instantaneous share-price manipulation: a single large reward can only move share price by `maxRewardsBps = 2.5%` of `totalAssets` per distribution cycle.

ERC4626 inflation-attack defense is provided via `_decimalsOffset() = 12`, which exponentially raises the cost of donation-based share-price griefing on early deposits.

### 6.5 Aggravating factors beyond the deal breakers

- `rescueTokens()` on `sUSDat` can withdraw any non-`USDat` ERC-20 balance held by the contract. The intent is operational hygiene (recovering accidentally-sent tokens), but it is admin-callable.
- `redistributeLockedAmount()` burns blacklisted users' shares, redistributing value to the remaining holders. This is a compliance feature, but it is a non-trivial value-transfer surface.
- Internal balance tracking (`usdatBalance`, `strcBalance`) is independent of actual token balances. This is a defense-in-depth pattern (the contract verifies its accounting against externally-driven state), but it depends on processor honesty for the off-chain leg.
- No bug bounty (§3.5).

## 7. Open Issues

Six issues are surfaced for the protocol team. Priorities reflect engineering urgency for the maintainers, not a position on the protocol from this site's perspective.

### 7.1 P0 — immediate

1. **Single EOA controls upgrades on 3/4 core contracts.** *Critical, Access Control.* Complete fund drainage via malicious upgrade. Recommendation: migrate admin authority to a multisig (≥3/5) behind a `TimelockController` (≥48h).
2. **No timelock on `StrcPriceOracle.updateOracle()`.** *High, Oracle.* Instant oracle substitution can manipulate NAV and conversion rates. Recommendation: add a timelock to all oracle admin operations (`updateOracle`, `setStaleness`, `setBounds`).

### 7.2 P1 — within 1 month

3. **20% `toleranceBps` on `USDat`/STRC conversions.** *Medium, Oracle.* Wide tolerance allows significant price deviation during processor settlement. Recommendation: reduce `toleranceBps` to 5–10% or implement a dynamic tolerance bounded by oracle volatility.
4. **No public bug bounty program.** *Medium, Operations.* Reduces the incentive for responsible vulnerability disclosure. Recommendation: establish an Immunefi program with $100K+ max bounty.

### 7.3 P2 — within 3 months

5. **`PROCESSOR_ROLE` is a trusted off-chain actor without on-chain bounds.** *Medium, Access Control.* The processor controls STRC conversions and withdrawal processing. Recommendation: implement on-chain rate limits and per-cycle caps on processor actions.
6. **Protocol not tracked on DeFiLlama.** *Low, Transparency.* Reduces independent TVL monitoring capability. Recommendation: submit DeFiLlama listing and maintain the adapter.

## 8. Audit History

Three audits were completed prior to this assessment. Tier classification follows standard DeFi-industry conventions.

| # | Firm | Tier | Notes |
| --- | --- | --- | --- |
| 1 | Three Sigma | 2 | Audit #1. Scope and findings not surfaced in the public report index. |
| 2 | Certora | 1 | Audit #2. |
| 3 | Certora | 1 | Audit #3. |

Detailed findings from these audits were not re-reviewed in this assessment; the framework halted at the deal-breaker gate before reaching audit-finding triage. Two Certora engagements is meaningful — Certora's typical engagement model is formal verification of specific properties, which complements manual review but does not subsume it. PDFs of the reports are linked from the dashboard's Audit History section.

## 9. Contract Inventory

All ten in-scope contracts are verified on Etherscan.

| Contract | Address | Type | Compiler |
| --- | --- | --- | --- |
| `USDat` (Proxy) | `0x23238f20b894f29041f48D88eE91131C395Aaa71` | TransparentUpgradeableProxy | 0.8.26 |
| `USDat` (Impl) | `0x17cac25c6d6bbcb592837fea083a5c8eb4d1e52e` | Implementation | 0.8.26 |
| `sUSDat` (Proxy) | `0xD166337499E176bbC38a1FBd113Ab144e5bd2Df7` | ERC1967Proxy (UUPS) | 0.8.20 |
| `sUSDat` (Impl) | `0x2005e0ca201a37694125ff267ae57872bea0a0ce` | Implementation | 0.8.20 |
| Mint/Redeem (Proxy) | `0xB6807116b3B1B321a390594e31ECD6e0076f6278` | TransparentUpgradeableProxy | 0.8.26 |
| Mint/Redeem (Impl) | `0x45bf08d042a8958f01f8e8319b791e4584550da8` | Implementation | 0.8.26 |
| `Withdraw` (Proxy) | `0x4Bc9FEC04F0F95e9b42a3EF18F3C96fB57923D2e` | ERC1967Proxy (UUPS) | 0.8.20 |
| `Withdraw` (Impl) | `0x256fa0ba1b6dfb50ee883955c5a99d3c1b017fd5` | Implementation | 0.8.20 |
| `StrcPriceOracle` | `0x5f7eCD0D045c393da6cb6c933c671AC305A871BF` | Immutable | 0.8.20 |
| Chainlink STRC Feed | `0xf4d2076277fff631EFC4385Ab36b1f7734218d23` | EACAggregatorProxy | 0.6.6 |

## 10. References

- Website — <https://saturn.credit/>
- Documentation — <https://saturncredit.gitbook.io/saturn-docs>
- Audit reports (PDFs) — linked from the dashboard's Audit History section
- Etherscan address links and the structured filterable view — see the [protocol dashboard](/protocols/saturn-credit)

---

*Long-form companion to the dashboard. Descriptive technical analysis only — not financial advice.*
