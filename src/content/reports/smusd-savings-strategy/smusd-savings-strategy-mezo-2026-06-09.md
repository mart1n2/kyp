# MUSD Savings Strategy (sMUSD) — Long-form Analysis

> Mezo's "Earn" savings product: deposit MUSD, mint sMUSD 1:1, park the principal in a passive strategy, and stake sMUSD in a Velodrome-v2 gauge to earn MEZO emissions. Par mechanics, instant fee-free exit — with all custody authority resting on a single team multisig.

## 1. Executive Summary

The MUSD Savings Strategy is Mezo's yield product for MUSD holders, composed of three in-scope contracts: the `MUSDSavingsRate` vault (sMUSD), a passive `IdleStrategy` that custodies principal, and a `VaultGauge` (Velodrome v2) that pays MEZO emissions to stakers. The single user flow is: deposit MUSD → mint sMUSD 1:1 → principal sits in `IdleStrategy` → stake sMUSD in `VaultGauge` → earn MEZO emissions. Protocol fees stream from the MUSD `PCV` to the vault and accrue to sMUSD via a yield index; for staked sMUSD (≈99% of supply) that fee-yield is pulled by the gauge (capped at 10k per claim) and redirected to veBTC voters, while the staker earns MEZO. Withdrawals are par, instant, and fee-free at every layer.

The assessment assigns a security score of **72.0 / 100**, grade **B+**, risk level **Medium**. The deal-breaker gate clears with no failures (14 PASS, 9 N/A across the 23-item checklist). The code layer is genuinely strong: all three contracts are verified on the Mezo explorer, double-audited by Halborn and Thesis Defense under the "Mezo Earn" engagement with 100% of findings reported addressed, and Slither-clean across both compilations. Par 1:1 mechanics with instant fee-free exit limit the economic attack surface, and the par invariant holds exactly on-chain (strategy MUSD = sMUSD supply ≈ $6.7M).

The grade is held below A− by one structural weakness that is a governance choice, not a code defect: the vault is an upgradeable proxy and `setStrategy()` migrates *all* principal to an owner-chosen contract — both controlled by the same no-timelock 5-of-9 Mezo-team Safe. A malicious or compromised Safe could drain the entire vault in a single transaction with no warning or reaction window. As with the underlying MUSD token, the Safe is the Mezo/Thesis team that already runs the chain's validators, oracle, and bridge — so this is chain-level trust concentration rather than an extra counterparty, but the no-timelock mechanism remains the binding constraint. This report is a companion to the underlying MUSD assessment; the savings strategy is a superset of that exposure.

## 2. Protocol Overview

The product is a custom (non-ERC4626) savings vault wrapped by a Velodrome-style staking gauge. Three layers compose it, and the assessment scores each across all three contracts, taking the binding (most conservative) layer wherever fund safety is concerned.

The **vault (`MUSDSavingsRate`)** is the entry point. `deposit(amount)` mints sMUSD 1:1 and forwards the MUSD to the active strategy; `withdraw(amount)` deallocates from the strategy, burns sMUSD, returns MUSD 1:1, and claims accrued yield. Yield is tracked through a `yieldIndex` accumulator: the MUSD `PCV` pushes protocol fees into the vault via `receiveProtocolYield`, and the index updates on every transfer so incumbents are paid before any new flow dilutes them. The vault is a `TransparentUpgradeableProxy` built on OpenZeppelin v4 upgradeable contracts with ERC2771 meta-transaction support. Owner functions — all held by the 5/9 Safe — are `setStrategy`, `setPCV`, `setVaultGauge`, and `setGaugeYieldClaimCap`; the gauge yield-claim is capped at 10k MUSD per claim.

The **strategy (`IdleStrategy`)** is, today, a passive MUSD custodian. It exposes `onlyVault` allocate / deallocate / migrate entry points and `claimYield()` that returns zero — there is no external venue, so there is no external-venue or liquidity risk in the current configuration. It is an immutable contract (no upgrade path) and at assessment time held 6.484M MUSD, i.e. 100% of principal.

