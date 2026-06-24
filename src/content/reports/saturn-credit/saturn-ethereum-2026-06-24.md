# Saturn Credit — Full Re-Audit (June 2026)

> The full scored assessment that April's run never produced. Saturn's three April access-control deal breakers are resolved by a 5-day TimelockController migration; this pass scores the unchanged code under the new authority configuration. Grade B+ (68.4), Medium risk, deal-breaker gate cleared.

## 1. Executive Summary

Saturn Credit is a compliance-enabled stablecoin system on Ethereum that wraps M0's `$M` token into `USDat` and offers a yield-bearing vault (`sUSDat`) backed by structured-credit (STRC) exposure managed through an off-chain processor. The April 2026 assessment halted at the deal-breaker gate with a Grade F / REJECT: three access-control deal breakers failed because a single externally-owned account (EOA) held upgrade and admin authority over the core contracts with no timelock.

This June pass is the full scored assessment that April never reached. On 2026-05-29 the team deployed a `TimelockController` (`0xfD57…8A67`) with a 5-day (432,000-second) minimum delay and migrated all previously EOA-held upgrade and admin authority to it; the old god-key was fully revoked from `DEFAULT_ADMIN_ROLE` on every core contract. With the three access-control deal breakers resolved (verified on-chain), the gate now passes, and because the deployed implementations are byte-identical to those reviewed in April, no code re-audit was triggered — this pass scores the existing code under the current authority configuration.

The result is **68.4 / 100, grade B+ (the bottom of the B+ band), Medium risk**, with the deal-breaker gate cleared (17 PASS, 0 FAIL, 5 N/A, 1 Inconclusive across the 23-item checklist). Saturn is genuinely well-engineered — modern OpenZeppelin v5.x, comprehensive reentrancy protection, ERC4626 inflation defense (`_decimalsOffset = 12`), internal-accounting NAV that is donation-proof, reward vesting, and three prior audits — and the pass found no Critical or High code vulnerability and no unprivileged drainable path. The score is held to the B band by **structural trust concentration, not code defects**: 92.5% of the $88.6M vault NAV is off-chain STRC credited by a non-timelocked single-key processor, the 5-day timelock's sole proposer/canceller is still a single EOA, a slow 24-hour-heartbeat single oracle prices the off-chain NAV, and there is no bug bounty. The team is publicly doxxed (Kevin Li, Ellis Osborn, Seb).

## 2. Protocol Overview

Saturn is built on M0's token infrastructure. Two assets are central. `USDat` is a compliance-enabled wrapper around M0's `$M` token (itself backed by U.S. treasuries), exposing whitelist, freeze, and forced-transfer capabilities through M0's JMI Extension framework; minting is gated by the underlying `$M` wrapping (`onlySwapFacility`), so there is no unbacked path. `sUSDat` is a vault that accepts `USDat` deposits and produces yield through STRC exposure managed by an off-chain processor.

Yield generation runs through a `PROCESSOR_ROLE` that converts `USDat` ⇄ STRC off-chain and settles the accounting on-chain via `convertFromUsdat`. Conversions are validated against an oracle-derived price within a configurable tolerance (`toleranceBps`, currently `2000` = 20%). Reward distribution is rate-limited through a vesting mechanism (currently a 3-day `vestingPeriod`, `maxRewardsBps = 250`), capping share-price impact per distribution. Critically, the vault uses an **internal-accounting NAV**: `totalAssets` reflects an internal `strcBalance` credited by the processor plus the liquid on-chain `usdatBalance`, which makes the vault donation- and inflation-resistant but means most of the backing is an off-chain number, not an on-chain balance.

Withdrawals are asynchronous. A user calls `requestRedeem` on the `WithdrawalQueueERC721` and receives an ERC-721 representing the position; the processor settles requests on-chain, validating prices within `toleranceBps`. Slippage protection is exposed at the entry points (`depositWithMinShares`, `mintWithMaxAssets`, `requestRedeem(minUsdatReceived)`). The `StrcPriceOracle` wraps a Chainlink STRC feed with a staleness ceiling and static price bounds. The `SwapFacility` (Mint/Redeem) handles swaps between M extensions and is M0 infrastructure rather than Saturn-specific code.

The defining change since April is the **authority layer**. A new `TimelockController` (`0xfD57…8A67`, `getMinDelay() = 432000`) now sits between the operator key and every privileged function. Its configuration is canonical: `EXECUTOR_ROLE = address(0)` (open execution — anyone may execute after the delay), `DEFAULT_ADMIN_ROLE` is the timelock itself (self-administered, no external backdoor), and `PROPOSER_ROLE` / `CANCELLER_ROLE` are held by the single EOA `0x6101…6820`. This timelock is now the authority on the USDat ProxyAdmin and on the `DEFAULT_ADMIN_ROLE` of `USDat`, `sUSDat`, `Withdraw`, and `StrcPriceOracle`; the separate `SwapFacility` ProxyAdmin remains under its own 72-hour timelock.

