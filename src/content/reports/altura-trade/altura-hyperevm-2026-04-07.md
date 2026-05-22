# Altura Trade — Long-form Analysis

> Managed single-asset vault on HyperEVM (`NavVault` + `NavOracle`) with off-chain delta-neutral strategies. Share price is reported on-chain by an off-chain operator. Two contracts, ~$12M TVL, three external audits — and zero on-chain governance.

## 1. Executive Summary

Altura Trade is a small two-contract vault deployment on HyperEVM. Depositors mint ERC4626 shares against a single asset; an off-chain operator runs market-making, basis/funding arbitrage, and RWA strategies; net asset value is reported back into `NavOracle` and consumed by `NavVault` to compute share price. The contract code is well-engineered — three external audits (Adevarlabs, Omniscia, Sherlock), `ReentrancyGuard` on every state-changing fund function, slippage-protected wrappers on all four user entry/exit paths, no `delegatecall`, clean Slither output.

The deal-breaker gate fails on two items, both governance/operational rather than code-level:

1. **EOA Fund Control.** A single externally-owned account holds the `OPERATOR` role and can call `moveAssets()` to transfer the entire vault balance (~$12M) to `liquidityRecipient` in one transaction. There is no multisig on the path, no timelock, no per-call cap. The `liquidityRecipient` itself is set by another EOA (`DEFAULT_ADMIN`) with no delay.
2. **Manual Price Control.** A single EOA holds the `REPORTER` role on `NavOracle` and calls `reportNav(pps, ts)` to set arbitrary share prices. The configurable rate limiter (`maxPpsMoveBps`) is set to `0`, which disables it. The `DEFAULT_ADMIN` can re-disable it at any time via `setConfig()` even if it is later enabled.

Score is **0 / 100, Grade F, Critical risk** — when the framework's deal-breaker gate fails, the rest of the assessment pipeline is skipped and the score collapses to zero. The technical engineering picture is otherwise solid; the failure mode is concentrated in operational posture.

## 2. Protocol Overview

Altura Trade is a managed single-asset vault. The asset model and on-chain mechanics are deliberately simple — most of the complexity lives off-chain in the strategy execution.

`NavVault` is an immutable ERC4626 vault. Users call `deposit`, `mint`, `withdraw`, or `redeem` — each with a slippage-protected wrapper (`depositWithCheck`, `mintWithCheck`, `withdrawWithCheck`, `redeemWithCheck`) that takes a `minShares` / `maxAssets` / etc. parameter. Share price is computed by reading the latest reported PPS from `NavOracle`. The vault holds the underlying asset on its own balance; an off-chain operator drains the asset to a designated `liquidityRecipient` address via the privileged `moveAssets()` function, runs strategies, and returns proceeds back to the vault as needed.

`NavOracle` is the share-price source of truth. The off-chain operator (the `REPORTER`) calls `reportNav(pps, ts)` to write a new price-per-share value. The oracle exposes a `staleness` window (a freshness check) and a `maxPpsMoveBps` rate limiter (an upper bound on how much PPS can move between reports). Both are configurable by the `DEFAULT_ADMIN` via `setConfig()`. At the time of audit, `maxPpsMoveBps = 0`, which **disables** the rate limiter — any PPS value is accepted.

Six privileged roles span the two contracts:

- `DEFAULT_ADMIN` (vault + oracle): sets recipient, fees, epoch, oracle config; grants/revokes roles. EOA `0xbF33…ef6E`.
- `OPERATOR` (vault): calls `moveAssets()` to drain the vault into `liquidityRecipient`. EOA `0x0398…8813`.
- `GUARDIAN` (vault): can `pause()` / `unpause()` the vault. EOA `0xff0c…09ef`.
- `REPORTER` (oracle): the only address that can call `reportNav()`. EOA `0x12f8…3D967` (the deployer).
- `GUARDIAN` (oracle): can `pause()` / `unpause()` the oracle. EOA `0x0398…8813` — the same address as the vault `OPERATOR`.
- `liquidityRecipient` (data, not a role): the destination address for `moveAssets()`. EOA `0xFC45…0ADf`.

There is no multisig on any of these. No DAO, no governance token, no on-chain voting. The only timelock anywhere in the system is a 1-day delay on replacing the oracle contract address (`vault.setOracle()`), which means the oracle pointer cannot be flipped instantly. Every other privileged call executes immediately.