The **gauge (`VaultGauge`)** is a faithful Velodrome v2 staking gauge. Staking sMUSD earns MEZO emissions distributed by the Velodrome `Voter` via `notifyRewardAmount` (voter-only). Its `_claimFees` routine pulls the vault's `claimYield()` (capped) and forwards it to `feesVotingReward` for veBTC voters. The gauge is immutable, and crucially its `withdraw()` has no kill-gate — a staker can always unstake regardless of gauge lifecycle state. At assessment time the gauge held 6.416M sMUSD, roughly 99% of supply.

Operator authority is concentrated in a single 5-of-9 Gnosis Safe (`0x98D8…7C7a`, v1.3.0) — the same multisig that governs the underlying MUSD protocol. It owns the vault's ProxyAdmin and is the vault owner; it is also the ProxyAdmin owner, `governor`, and `emergencyCouncil` of the external Velodrome `Voter` and `VeBTC` (`ve`) contracts. The `IdleStrategy` and `VaultGauge` themselves are immutable and hold no admin seize function. Key deployment parameters: sMUSD:MUSD fixed 1:1 (no oracle), a 1e18-scaled yield index, a 10k MUSD per-claim gauge cap, and instant 0-hour withdrawals at every layer. The deployment is Mezo-only with ~$6.7M TVL; the full Earn system carries two top-tier audits.

## 3. Findings

### 3.1 Admin can drain 100% of principal at will, instantly

The single largest risk, and the reason the grade is capped at B+, is that the vault is an upgradeable proxy and `setStrategy()` migrates *all* principal to an owner-chosen contract — both controlled by the no-timelock 5/9 Safe. There are two equivalent paths to total loss: upgrade the vault implementation to one that transfers out the backing MUSD, or call `setStrategy()` to point at an attacker-controlled "strategy" that simply keeps the migrated principal. Either executes in a single transaction with no public delay and no reaction window.

The impact is unambiguous: 100% of deposited principal is reachable by the holder(s) of the Safe. The vault's careful par accounting and instant exits do not help here, because the threat is not a logic bug a user could front-run — it is the legitimate owner exercising legitimate owner powers maliciously or under key compromise.

The context that keeps this from being worse: the Safe is the Mezo/Thesis team that a user already trusts at the chain layer (validators, oracle, bridge), so it concentrates existing trust rather than adding a new counterparty; the threshold is 5-of-9; and the fix surface is narrow. A timelock on the Safe, and/or a cap or whitelist on `setStrategy` migrations, would address this single HIGH finding and lift the assessment toward A−.

### 3.2 Today's safety depends on the strategy staying "Idle"

A large part of why the strategy reads as low-risk today is that principal sits in `IdleStrategy` — a passive custodian with no external venue and full liquidity. That property is not structurally guaranteed; it is a configuration the Safe can change. If the owner points `setStrategy()` at a yield-bearing strategy, the risk profile shifts: external-venue and liquidity risk appear, and a latent denial-of-service surfaces (M-2). The vault's `AmountTooSmall` guard, which today protects against rounding loss, can revert deposits or withdrawals if a future strategy returns dust yield — turning a safety check into a liveness problem.

The important nuance is that this is a *quiet config change*, not a code upgrade — it does not require a new implementation or a visible upgrade event in the same way a proxy upgrade does, so monitoring must watch `setStrategy` specifically. The mitigation is to keep the strategy on `IdleStrategy` (or re-review before any switch) and to make dust handling skip/round rather than revert.

### 3.3 ~99% of sMUSD lives in the gauge, which depends on the Velodrome ve/Voter system

Because nearly all sMUSD is staked, the staked balance's fee-yield routes through `VaultGauge` → `Voter` / `ve` / `feesVotingReward`. This pulls in the external Velodrome ve(3,3) governance system. The assessment reviewed the `Voter` and `VeBTC` access-control and fund paths directly and confirmed a key boundary: this layer handles only MEZO emissions, voting, and gauge lifecycle — it never custodies or moves staked sMUSD.