The live state at assessment (2026-06-24): vault NAV ≈ **$88.6M**, of which liquid on-chain USDat is only **$6.63M (7.5%)** and off-chain STRC is **≈ $82.0M (92.5%)**; `USDat` supply ≈ $116M. Exit liquidity is asymmetric — a USDat/USDC Curve pool holds ~$20M, but the sUSDat/USDC Curve pool holds only ~$333K, so sUSDat holders cannot exit at scale on-market and depend on the async, processor-gated queue. Ten contracts are in scope, all verified on Etherscan; full addresses are in §9.

## 3. Findings

No Critical or High findings were identified. The material items below are trust-model and economic-design weaknesses, not code defects.

### 3.1 The off-chain backing and the non-timelocked processor (F-2)

The dominant risk is that 92.5% of the vault's $88.6M NAV is STRC held off-chain — represented on-chain only as an internal `strcBalance` number credited by the `PROCESSOR_ROLE`, not a provable on-chain asset. The same processor key can move the liquid USDat balance via `convertFromUsdat` within the ±20% tolerance, and this power is uncapped and repeatable. The processor is **not** behind the 5-day timelock; it is a single hot key acting in real time.

The technical impact is bounded but real. Each conversion can settle up to 20% away from the oracle price, and because `toleranceBps` bounds the STRC amount and the purchase price independently, the deviations compound to roughly a 33% value-leak ceiling per conversion (F-7). A malicious or compromised processor cannot upgrade a contract (that is timelock-gated) but can lean on the conversion mechanism repeatedly, and the off-chain backing obligation is enforced only by trust and by the three prior audits' review of the intended design.

What softens this is structural: the framework explicitly scores trusted-role economic-design risks directly rather than simulating them, and Saturn's flash-loan and donation resistance (internal accounting, async settlement, vesting) means there is no *unprivileged* drainable path. The risk is concentrated in the processor role and the off-chain leg, which is why it shapes the grade rather than failing the gate. The mitigation is on-chain caps or rate limits on `convertFromUsdat` and reducing reliance on off-chain-credited backing.

### 3.2 The timelock's sole proposer and canceller is a single EOA (F-1)

The 5-day timelock resolves the April deal breakers — a privileged action now cannot take effect without a public, 5-day delay, which is the canonical exit-window protection a timelock is meant to provide. But the timelock's `PROPOSER_ROLE` and `CANCELLER_ROLE` are both held by exactly one EOA — the same god-key flagged in April. This is delay without decentralization.

Three consequences follow. A compromised proposer key can queue a malicious upgrade and force every depositor into the 5-day exit window. The same key is the only canceller, so there is no independent guardian to cancel a malicious queued action — users' only remaining defense is to exit. And key *loss* freezes administration entirely, including `unpause`. Adding a co-proposer or independent canceller would itself have to pass through the 5-day timelock.

The mitigant for upgrade safety is the timelock, not the key, so the single-EOA proposer is acceptable for the upgrade-safety dimension — but it is a liveness and centralization gap. Moving `PROPOSER`/`CANCELLER` to a ≥3/5 multisig with an independent canceller would close it and is one of the explicit conditions for an APPROVED-tier posture.

### 3.3 A slow single oracle prices 92.5% of NAV (F-5, F-6)

The `StrcPriceOracle` wraps a single Chainlink STRC feed with a **24-hour heartbeat**, a 36-hour staleness ceiling, static $20–$150 price bounds (roughly ±50% with no deviation breaker), and no fallback. This one feed prices the 92.5% off-chain NAV. Two issues compound it: the oracle omits an `answeredInRound` / round-completeness check (F-6), and because it has no fallback, a stale or out-of-bounds feed reverts all sUSDat accounting — deposit, preview, and `requestRedeem` (F-5). The failure mode is a liveness DoS that fails closed (safe for funds, bad for availability). `updateOracle` is now behind the 5-day timelock, which removes the April instant-substitution risk. Adding a fallback or circuit breaker and tightening the staleness window to the 24-hour heartbeat would address the residual.

### 3.4 Broad compliance hot key (F-3)