The deployment is two contracts: `NavVault` at `0xd0Ee…3f29` and `NavOracle` at `0x314A…AE8F`. Both are immutable (no proxy, no upgrade path) and both are Sourcify-verified at Solidity `^0.8.21`. TVL at audit was approximately $11.98M, computed from the oracle's latest reported NAV. The protocol launched in late 2025 and reports a ~5.7% return since inception via market-making, basis/funding arbitrage, and RWA strategies. The protocol is not listed on DeFiLlama.

## 3. Findings

### 3.1 OPERATOR EOA can drain the entire vault via `moveAssets()`

The `moveAssets(uint256 amount)` function on `NavVault` transfers `amount` of the underlying asset from the vault to `liquidityRecipient`. Access is gated by the `OPERATOR` role, currently held by EOA `0x0398…8813`. The function has no per-call cap, no per-epoch cap, no minimum delay, and no co-signer requirement. A single transaction signed by this key can move the entire ~$12M vault balance.

The function exists for legitimate reasons — the off-chain strategy runner needs to draw assets out of the vault to deploy them. The risk profile inherent to that design is normally bounded by some combination of: a multisig on the operator key, a per-cycle movement cap, a public delay on movement above a threshold, or a designated rebalancer contract that enforces those rules on-chain. None of these are implemented here.