Concretely, `killGauge` (emergencyCouncil-only) merely returns unclaimed MEZO to the splitter, and the gauge is immutable with a no-kill-gate `withdraw()`, so a failure or even a malicious action in this layer costs *rewards and fees, not principal*. The staker can always unstake. Both `ve` and `Voter` are themselves upgradeable by the same 5/9 Safe, which extends the governance surface, but — per the path review — not to staked principal. The residual exposure here is opportunity-cost (MEZO emission value depends on the external Velodrome schedule), not loss of deposits.

### 3.4 Trust and verification residuals

A cluster of lower-severity items rounds out the picture. The deployed bytecode was not byte-matched to the exact audited commit (`tigris-token-launch` @ `afafb42…`), so audited-equals-deployed is asserted, not proven (tracked in confidence, not a red flag because the Earn audits do cover the system). The documentation claims share-price appreciation, but the code is par with separately-claimed yield — an integration mismatch that could mislead integrators (L-3). And Halborn's flash-loan fix (7.1) was described as a "minimum deposit duration," yet withdrawals are instant (0h) on-chain; the deployed mitigation should be confirmed against that 0-hour lock (L-2). None of these threaten principal, but together they define what "confirm before relying on it" means for this product.

### 3.5 Why the code layer is a counterweight

The findings above are about *who controls the vault* and *what to confirm*, not about defects. The substantive code is sound. All three contracts are verified and were reviewed directly; the full system carries two top-tier audits (Halborn + Thesis Defense) with 100% of findings reported addressed; Slither found no true positives across both compilations; and the mechanics are par 1:1 with instant fee-free exit at every layer. The par invariant — strategy MUSD equals sMUSD supply — held exactly on-chain at assessment time. This is why the assessment lands at B+ rather than lower despite the HIGH centralization finding.

## 4. Deal Breaker Analysis

The framework's deal-breaker gate is a fixed 23-item checklist; any FAIL halts the assessment with a `Fail` outcome. The savings strategy clears the gate with **14 PASS, 0 FAIL, 9 N/A** (Oracle and Cross-Chain categories are not applicable to a par, single-chain vault).

### 4.1 Access Control & Governance

| Item | Status | Notes |
| --- | --- | --- |
| EOA Upgrade Control | PASS | Vault proxy admin owned by the 5/9 Safe `0x98D8…7C7a`; `IdleStrategy` and `VaultGauge` are immutable. |
| EOA Fund Control | PASS | No single-EOA withdrawal; principal moves via `onlyOwner setStrategy` / `onlyVault` strategy; staked sMUSD is staker-withdrawable only. |
| >60% Governance Centralization | N/A | No governance token in scope. |
| Governance Mechanism Bypass | N/A | No token voting in scope (MEZO/ve external, audited under Earn). |
| Timelock Backdoors | PASS | No bypass functions, but **no timelock** on the vault upgrade / `setStrategy` path — scored as a risk (see §3.1). |
| No Emergency Controls | N/A | Non-custodial; instant par withdrawal + unconditional unstake are the user's exit. |

### 4.2 Oracle & Price Integrity

| Item | Status | Notes |
| --- | --- | --- |
| Direct Pool Price Oracle | N/A | No external price feed; sMUSD:MUSD is fixed 1:1 (par). |
| Manual Price Control | N/A | No price oracle; gauge rewards are time-based MEZO emissions. |

### 4.3 Smart Contract Architecture

| Item | Status | Notes |
| --- | --- | --- |
| Known Compiler Bugs | PASS | Solidity `0.8.33` (vault/strategy), `0.8.24` (gauge); no applicable CVE. |
| No Reentrancy Protection | PASS | `nonReentrant` on all user/state-changing paths; MUSD/sMUSD have no attacker callback. |
| Unlimited Minting | PASS | sMUSD minted strictly 1:1 vs MUSD pulled in; the gauge mints nothing. |
| Unsafe Delegatecall / Call | PASS | No `delegatecall`; SafeERC20 only. |
| Uninitialized Implementation | PASS | Vault calls `_disableInitializers()`; strategy and gauge are immutable. |
| Unprotected Initializer | PASS | Vault `initialize()` guarded; no initializer on strategy/gauge. |