The `USDat` `COMPLIANCE_ROLE` is held by a hot key that can freeze accounts, execute an arbitrary-recipient `forceTransfer`, manage the whitelist, and both pause *and* unpause — a broader bundle than the equivalent roles on `sUSDat` and the withdrawal queue. This is a compliance-feature surface rather than a fund-drainage path, but concentrating freeze, forced transfer, and the full pause/unpause cycle in one key is a non-trivial value-transfer and liveness surface. Splitting these powers — and separating pause from unpause — would reduce the blast radius of a compliance-key compromise.

### 3.5 Self-DoS loops and carry-over items (F-4, F-8)

`_claimAllFor` iterates over a user's full `balanceOf`, so an unbounded position can gas-grief itself; funds remain escapable via the per-NFT `claim`, so this is a self-DoS rather than a fund risk (F-4). Separately, withdrawal settlement allows up to a 20% haircut versus `previewRedeem`, and a per-request `minUsdatReceived` of `0` still validates (F-8) — a depositor who does not set a floor can be settled materially below preview. Carry-over items from April that remain open and non-gating: the 20% `toleranceBps`, the absence of a bug bounty or public security contact, and the protocol not being tracked on DeFiLlama.

## 4. Deal Breaker Analysis

The framework's deal-breaker gate is a fixed 23-item checklist; any FAIL halts the assessment with a `Fail` outcome and a forced score of zero. April recorded 3 FAILs (all access control). This pass records **17 PASS, 0 FAIL, 5 N/A, 1 Inconclusive** — the gate is cleared.

### 4.1 Access Control & Governance

| Item | Status | Notes |
| --- | --- | --- |
| EOA Upgrade Control | **PASS** (was FAIL) | Upgrade authority on all 4 contracts now terminates at the 5-day `TimelockController` `0xfD57…8A67`; old EOA fully revoked. |
| EOA Fund Control | **PASS** (was FAIL) | No single EOA can upgrade-to-drain; the processor's `convertFromUsdat` is scored as a Fund Control / economic weakness (§3.1), not an unrestricted EOA withdrawal. |
| >60% Governance Centralization | N/A | No governance token. |
| Governance Mechanism Bypass | N/A | No on-chain voting. |
| Timelock Backdoors | **PASS** (was FAIL) | Executor `address(0)` (open), admin self; no `fastTrack`/`emergencyExecute`. 5d ≫ 48h mainnet minimum. `updateOracle` now timelock-gated. |
| No Emergency Controls | PASS | Pause via `COMPLIANCE_ROLE`; unpause via `DEFAULT_ADMIN_ROLE` (timelock). |

### 4.2 Oracle & Price Integrity

| Item | Status | Notes |
| --- | --- | --- |
| Direct Pool Price Oracle | PASS | Chainlink STRC feed wrapped with staleness + bounds; not a DEX spot price. |
| Manual Price Control | PASS | No direct price setter; `updateOracle` / `setPriceBounds` are now 5-day-timelock-gated. |

### 4.3 Smart Contract Architecture

| Item | Status | Notes |
| --- | --- | --- |
| Known Compiler Bugs | PASS | Solidity `0.8.20` / `0.8.26`, no applicable CVE. |
| No Reentrancy Protection | PASS | OZ `ReentrancyGuard` + CEI; `SwapFacility` transient-storage lock. |
| Unlimited Minting | PASS | `USDat` mints only by wrapping `$M` 1:1 (`onlySwapFacility`). |
| Unsafe Delegatecall / Call | PASS | None in Saturn contracts. |
| Uninitialized Implementation | PASS | All implementations call `_disableInitializers()`. |
| Unprotected Initializer | PASS | `initializer`-gated; already initialized on-chain. |

### 4.4 Audit & Verification

| Item | Status | Notes |
| --- | --- | --- |
| No Audit + High TVL | PASS | 3 audits (Three Sigma + 2× Certora); TVL ~$88.6M, audited. |
| Unverified Contracts | PASS | 10/10 in-scope contracts verified on Etherscan. |
| Critical Unfixed Issues | Inconclusive | Audit PDFs not re-read this pass (per process). |

### 4.5 Economic & Liquidity

| Item | Status | Notes |
| --- | --- | --- |
| Zero Flash Loan Protection | **PASS** (was Inconclusive) | Internal-accounting NAV + async withdrawal + vesting break same-block manipulation. |
| Broken Tokenomics | **PASS** (was Inconclusive) | ~11% real yield from off-chain STRC, well below 100%; not emission-driven. |
| No Slippage Protection | PASS | `depositWithMinShares`, `mintWithMaxAssets`, `requestRedeem(minUsdatReceived)`. |

### 4.6 Cross-Chain & Bridges