The downstream constraint that gates abuse is `liquidityRecipient` — the OPERATOR can only move funds *to that one address*. But `liquidityRecipient` is itself set by `DEFAULT_ADMIN` (a different EOA) via `setLiquidityRecipient()` with no delay. So a coordinated `setLiquidityRecipient` + `moveAssets` from the two EOAs drains the vault to any address in two transactions — typically a single block. Single-key compromise of OPERATOR moves funds to the configured recipient (still attacker-controlled if the recipient EOA is compromised, since it's also a single-key address).

### 3.2 Oracle REPORTER EOA can set arbitrary share prices

`NavOracle.reportNav(uint256 pps, uint64 ts)` is the function that writes a new price-per-share. Access is gated by the `REPORTER` role, currently held by EOA `0x12f8…3D967` (the contract deployer). The oracle contains a configurable rate limiter — `maxPpsMoveBps` — that bounds how much PPS can move between two reports. **At the time of audit this value is `0`**, which the code treats as "rate limiter disabled". Any PPS value, no matter how large or small, is accepted.

The `DEFAULT_ADMIN` can re-disable the rate limiter at any time via `setConfig(staleness, 0)` even if it is later enabled. There is no governance, no public delay, no floor on the rate-limit value.

The impact is share-price manipulation in either direction. Inflating PPS lets an attacker who is also a depositor redeem out of the vault for far more underlying than they put in (the vault pays out `shares × PPS`). Deflating PPS dilutes existing holders in advance of an attacker's deposit, which then redeems at a restored price. The vault does not need to be "tricked" — the attacker simply sets PPS to whatever produces the desired transfer.

This is the cleanest single-key drain path in the system. It does not require coordinating with another role-holder, does not require touching the underlying asset balance, and can be executed in a single transaction.

### 3.3 ADMIN can change `liquidityRecipient` instantly

`NavVault.setLiquidityRecipient(address)` is the configurator for `moveAssets()`'s destination. It is gated by `DEFAULT_ADMIN` (EOA `0xbF33…ef6E`) and executes immediately. There is no timelock, no public window, no warning.

Combined with finding 3.1, this completes the OPERATOR-extraction picture: the OPERATOR can only move to the configured recipient, but the ADMIN can change that recipient with no delay. A two-key compromise (OPERATOR + ADMIN) drains the vault to any address in one block. A one-key ADMIN compromise reconfigures the recipient and waits for the next legitimate `moveAssets()` call from the OPERATOR (or coordinates with OPERATOR to call it).

### 3.4 ADMIN can re-disable the oracle rate limiter

`NavOracle.setConfig(uint256 staleness, uint256 maxPpsMoveBps)` allows the `DEFAULT_ADMIN` to update both the staleness window and the rate-limiter cap. The function takes `maxPpsMoveBps = 0` to mean "rate limiter disabled". An ADMIN that has re-enabled the rate limiter following audit pressure can re-disable it at any time without warning, then call `reportNav()` with an attacker-favorable PPS, then re-enable it again.

Defense-in-depth here would be either an immutable floor (e.g. `maxPpsMoveBps` cannot be set lower than 100 once enabled) or a governance/timelock requirement to lower it. Neither is implemented. The `setConfig` call is one transaction; the subsequent `reportNav` is one more.

### 3.5 All six privileged role holders are EOAs

`DEFAULT_ADMIN`, `OPERATOR`, `GUARDIAN` (×2 — vault and oracle), `REPORTER`, plus the `liquidityRecipient` data field — every privileged address in the system is a single-key externally-owned account. There is no multisig, no DAO, no MPC, no hardware-wallet attestation surfaced on-chain. The protocol is entirely trust-dependent on the team's off-chain key custody.

This is the structural issue underlying findings 3.1–3.4. Each individual role has a clear technical scope; the operational posture is what produces the deal-breaker outcome. A migration of OPERATOR, REPORTER, and DEFAULT_ADMIN to 3/5 multisigs (with hardware-wallet signers) — without any code changes — would convert the system from "single-key-compromise drains the vault" to "the attacker needs three independent compromises", which is the standard threshold for protocols at this TVL.

## 4. Deal Breaker Analysis

The framework's deal-breaker gate is a fixed checklist. For Altura Trade, 12 items PASS, 2 items FAIL, and 9 items are N/A (proxy/governance/cross-chain items inapplicable to a non-upgradable single-chain non-DAO vault). Two FAILs halts the assessment with a `Fail` outcome.

### 4.1 Access Control & Governance

| Item | Status | Notes |
| --- | --- | --- |
| EOA Upgrade Control | N/A | Not a proxy. No upgrade mechanism. |
| EOA Fund Control | **FAIL** | OPERATOR EOA calls `moveAssets()` to transfer all vault funds to `liquidityRecipient`. ADMIN EOA can change recipient instantly. No multisig, no timelock, no cap. |
| >60% Governance Centralization | N/A | No governance token. |
| Governance Mechanism Bypass | N/A | No governance mechanism. |
| Timelock Backdoors | PASS | 1-day timelock on oracle replacement. No `emergencyExecute` / `fastTrack` found. No timelock on `moveAssets`, `setLiquidityRecipient`, `setExitFeeBps`, `setEpochSeconds`. |
| No Emergency Controls | PASS | `pause()` / `unpause()` via GUARDIAN role on both vault and oracle. |

### 4.2 Oracle & Price Integrity

| Item | Status | Notes |
| --- | --- | --- |
| Direct Pool Price Oracle | N/A | Managed single-asset vault; share price from admin-reported NAV, no DEX pool oracle. |
| Manual Price Control | **FAIL** | REPORTER EOA calls `reportNav(pps, ts)` to set arbitrary PPS. `maxPpsMoveBps = 0` (rate limiter disabled). ADMIN can re-disable via `setConfig()`. |

### 4.3 Smart Contract Architecture

| Item | Status | Notes |
| --- | --- | --- |
| Known Compiler Bugs | PASS | Solidity `^0.8.21`. No known CVEs. |
| No Reentrancy Protection | PASS | `ReentrancyGuard` (`nonReentrant`) on all 15 state-changing fund functions. |
| Unlimited Minting | PASS | Shares minted only via ERC4626 `deposit()` / `mint()` — requires matching asset transfer. |
| Unsafe Delegatecall | PASS | No `delegatecall` or `.call{}` in custom code. |
| Uninitialized Implementation | N/A | Not a proxy. |
| Unprotected Initializer | N/A | No initializer; constructor only. |

### 4.4 Audit & Verification

| Item | Status | Notes |
| --- | --- | --- |
| No Audit + High TVL | PASS | TVL ~$12M; three external audits (Adevarlabs, Omniscia, Sherlock). |
| Unverified Contracts | PASS | Both core contracts Sourcify-verified. |
| Critical Unfixed Issues | PASS | No critical/high unfixed issues known. |

### 4.5 Economic & Liquidity

| Item | Status | Notes |
| --- | --- | --- |
| Zero Flash Loan Protection | PASS | Oracle-driven NAV not manipulable via flash loans (PPS set off-chain). |
| Broken Tokenomics | PASS | ~5.7% return since inception. Strategies: market making, basis/funding arb, RWA. No unsustainable emission. |
| No Slippage Protection | PASS | `depositWithCheck`, `withdrawWithCheck`, `redeemWithCheck`, `mintWithCheck` all present. |

### 4.6 Cross-Chain & Bridges

| Item | Status | Notes |
| --- | --- | --- |
| Centralized Bridge | N/A | Not a bridge protocol. |
| No Transfer Limits | N/A | Not a bridge protocol. |
| No Token Verification | N/A | Not a bridge protocol. |

## 5. Trust & Permissions

| Surface | Controller | Type | Delay | Worst case |
| --- | --- | --- | --- | --- |
| `NavVault` — `moveAssets()` | `0x0398…8813` | EOA | 0 | Transfer entire vault balance (~$12M) to `liquidityRecipient` in a single tx |
| `NavVault` — `setLiquidityRecipient()` | `0xbF33…ef6E` | EOA | 0 | Redirect `moveAssets()` destination to any address; combined with OPERATOR drains funds anywhere |
| `NavOracle` — `reportNav()` | `0x12f8…3D967` | EOA | 0 | Set arbitrary PPS — extract from depositors or dilute existing holders. Rate limiter disabled |
| `NavOracle` — `setConfig()` | `0xbF33…ef6E` | EOA | 0 | Re-disable `maxPpsMoveBps` or modify staleness; renders future rate-limit hardening unenforceable |
| `NavVault` — `setOracle()` | `0xbF33…ef6E` | EOA | 24h | Replace NAV oracle with attacker implementation. The 1-day timelock is the only public delay anywhere in the system |
| `NavVault` & `NavOracle` — `pause()` | `0xff0c…09ef` / `0x0398…8813` | EOA | 0 | Block deposits/withdrawals indefinitely (denial-of-service); does not enable theft alone |

Trust authority concentrates almost entirely in `0xbF33…ef6E` (`DEFAULT_ADMIN` on both contracts) and `0x0398…8813` (`OPERATOR` on the vault, `GUARDIAN` on the oracle). The deployer EOA `0x12f8…3D967` is the live `REPORTER` and has not been rotated. Compromise of any one of these three keys yields a single-block path to either fund extraction or share-price manipulation. The 1-day timelock on `setOracle()` is the protocol's only on-chain delay window — every other privileged call executes immediately.

The remediation path is operational rather than structural: migrate `DEFAULT_ADMIN`, `OPERATOR`, and `REPORTER` to multisigs (3/5 minimum, hardware-wallet signers); add a 48-hour timelock to `setLiquidityRecipient()` and `setConfig()`; enable `maxPpsMoveBps` with a meaningful cap (e.g., 100 bps) and consider an immutable floor or a governance-only lower-bound. None of these require contract redeployment for the multisig migration; the timelock and rate-limiter floor changes do require config or contract updates.

## 6. Architecture Notes

### 6.1 Upgrade pattern

There is none. Both `NavVault` and `NavOracle` are immutable contracts deployed without proxies. This is unusual for a TVL-bearing vault and is a meaningful security property — the contract code as deployed cannot be replaced. The trade-off is that any code-level fix (rate-limiter enforcement, timelock, multisig integration) requires a fresh deployment and an asset migration.

### 6.2 Oracle integration

`NavOracle` is the price-per-share source of truth, written by the off-chain `REPORTER` via `reportNav(pps, ts)`. The oracle exposes two configurable defenses: `staleness` (a freshness check that rejects stale reads) and `maxPpsMoveBps` (a per-update PPS rate limiter). Both are configured via `setConfig()` by the `DEFAULT_ADMIN`. The vault reads the oracle through `NavVault.setOracle()`-pinned reference, which has the system's only timelock (1 day).

`maxPpsMoveBps = 0` at the time of audit is the central operational concern. The defensive primitive exists in code; it is configured to its disabled value. The fix is a single `setConfig()` call by ADMIN.

### 6.3 Reentrancy and locking

Aggressive use of `ReentrancyGuard.nonReentrant` on every state-changing fund function (15 entry points). External calls follow CEI in code paths reviewed. No `delegatecall`, no unvalidated `.call{}` to user-supplied addresses. Slither returns 0 findings across both contracts. This is the cleanest part of the implementation.

### 6.4 Withdrawal mechanics

Standard ERC4626 with slippage-protected wrappers. No async / queue mechanism — withdrawals execute against the vault's current asset balance. This means liquidity-pressure events (the OPERATOR drains too much to `liquidityRecipient` and a depositor wants out) revert at the underlying transfer step rather than blocking deposits or distorting accounting. There is no on-chain reconciliation forcing the OPERATOR to keep a minimum balance in the vault.

### 6.5 Aggravating factors beyond the deal breakers

- **No bug bounty.** Immunefi page returns 404; no `security.txt` or public security email surfaced. Researchers who find vulnerabilities have no documented disclosure path or incentive structure.
- **REPORTER is the deployer EOA.** Roles set during deployment have not been rotated post-launch. The deployer key, which is by convention treated as compromised in incident-response playbooks, is the live oracle writer.
- **Vault and oracle GUARDIAN share an EOA.** `0x0398…8813` is both vault `OPERATOR` and oracle `GUARDIAN` — one key, two privileged powers.
- **`liquidityRecipient` is an EOA.** Even with multisig migration of the role-holders, the configured destination is a single-key address. A multisig-controlled rebalancer contract would be the natural target instead.
- **No DeFiLlama listing.** Independent TVL monitoring relies on the oracle's reported NAV, which is the same value the system uses internally — there is no external check.

## 7. Open Issues

The framework's open-issue list is reproduced below in narrative form. Priorities (P0/P1/P2) are addressed to the protocol team's roadmap, not to readers.

### 7.1 P0 — immediate

1. **OPERATOR EOA can drain vault via `moveAssets()`.** *Critical, Access Control.* Full loss of vault funds (~$12M). Recommendation: migrate OPERATOR to multisig (3/5 minimum); add timelock or per-epoch cap to `moveAssets()`.
2. **Oracle REPORTER can set arbitrary PPS.** *Critical, Oracle.* Share-price manipulation enables extraction or dilution. Recommendation: enable `maxPpsMoveBps` (e.g., 100 = 1% max move per update); migrate REPORTER to multisig or MPC.
3. **All roles are EOAs, no multisig.** *High, Access Control.* Single-key compromise = full protocol control. Recommendation: migrate `DEFAULT_ADMIN`, `OPERATOR`, `GUARDIAN` to multisigs; use hardware wallets for all signers.

### 7.2 P1 — within 1 week

4. **`setLiquidityRecipient()` has no timelock.** *High, Access Control.* ADMIN can redirect fund destination instantly. Recommendation: add timelock (minimum 48h).
5. **ADMIN can re-disable oracle rate limiter.** *High, Oracle.* `setConfig(staleness, 0)` disables `maxPpsMoveBps`. Recommendation: make rate-limiter floor immutable, or require governance approval to lower it.

### 7.3 P2 — within 1 month

6. **No bug bounty program.** *Medium, Operations.* Reduced incentive for responsible disclosure. Recommendation: launch bug bounty on Immunefi with meaningful rewards (>$100K max).

## 8. Audit History

| Date | Firm | Tier | Scope |
| --- | --- | --- | --- |
| 12/2025 | Adevarlabs | 3 | Predeposit + Vault |
| 01/2026 | Omniscia | 2 | Vault + Token/Vesting |
| 02/2026 | Sherlock | 2 | Vault + WithdrawalWrapper (contest model) |

Three external audits in three consecutive months is unusually thorough for a protocol of this size. Engagement diversity matters: Omniscia does standard manual review, Sherlock runs a competitive contest model where independent researchers compete for findings, and Adevarlabs is a smaller specialized firm. The combination covers different review styles. None of the three engagement reports identified the deal-breaker findings recorded here, however — the issues are governance/operational posture, which audit firms typically flag as observations rather than vulnerabilities, and which are not always weighted equally in audit summaries.

## 9. Contract Inventory

| Name | Address | Type | Compiler |
| --- | --- | --- | --- |
| NavVault | `0xd0Ee0CF300DFB598270cd7F4D0c6E0D8F6e13f29` | Immutable | 0.8.21 |
| NavOracle | `0x314A79618d86309e91aa972CAfd143ffca80AE8F` | Immutable | 0.8.21 |

Both Sourcify-verified. No proxies, no upgrade paths.

## 10. References

- Website — [https://altura.trade](https://altura.trade)
- Documentation — [https://docs.altura.trade](https://docs.altura.trade)
- Audit reports — Adevarlabs (Dec 2025), Omniscia ([report](https://omniscia.io/reports/altura-trade-nav-contracts-6954ecaa2978aa00155d5541), Jan 2026), Sherlock (Feb 2026)
- Protocol dashboard — [/protocols/altura-trade](/protocols/altura-trade)

---

*Long-form companion to the dashboard. Descriptive technical analysis only — not financial advice.*