### 4.4 Audit & Verification

| Item | Status | Notes |
| --- | --- | --- |
| No Audit + High TVL | PASS | TVL ~$6.7M; two top-tier audits cover the full Earn system, 100% of findings addressed. |
| Unverified Contracts | PASS | All three contracts verified on `api.explorer.mezo.org`; reviewed directly. |
| Critical Unfixed Issues | PASS | Halborn: 0 Critical, 1 High — all reported findings addressed. |

### 4.5 Economic & Liquidity

| Item | Status | Notes |
| --- | --- | --- |
| Zero Flash Loan Protection | PASS | Par redemption; the vault flushes yield on deposit/withdraw; Halborn 7.1 reported addressed (verify deployed, L-2). |
| Broken Tokenomics | PASS | Fee-yield = real MUSD protocol fees; MEZO emissions depend on the external Velodrome schedule. |
| No Slippage Protection | N/A | 1:1 par; no swaps. |

### 4.6 Cross-Chain & Bridges

| Item | Status | Notes |
| --- | --- | --- |
| Centralized Bridge | N/A | Not cross-chain; the strategy operates entirely on Mezo. |
| No Transfer Limits | N/A | Not a bridge. |
| No Token Verification | N/A | Not a bridge. |

## 5. Trust & Permissions

Authority concentrates in the same 5-of-9 Gnosis Safe that governs the underlying MUSD protocol.

| Surface | Controller | Type | Min delay | Worst case |
| --- | --- | --- | --- | --- |
| sMUSD vault — Proxy upgrade | `0x98D8…7C7a` | Multisig 5/9 | Instant | Upgrade the vault to drain 100% of deposited principal |
| sMUSD vault — `setStrategy` | `0x98D8…7C7a` | Multisig 5/9 | Instant | Migrate 100% of principal to an owner-chosen contract |
| sMUSD vault — `setPCV` / `setVaultGauge` / `setGaugeYieldClaimCap` | `0x98D8…7C7a` | Multisig 5/9 | Instant | Redirect yield source/gauge or change fee cap (rewards, not principal) |
| Velodrome `Voter` / `VeBTC` — Proxy upgrade & emergencyCouncil | `0x98D8…7C7a` | Multisig 5/9 | Instant | Upgrade ve/Voter or `killGauge` — governance surface, not staked principal |

Two observations follow. First, the **binding constraint is the upgradeable vault plus `setStrategy`** under a no-timelock multisig — every other surface is either immutable (`IdleStrategy`, `VaultGauge`), staker-only (gauge `withdraw`), or reaches only the rewards layer. The protocol has good *structural* boundaries: principal cannot be reached by the gauge, the ve/Voter system, or any party other than the vault owner. What it lacks is a *temporal* boundary on that owner.

Second, the trust collapses into the same "trust the Mezo team + chain" bet as the MUSD token, because the controlling Safe is identical. The single change that most improves the posture is a Safe timelock (and/or a migration cap on `setStrategy`), which would convert the dominant total-loss path into one with a public reaction window. Staking adds reward-layer risk but not principal risk, because the gauge is immutable and its `withdraw()` is always available.

## 6. Architecture Notes

### 6.1 Upgrade pattern

Only the vault is upgradeable — a `TransparentUpgradeableProxy` whose ProxyAdmin is owned by the 5/9 Safe. `IdleStrategy` and `VaultGauge` are immutable, which removes them as upgrade-risk surfaces entirely. The vault's V2 fields are appended (collision-safe) with no migration-test surface to score. The flip side of this clean design is that the one upgradeable contract is the one that custodies principal (§3.1).

### 6.2 Yield accounting

The vault tracks yield via a 1e18-scaled `yieldIndex` / `supplyYieldIndex` / `claimable` triple, updated on every transfer. Deposits and withdrawals flush yield to incumbents first, which neutralizes just-in-time (JIT) sniping of accrued fees. The MUSD `PCV` pushes fees in through `receiveProtocolYield`, distributing the caller's own transferred MUSD pro-rata — never a profitable action for an attacker. This is why Flash Loan & MEV is an N/A category here: there is no swap or flash surface, and a stake-then-exit earns approximately zero.