| Item | Status | Notes |
| --- | --- | --- |
| Centralized Bridge | N/A | Single-chain (Ethereum only). |
| No Transfer Limits | N/A | Not a bridge. |
| No Token Verification | N/A | Not a bridge. |

## 5. Trust & Permissions

The April→June change is structural: every previously EOA-held upgrade/admin power now sits behind the 5-day timelock.

| Surface | Controller | Type | Min delay | Worst case |
| --- | --- | --- | --- | --- |
| `USDat` / `sUSDat` / `Withdraw` / `StrcPriceOracle` — upgrade & `DEFAULT_ADMIN` | `0xfD57…8A67` | Timelock | 120h | Upgrade any core contract or change the oracle/params — only after a public 5-day delay |
| `TimelockController` — `PROPOSER` & `CANCELLER` | `0x6101…6820` | EOA | Instant | Queue a 5-day-delayed malicious upgrade, indefinitely cancel remediation, or freeze admin on key loss |
| `sUSDat` — `PROCESSOR_ROLE` (`convertFromUsdat`) | Processor key (single EOA) | EOA | Instant | Move the liquid USDat balance within ±20% tolerance, uncapped; off-chain STRC backing not on-chain-provable |
| `USDat` — `COMPLIANCE_ROLE` | Compliance key | EOA | Instant | Freeze, arbitrary-recipient `forceTransfer`, whitelist, pause + unpause |
| Mint/Redeem (`SwapFacility`) — proxy upgrade | `0x23CA…A468` | Timelock | 72h | Mint/Redeem upgrade — 72h public delay before exposure |
| Chainlink STRC Feed — owner | `0x21f7…73CA` | Multisig 4/9 | Instant | Replace the underlying Chainlink STRC price-feed implementation |

Three observations follow. First, the **upgrade surface is now genuinely protected**: a 5-day delay (≫ the 48-hour mainnet norm) on an open-executor, self-administered timelock is the canonical exit-window mitigant, and the old EOA is fully revoked. This is the change that lifts the April REJECT. Second, the **real-time powers remain centralized**: the processor (conversions) and compliance (freeze/forceTransfer/pause) keys act instantly with no delay, and the timelock's own proposer/canceller is a single key — so the protection rests on a working exit, which for passive sUSDat holders is constrained by the thin (~$333K) secondary pool and the async queue. Third, the **better posture already exists in the system** — the Chainlink feed owner is a 4/9 multisig, and the Mint/Redeem path uses a 72-hour timelock — so moving the new timelock's proposer/canceller to a ≥3/5 multisig with an independent canceller is a known, in-house pattern, not new ground.

## 6. Architecture Notes

### 6.1 Upgrade pattern and the new timelock

The four core contracts use mixed proxy patterns: `USDat` and `Mint/Redeem` are `TransparentUpgradeableProxy` (admin via `ProxyAdmin`), while `sUSDat` and `Withdraw` are UUPS (`ERC1967Proxy`) with `_authorizeUpgrade` gated on `DEFAULT_ADMIN_ROLE`; `StrcPriceOracle` is immutable. As of the May migration, the USDat ProxyAdmin owner and the `DEFAULT_ADMIN_ROLE` on all four are the 5-day `TimelockController`. The UUPS contracts use plain sequential storage with no `__gap`, and implementation immutables (oracle/queue references) must be re-set on every upgrade — an append-only discipline caveat (F-10) rather than a current defect.

### 6.2 Oracle integration

`StrcPriceOracle` wraps a single Chainlink STRC aggregator with a staleness ceiling and static bounds. The April instant-substitution risk is gone now that `updateOracle` is timelock-gated, but the residuals are the slow 24-hour heartbeat, the missing round-completeness check, and the lack of a fallback (§3.3).

### 6.3 Reentrancy and NAV integrity

OZ `ReentrancyGuard` (`nonReentrant`) covers the state-mutating entry points; `SwapFacility` uses a transient-storage (EIP-1153) lock. The vault's internal-accounting NAV means `totalAssets` and `previewRedeem` read internal balances, so there is no read-only reentrancy surface and donation/inflation attacks are statically neutralized (reinforced by `_decimalsOffset = 12`). Async withdrawal plus reward vesting defeat same-block flash-loan manipulation — which is why the Economic deal breakers flipped from Inconclusive to PASS this pass.

### 6.4 Reward and vesting mechanics

Rewards distributed by the processor vest over a window (currently 3 days, initialized at 30), and the share price reflects only the unlocked portion, capping per-cycle impact at `maxRewardsBps = 250` (2.5%) of `totalAssets`. This prevents instantaneous share-price manipulation from a single large distribution.

### 6.5 Aggravating factors beyond the deal breakers