### 6.3 Reentrancy and locking

`nonReentrant` guards cover vault `deposit`/`withdraw`/`claimYield` and all gauge state-changers, and the yield index updates on every transfer. Slither's `reentrancy-no-eth` flags are all guarded false positives, as are its `mulDiv` flags (OpenZeppelin `Math`) and the IdleStrategy `arbitrary-send-erc20` flag (an `onlyVault` pull). No true positives were found across either compilation.

### 6.4 Reward and gauge mechanics

The gauge is faithful Velodrome v2: Synthetix-style reward math with `RewardRateTooHigh` / `ZeroRewardRate` guards, MEZO emissions via voter-only `notifyRewardAmount`, and a `_claimFees` path that forwards capped vault yield to `feesVotingReward`. The gauge is immutable and its `withdraw()` has no kill-gate, so stakers retain an unconditional exit irrespective of gauge lifecycle (`killGauge`/`reviveGauge`) actions taken by the emergencyCouncil.

### 6.5 Aggravating factors beyond the deal breakers

- **No timelock** on the vault upgrade / `setStrategy` path — the single most consequential non-breaker (§3.1).
- **Latent dust DoS (M-2)**: `AmountTooSmall` can revert deposit/withdraw if a future yield strategy returns dust — inert while on `IdleStrategy`.
- **Deprecated `safeApprove` (M-3)**: the gauge `_claimFees` uses `safeApprove(feesVotingReward, …)`; a residual allowance can DoS fee forwarding (rewards only). `forceApprove` is the fix.
- **Single-step ownership (L-1)**: the vault uses single-step `OwnableUpgradeable` (Halborn 7.10, reported addressed); minor missing zero-checks in `IdleStrategy` and the gauge `withdraw`.
- **Off-chain / external dependency**: MEZO emission value depends on the external Velodrome governance schedule — an opportunity-cost, not a principal risk.

## 7. Open Issues

Eight issues are surfaced for the protocol team. Priorities reflect engineering urgency for the maintainers, not a position on the protocol from this site's perspective.

### 7.1 P1 — within 1 month

1. **No-timelock 5/9 Safe can upgrade the vault or `setStrategy` to migrate 100% of principal (H-1).** *High, Access Control.* Latent total-loss power with no reaction window. Recommendation: timelock the Safe; whitelist/delay strategy changes; cap the migratable amount.

### 7.2 P2 — within 3 months

2. **Yield misallocation during a strategy migration race (M-1).** *Medium, Smart Contract.* Found by Halborn 7.6; reported addressed — confirm in the deployed commit.
3. **`AmountTooSmall` revert can DoS deposit/withdraw with a dust-yield strategy (M-2).** *Medium, Economic.* Latent (N/A while on `IdleStrategy`). Recommendation: skip or round dust instead of reverting.
4. **Gauge `_claimFees` uses deprecated `safeApprove(feesVotingReward, …)` (M-3).** *Medium, Smart Contract.* Residual allowance can cause fee-forwarding DoS (rewards only). Recommendation: use `forceApprove`.
5. **First depositor can capture accumulated `pendingYield` after a full-exit period (M-4).** *Medium, Economic.* Found by Halborn 7.7; reported addressed — confirm in the deployed commit.
6. **Single-step `Ownable` on the vault; missing zero-checks (L-1).** *Low, Access Control.* Halborn 7.10 reported addressed; minor.
7. **Flash-loan fix (min deposit duration) vs deployed instant withdrawal (L-2).** *Low, Economic.* Confirm the deployed flash-loan mitigation given the 0h withdrawal lock.
8. **Docs claim exchange-rate appreciation; code is par + separately-claimed yield (L-3).** *Low, Documentation.* Fix the docs / clarify the gauge-redirect UX.