- The processor and compliance keys act in real time with no timelock, and the timelock's own proposer/canceller is a single EOA (F-1, F-2, F-3).
- The 20% `toleranceBps` compounds to a ~33% per-conversion value-leak ceiling, and withdrawal settlement permits a ≤20% haircut versus `previewRedeem` (F-7, F-8).
- Off-chain STRC backing reduces USDat solvency to M0 solvency plus the off-chain credit book — a single-backing concentration.
- No bug bounty or public security channel; the protocol is not tracked on DeFiLlama.

## 7. Open Issues

Nine issues are surfaced for the protocol team. Priorities reflect engineering urgency for the maintainers, not a position on the protocol from this site's perspective. The four conditions the assessment names for an APPROVED-tier posture are concentrated in the P1 set.

### 7.1 P1 — within 1 month

1. **Timelock's sole `PROPOSER` + `CANCELLER` is a single EOA (F-1).** *Medium, Access Control.* Delay without decentralization. Recommendation: move `PROPOSER`/`CANCELLER` to a ≥3/5 multisig with an independent canceller.
2. **Non-timelocked single-key processor can move the liquid USDat balance (F-2).** *Medium, Access Control.* `convertFromUsdat` within ±20%, uncapped; off-chain STRC backing not on-chain-provable. Recommendation: add on-chain caps/rate limits; reduce reliance on off-chain-credited backing.
3. **±20% `toleranceBps` → ~33% value-leak ceiling per conversion (F-7).** *Medium, Economic.* Recommendation: narrow `toleranceBps` to ≤5%.
4. **No public bug bounty or security contact.** *Medium, Operations.* Recommendation: establish an Immunefi program ($100K+) and a public security contact.

### 7.2 P2 — within 3 months

5. **Withdrawal settlement allows a ≤20% haircut vs `previewRedeem`; `minUsdatReceived` can be 0 (F-8).** *Medium, Economic.* Recommendation: enforce a minimum floor; bound the settlement haircut.
6. **Broad compliance hot key — freeze + `forceTransfer` + whitelist + pause/unpause (F-3).** *Low, Access Control.* Recommendation: split the powers; separate pause from unpause; constrain `forceTransfer`.
7. **Unbounded user-iterated loops (`_claimAllFor`) (F-4).** *Low, Smart Contract.* Recommendation: bound the loops or document per-NFT `claim` as the escape hatch.
8. **Oracle has no fallback; a stale/out-of-bounds feed reverts all sUSDat accounting (F-5).** *Low, Oracle.* Recommendation: add a fallback / circuit breaker.
9. **`getPrice` omits `answeredInRound`; loose staleness and static bounds (F-6).** *Low, Oracle.* Recommendation: add round-completeness checks; tighten staleness to the 24h heartbeat; add a deviation breaker.

Two further documentation/discipline notes were recorded as informational (not open issues): `IStakedUSDat` NatSpec misstates the role gating on `setVestingPeriod`/`setDepositFee`/`setFeeRecipient` (the implementation is stricter, F-9), and the UUPS contracts require append-only storage discipline and immutable re-setting on upgrade (F-10).

## 8. Audit History

| # | Firm | Tier | Note |
| --- | --- | --- | --- |
| 1 | Three Sigma | 2 | Audit #1. Scope and findings not surfaced in the public report index. |
| 2 | Certora | 1 | Audit #2. |
| 3 | Certora | 1 | Audit #3. |

Three audits across two firms is meaningful coverage, and the two Certora engagements imply formal verification of specific properties (Certora's typical model), which complements but does not subsume manual review. The audit PDFs were not deep-read in this pass — the framework's process re-verified the access-control state on-chain and reused the April source fetch since the implementations are byte-identical. The "3+ audits from distinct firms" green flag is not met (only two firms). PDFs are linked from the dashboard's Audit History section.

## 9. Contract Inventory

All ten in-scope contracts are verified on Etherscan, and their implementations are byte-identical to the April-reviewed bytecode (confirmed via the EIP-1967 implementation slots). The new authority is the `TimelockController` at `0xfD5782E3BFF366601da3973aE30C583dE4F08A67` (`getMinDelay() = 432000`, i.e. 5 days).

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
- Audit reports (PDFs) — Three Sigma + 2× Certora, linked from the dashboard's Audit History section
- Prior assessment — the April 2026 report (Grade F / deal-breaker REJECT) is listed under "All reports" on the [protocol dashboard](/protocols/saturn-credit)
- Structured, filterable view — see the [protocol dashboard](/protocols/saturn-credit)

---

*Long-form companion to the dashboard. Descriptive technical analysis only — not financial advice.*