A Slither informational set (OZ `Math.mulDiv`, IdleStrategy `arbitrary-send`, guarded reentrancy) was reviewed and confirmed as false positives; it is not tracked as an open issue.

## 8. Audit History

| Date | Firm | Tier | Note |
| --- | --- | --- | --- |
| 2026-01-08 | Halborn | 2 | Mezo Earn — vault + strategy + gauge + ve. 0 Critical · 1 High · 4 Medium · 4 Low · 7 Info — 100% addressed. |
| 2026-01-30 | Thesis Defense | 2 | `tigris-token-launch` @ `afafb42` — veBTC/veMEZO VotingEscrow, gauges (incl. MUSD Savings Rate), boost, reward distribution. 9 findings. |

The full Earn system carries two distinct engagements, which is meaningful coverage for a three-contract product, and crucially the audits span not just the vault/strategy/gauge but the ve(3,3) economic internals the gauge depends on. The assessment relied on the Earn audits for those ve internals (boost, revocable grants, managed NFTs) and the `feesVotingReward` contract (reviewed via interface only), while reviewing the `Voter` and `VeBTC` access-control and fund paths directly. Two audits fall short of the "3+ distinct firms" bar, which is the main reason Code Quality lands at A− rather than A. The residual is that deployed bytecode was not byte-matched to the audited commit. Report PDFs are linked from the dashboard's Audit History section.

## 9. Contract Inventory

The three in-scope contracts are verified on `api.explorer.mezo.org`; the dependency entries (MUSD, PCV, MEZO precompile) are listed for reference.

| Contract | Address | Type | Compiler |
| --- | --- | --- | --- |
| sMUSD vault (proxy) | `0xb4D498029af77680cD1eF828b967f010d06C51CC` | TransparentUpgradeableProxy | 0.8.33 |
| sMUSD vault (impl) | `0xb33c3f97bf3b7df59417d114c694353e42929e87` | `MUSDSavingsRate` (OZ v4 upgradeable, ERC2771) | 0.8.33 |
| sMUSD vault ProxyAdmin | `0x973c1a54b1b8d4ad04ea1d8469cda159672b95d0` | ProxyAdmin (owner = 5/9 Safe) | 0.8.33 |
| IdleStrategy | `0x0C0944713c185ea3e64F5609ECee3fB3C054a295` | Immutable strategy (holds 100% principal) | 0.8.33 |
| VaultGauge | `0x677817bF3e44b90E8F95222F75e2950b7904a401` | Immutable Velodrome-v2 gauge (~99% of sMUSD) | 0.8.24 |
| Reward token (MEZO) | `0x7B7c000000000000000000000000000000000001` | Emission token (Mezo precompile) | n/a |
| Voter (proxy) | `0x48233cCC97B87Ba93bCA212cbEe48e3210211f03` | Velodrome `Voter` (TransparentUpgradeableProxy) | 0.8.24 |
| VotingEscrow / ve (proxy) | `0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279` | `VeBTC` VotingEscrow (proxy) | 0.8.24 |
| Underlying asset (MUSD) | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | Underlying asset — see MUSD report | 0.8.24 |
| PCV (yield source) | `0x391EcC7ffEFc48cff41D0F2Bb36e38b82180B993` | MUSD `PCV` (yield source) | 0.8.24 |

The Safe owner is `0x98D8899c3030741925BE630C710A98B57F397C7a` (5/9, v1.3.0). The `feesVotingReward` ve(3,3) reward contract receives gauge-redirected MUSD fee-yield for veBTC voters and was reviewed via interface only.

## 10. References

- Website — <https://mezo.org/>
- Documentation — <https://mezo.org/docs>
- Audit reports (PDFs) — Halborn (2026-01-08) and Thesis Defense (2026-01-30) "Mezo Earn", linked from the dashboard's Audit History section
- Related — the underlying MUSD assessment: [MUSD dashboard](/protocols/musd). This savings strategy is a superset of that exposure.
- Structured, filterable view — see the [protocol dashboard](/protocols/smusd-savings-strategy)

---

*Long-form companion to the dashboard. Descriptive technical analysis only — not financial advice.*
