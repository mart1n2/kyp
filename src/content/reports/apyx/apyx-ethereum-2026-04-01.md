# APYX — Long-form Analysis

> Yield-bearing stablecoin protocol on Ethereum. `apxUSD` is a stablecoin claim on off-chain MSTR preferred-stock dividends; `apyUSD` is an ERC-4626 vault over `apxUSD` that distributes the yield. Operated by an ex-Kraken executive team behind a $300M strategic round.

## 1. Executive Summary

APYX is a two-asset stablecoin system on Ethereum mainnet built on OpenZeppelin v5.5.0 upgradeable contracts. `apxUSD` is the unit of account and the user-facing stablecoin, structurally backed off-chain by MSTR (MicroStrategy) preferred-stock dividends held by a related operating entity. `apyUSD` is an ERC-4626 vault that accepts `apxUSD` deposits and accrues yield drawn from those off-chain dividends, mediated by an on-chain `Vesting` contract.

All twelve enumerated deal-breaker conditions in the protocol-applicable categories pass; the seven non-applicable items relate to bridges, governance, and oracle paths that are inapplicable to a single-chain managed-vault design. The deal-breaker gate clears, and the protocol scores **72 / 100, Grade B, Medium risk**.

The score is held below A- by three substantive concerns: (i) `apyUSD.setVesting()` accepts any `IVesting` implementation with no output-bounds validation on `vestedAmount()`, giving the 3/6 admin multisig a path to manipulate `totalAssets()` and share price without timelock; (ii) the ADMIN role on the central `AccessManager` has zero execution delay, so upgrades and configuration changes execute immediately after multisig approval at $75M+ TVL; and (iii) `apxUSD`'s backing is entirely off-chain with no on-chain proof-of-reserve mechanism. Counterbalancing strengths include a 30-day `UnlockToken` cooldown that structurally blocks flash-loan extraction, OZ 5.5.0 ERC-4626 built-in inflation protection that makes the donation attack non-profitable even at `_decimalsOffset()=0`, three top-tier audits (Zellic, Quantstamp, Certora) with critical and high findings confirmed fixed, a clean Slither output, and a doxxed team of ex-Kraken executives.

## 2. Protocol Overview

APYX implements a yield-bearing stablecoin in the layered "stablecoin + ERC-4626 vault" pattern that Ethena, Mountain, and Saturn Credit also use. The asset relationships:

- **`apxUSD`** — The user-facing stablecoin. Exposed supply at the time of audit was approximately $75.3M. Backing is **off-chain**: the operating entity (Preference Capital BVI) holds MSTR preferred stock and reflects accrued dividends back into the protocol as yield. There is no on-chain proof-of-reserve oracle, no on-chain redemption mechanism against the underlying preferred stock, and no on-chain attestation pipeline. The protocol's economic safety rests on trusting the team's off-chain custody.
- **`apyUSD`** — A standard OZ 5.5.0 ERC-4626 vault that accepts `apxUSD` and issues vault shares. TVL at audit was approximately $38.6M. The vault is upgradeable (UUPS) and uses the OZ built-in `+1` virtual share / `+1` virtual asset mechanism in `_convertToShares` / `_convertToAssets`, even with `_decimalsOffset()=0`. Per OZ's own analysis, this defeats the first-depositor inflation attack by making it non-profitable.

Yield distribution flows through the `Vesting` contract. The processor moves accrued yield into the vesting position; `vestedAmount()` is read by `apyUSD.totalAssets()` (after the unlock cooldown) to update share price. New rewards are vested linearly, capping per-cycle share-price impact at `maxRewardsBps = 2.5%`.

Withdrawals from `apyUSD` are gated by a 30-day `UnlockToken` cooldown. A user requesting redemption mints a non-transferable `UnlockToken` representing their position; the underlying `apxUSD` becomes claimable only after 30 days. This cooldown is the protocol's primary architectural defense — it eliminates same-block flash-loan extraction independent of any other mitigation. Donations or short-term share-price manipulation cannot be cashed out within the same block, and the OZ virtual-shares mechanism makes the donation path non-profitable to begin with.

The supply side is bounded by a hard `$100M` supply cap on `apxUSD` and rate-limited mints through `MinterV0`, which is granted the `MINT_STRAT` role on the `AccessManager` and operates with a 60-second AccessManager scheduling delay. `MAX_FEE = 1%` is hard-coded on `YieldDistributor` to bound the operator's upside.

Access control is implemented via OZ `AccessManager`. Roles include `ADMIN` (Role 0), held by both a 3/6 Safe (`0xf986…3ce2`) and a 4/6 Safe (`0xabdd…5e96`) that share an identical 6-signer set, plus contract-bound roles for `MINT_STRAT` (Role 1, granted to `MinterV0`) and Role 6 (granted to `YieldDistributor`). The deployer EOA (`0x0442…`) was cleanly revoked at block 24481052 shortly after deployment. The deployment is Ethereum-only; CCIP integration is interface-only (`IGetCCIPAdmin`) for future cross-chain pool registration. Twelve in-scope contracts are enumerated in §9; all are Sourcify full-match verified except the AccessManager and Vesting, which are deployed from immutable bytecode.

## 3. Findings

The deal-breaker gate clears, so the findings below are residual risks that shape the protocol's grade rather than gate-blocking issues. Five of them are HIGH or MEDIUM severity from §5.1 of the raw audit; the remaining ones are lower-priority items worth surfacing.

### 3.1 Vesting contract substitution allows admin-controlled share-price inflation

`apyUSD.setVesting(IVesting newVesting)` accepts any address implementing `IVesting` and replaces the contract whose `vestedAmount()` is read by `totalAssets()`. There is no output-bounds validation on the new contract's return value, no rate limit on substitutions, and no timelock — a 3/6 multisig signature is sufficient to swap the vesting contract instantly.

The blast radius is significant. A malicious or compromised vesting contract can return any `vestedAmount()` value; the vault's `totalAssets()` reflects that directly; share price (`totalAssets / totalShares`) inflates correspondingly. An attacker holding the 3/6 keys could mint shares at the pre-inflation price, replace the vesting contract to inflate share price, then redeem at the inflated price after the 30-day cooldown — though the cooldown does at least force a public delay. A more direct path is to simply redirect the inflated `totalAssets` flow toward attacker-controlled accounts.

This is the sole HIGH severity finding from §5.1 and is referenced as F-C-02 in the framework's deal-breaker analysis (Manual Price Control, flagged but not failing). Mitigation is straightforward: validate `vestedAmount()` against historical bounds at substitution time, require the new contract to be set behind a 48-hour timelock, or require a co-signature from a different signer set than the existing Safes. None of these is implemented.

### 3.2 ADMIN role has zero execution delay

The `AccessManager` ADMIN role (Role 0) is held by the 3/6 and 4/6 Safes. The role authorizes UUPS upgrades on both `apxUSD` and `apyUSD`, controls `setVesting()` and `setUnlockToken()`, and can grant or revoke any other role. The `executionDelay` for this role is configured to **zero** — operations execute immediately upon multisig approval, with no public reaction window.

At $75M+ TVL, an instant-execution upgrade path is materially below industry posture for similarly sized stablecoins. Compare Sky / MakerDAO (48h-72h timelocks on core operations), Frax (48h timelock on UUPS), or Ethena (multi-day timelock on `MintingMultisig` upgrades). The team has plainly invested in the architecture — granular roles, deployer EOA cleanly revoked, MINT_STRAT scheduled with 60s delay — so the absence of a top-level timelock reads as a deliberate operational choice rather than an oversight, but it is a weakness.

The combination of §3.1 (instant vesting substitution) and §3.2 (no timelock on the substitution path) is what makes the vesting attack feasible. A timelock on ADMIN operations would not eliminate the vesting-substitution risk on its own — the substitution would still be admin-authorizable — but it would convert it from a single-block hazard into a multi-day publicly-visible event that holders can react to.

### 3.3 Off-chain backing has no on-chain proof-of-reserve

`apxUSD` is the protocol's primary stablecoin. Its backing is MSTR preferred-stock dividends held by Preference Capital (BVI). There is no on-chain mechanism to verify:

- That the off-chain stock holdings exist at the claimed quantity.
- That dividends are received and bridged to on-chain yield in full.
- That the team has not pledged, lent, or rehypothecated the underlying stock.
- That a claim against the off-chain assets exists for `apxUSD` holders if the operating entity becomes insolvent.

There is no on-chain redemption path against the underlying preferred stock. `apxUSD` redemption is only available via the on-chain vault flow (which redeems for `apxUSD`, not for the underlying RWA) or via secondary markets (Curve `apxUSD`-USDC pool — single venue, no DeFiLlama listing, volume data not public).

The economic-design score (25/100) and collateralization score (20/100) reflect this. The DFDV strategic round and NASDAQ listing of the parent provide off-chain credibility signals — public-company disclosures, audited financials, regulatory oversight — but they are not on-chain guarantees and not enforceable from the protocol's perspective. Proof-of-reserve via Chainlink PoR or a custodian attestation oracle would meaningfully shift this picture; neither is implemented.

### 3.4 Both Safes share the same 6-signer set

The 3/6 admin Safe (`0xf986…3ce2`) and the 4/6 secondary Safe (`0xabdd…5e96`) share an identical 6-signer set. Two thresholds, but only one underlying signer pool.

This limits defense-in-depth. Compromise of three signers is sufficient to act under the 3/6 Safe's authority; compromise of four enables the 4/6's. There is no separation between an "operations" multisig and a "guardian" multisig with disjoint membership — a posture some peers (Lido, Compound, Aave) use to ensure that an operational compromise does not cascade into governance compromise.

The fix is structural: appoint at least two signers to the 4/6 Safe who are not on the 3/6 Safe, and explicitly route guardian-type powers (e.g., emergency pause, upgrade veto) through that Safe. This is a protocol-level decision, not a code change.

### 3.5 `apyUSD._withdraw()` breaks strict CEI

`apyUSD._withdraw()` calls `vesting.pullVestedYield()` *before* burning shares. The pre-burn external call introduces a theoretical re-entry surface: a malicious vesting contract could call back into `apyUSD` while the user's share balance is still present, then burn fewer shares than expected.

The risk is bounded by the trust assumption on the vesting contract — only the ADMIN multisig can substitute it (§3.1) — and by the absence of a `nonReentrant` guard, which would close even the theoretical window. The mitigation cost is minimal: add `nonReentrant` to `_withdraw()`, or move `pullVestedYield()` to after the burn. Either is a one-line fix.

This is a LOW severity finding (P2 in §5.1). It would be more concerning if `setVesting()` were less tightly held, but with the substitution requiring 3/6 multisig approval, the practical risk is small. We surface it for completeness.

### 3.6 AddressList is a system-wide single point of failure

`AddressList` is the protocol's deny-list / blocklist contract. Its `isBlocked()` function is consulted by every token transfer in `apxUSD` and `apyUSD`. If `AddressList` is bricked — through a buggy upgrade, a state corruption, or a denial-of-service — every token transfer reverts.

There is no automated failover. Recovery requires an admin call to swap the deny-list contract, which is gated by the same 3/6 Safe and again subject to the no-timelock concern from §3.2. In an emergency, the response time is bounded only by the speed of the multisig signers.

This is a LOW severity but architecturally noteworthy item (P2 in §5.1). A backup deny-list, a circuit breaker that bypasses the deny-list in degraded states, or a graceful-degradation path (e.g., revert-to-allow if the deny-list is unresponsive) would improve operational resilience.

## 4. Deal Breaker Analysis

The framework's deal-breaker gate is a fixed checklist of conditions that, if any FAIL, halts the assessment with a `Fail` outcome. For APYX, all sixteen items in protocol-applicable categories PASS. Seven items are N/A (governance and cross-chain items inapplicable to a single-chain managed-vault design). Zero items FAIL.

### 4.1 Access Control & Governance

| Item | Status | Notes |
| --- | --- | --- |
| EOA Upgrade Control | PASS | UUPS `_authorizeUpgrade` routes through `AccessManager` → 3/6 + 4/6 Safe. Deployer EOA cleanly revoked at block 24481052. |
| EOA Fund Control | PASS | No single-EOA fund withdrawal. `YieldDistributor.withdraw()` restricted to multisig. |
| >60% Governance Centralization | N/A | No governance token; control exclusively via multisig. |
| Governance Mechanism Bypass | N/A | No governance voting mechanism. |
| Timelock Backdoors | N/A | No timelock deployed. No `emergencyExecute()` / `fastTrack()` found. |
| No Emergency Controls | PASS | `pause()` / `unpause()` on `apxUSD`, `apyUSD`, `MinterV0`, `CommitToken`. |

### 4.2 Oracle & Price Integrity

| Item | Status | Notes |
| --- | --- | --- |
| Direct Pool Price Oracle | N/A | Managed single-asset vault; no external oracle consumed for share pricing. |
| Manual Price Control | PASS | No direct `setPrice`. Vesting substitution via `setVesting()` requires 3/6 multisig — flagged as the HIGH finding F-C-02 (see §3.1). |

### 4.3 Smart Contract Architecture

| Item | Status | Notes |
| --- | --- | --- |
| Known Compiler Bugs | PASS | Solidity `0.8.30` consistent across all contracts. |
| No Reentrancy Protection | PASS | CEI on critical paths (`CommitToken._withdraw` deletes state before call). `ReentrancyGuardTransient` on `YieldDistributor`. |
| Unlimited Minting | PASS | Supply cap ($100M) + `MinterV0` rate limiting + 60s `AccessManager` delay + multisig. |
| Unsafe Delegatecall | PASS | No `delegatecall` to user-supplied addresses. |
| Uninitialized Implementation | PASS | `_disableInitializers()` in both `ApxUSD` and `ApyUSD` constructors. |
| Unprotected Initializer | PASS | All `initialize()` use the `initializer` modifier with zero-address guards. |

### 4.4 Audit & Verification

| Item | Status | Notes |
| --- | --- | --- |
| No Audit + High TVL | PASS | TVL ~$75.3M `apxUSD` supply. Three audits (Zellic, Quantstamp, Certora). |
| Unverified Contracts | PASS | 7 of 7 core contracts Sourcify-verified with full metadata match. |
| Critical Unfixed Issues | PASS | Zellic critical addressed. Certora high confirmed fixed. |

### 4.5 Economic & Liquidity

| Item | Status | Notes |
| --- | --- | --- |
| Zero Flash Loan Protection | PASS | 30-day `UnlockToken` cooldown blocks same-block extraction by construction. |
| Broken Tokenomics | PASS | Yield from off-chain MSTR preferred-stock dividends (real revenue), not circular emissions. APY < 100%. |
| No Slippage Protection | PASS | `depositForMinShares()`, `mintForMaxAssets()`, `withdrawForMaxShares()`, `redeemForMinAssets()` all present. |

### 4.6 Cross-Chain & Bridges

| Item | Status | Notes |
| --- | --- | --- |
| Centralized Bridge | N/A | Single-chain deployment (Ethereum mainnet). |
| No Transfer Limits | N/A | Not a bridge protocol. |
| No Token Verification | N/A | Not a bridge protocol. |

## 5. Trust & Permissions

| Surface | Controller | Type | M/N | Delay | Worst case |
| --- | --- | --- | --- | --- | --- |
| `apxUSD` — UUPS upgrade | `0xf986…3ce2` | Multisig | 3/6 | 0 | Replace `apxUSD` implementation; arbitrary mint or freeze |
| `apyUSD` — UUPS upgrade | `0xf986…3ce2` | Multisig | 3/6 | 0 | Replace vault implementation; full drainage of deposited `apxUSD` |
| `apyUSD` — `setVesting()` | `0xf986…3ce2` | Multisig | 3/6 | 0 | Replace vesting contract → inflate `totalAssets` and share price (HIGH, see §3.1) |
| `apyUSD` — `setUnlockToken()` | `0xf986…3ce2` | Multisig | 3/6 | 0 | Replace withdrawal mechanism — alter or bypass 30-day cooldown |
| AccessManager — co-admin | `0xabdd…5e96` | Multisig | 4/6 | 0 | Same authority as 3/6 admin; signer set is identical |
| `MinterV0` — apxUSD mint | `0x2c36…a76e` | Contract | — | 0 | Schedule `apxUSD` mint up to supply cap; 60s `AccessManager` delay |
| `YieldDistributor` — `withdraw()` | `0xf986…3ce2` | Multisig | 3/6 | 0 | Withdraw accumulated yield (bounded by `MAX_FEE = 1%`) |

Trust authority concentrates in the `0xf986…3ce2` 3/6 Safe, which holds upgrade authority on both core contracts as well as the two share-price-impacting setters (`setVesting`, `setUnlockToken`). The `0xabdd…5e96` 4/6 Safe nominally adds defense-in-depth but shares the underlying signer set, reducing the practical hardening.

The dominant trust risk is the absence of a timelock on any ADMIN operation. At $75M+ TVL, immediate-execution upgrades and configuration changes are below industry posture for stablecoins of this size. A 48-hour timelock on UUPS upgrades, `setVesting`, and `setUnlockToken` would close the dominant single-block hazards without affecting routine operations. An additional protective step would be to make the 4/6 Safe a true guardian — staffed by signers disjoint from the operational 3/6 — so the two Safes provide separation of concerns rather than threshold redundancy over the same pool.

## 6. Architecture Notes

### 6.1 Upgrade pattern

UUPS via OZ 5.5.0 `UUPSUpgradeable`. `_authorizeUpgrade` defers to `AccessManager` ADMIN, which is held by the 3/6 and 4/6 Safes. `_disableInitializers()` is called in both `ApxUSD` (line 78) and `ApyUSD` (line 90) constructors, blocking direct initialization of the implementation. ERC-7201 storage layout is used informally. No upgrade-compatibility tests are accessible from explorer-only sources, so storage-layout consistency across versions is not verifiable from outside.

### 6.2 Oracle integration

There is no external oracle consumed for share pricing. `apyUSD.totalAssets()` is computed from internal state — primarily `apxUSD.balanceOf(apyUSD)` adjusted for unlocked vesting. The `Vesting` contract is admin-set (see §3.1) and read-side only — `vestedAmount()` is a pure-style read that the vault depends on. The donation attack is structurally possible (`totalAssets()` reads `balanceOf`) but is non-profitable due to the OZ ERC-4626 virtual-shares mechanism; see §6.4.

### 6.3 Reentrancy and locking

CEI is followed on the most critical paths. `CommitToken._withdraw()` deletes state before making the external transfer call, the canonical pattern. `YieldDistributor` uses `ReentrancyGuardTransient`. The exception is `apyUSD._withdraw()`, which calls `pullVestedYield()` before burning shares — a theoretical re-entry window discussed in §3.5. No `nonReentrant` guard on the vault withdrawal path.

### 6.4 Reward and vesting mechanics

Rewards enter through the `Vesting` contract and unlock linearly. The vault reads `vestedAmount()` to update `totalAssets()`. Per-cycle share-price impact is capped at `maxRewardsBps = 2.5%`. Mint and redeem rounding is consistently vault-favoring (Ceil for fees). Share price is monotonic in normal operation; the only path to non-monotonicity is a vesting-contract substitution (§3.1). The 30-day `UnlockToken` cooldown sits on top of all share-price logic and provides the structural anti-extraction guarantee — donation, vesting-substitution, and any other share-price manipulation are visible for 30 days before they can be cashed out, and the OZ virtual-shares mechanism makes the donation path non-profitable to begin with.

### 6.5 Aggravating factors beyond the deal breakers

A handful of architectural choices add residual risk that the deal-breaker checklist does not capture:

- **`AddressList` as a system-wide SPOF.** A bricked deny list freezes all token transfers (§3.6). No automated failover.
- **Both Safes share a 6-signer set.** Threshold redundancy without signer separation (§3.4).
- **No bug bounty.** Immunefi page returns 404; no `security.txt`; no public security email. Researchers have no documented disclosure channel.
- **Single liquidity venue.** `apxUSD-USDC` Curve pool is the only on-chain trading venue. No DeFiLlama listing; secondary-market depth is not transparently observable.
- **`feeWallet` revert path.** A reverting `feeWallet` blocks all `YieldDistributor` withdrawals — an operational-resilience consideration if the wallet ever becomes a contract that reverts under specific conditions.

## 7. Open Issues

The framework's open-issue list is reproduced below in narrative form. Priorities (P0/P1/P2) are addressed to the protocol team's roadmap, not to readers. There are no P0 items.

### 7.1 P1 — within 1 month

1. **Unbounded vesting contract substitution.** *High, Oracle/DVI.* `setVesting()` accepts any `IVesting` with no output-bounds validation on `vestedAmount()` — admin-controlled share-price inflation path with no timelock. Recommendation: add output-bounds validation or a timelock on the setter.
2. **No timelock on ADMIN role.** *Medium, Access Control.* Upgrades execute immediately at $75M+ TVL with no public reaction window. Recommendation: implement a 48h+ timelock on upgrade authorization.

### 7.2 P2 — within 1 month

3. **Off-chain backing unverifiable on-chain.** *Medium, Economic.* The entire protocol value rests on team trust around the off-chain MSTR preferred-stock collateral. Recommendation: implement a proof-of-reserve oracle or custodian attestation.
4. **No on-chain redemption for `apxUSD`.** *Medium, Economic.* No on-chain path to redeem against off-chain collateral. Recommendation: establish and publish an off-chain redemption policy.
5. **Missing `nonReentrant` on `apyUSD._withdraw()`.** *Low, Smart Contract.* Pre-burn vesting call creates a theoretical re-entry window (requires admin compromise). Recommendation: add `nonReentrant` or move `pullVestedYield()` post-burn.
6. **No bug bounty or public security contact.** *Low, Operations.* No incentive for responsible disclosure. Recommendation: launch an Immunefi program with $500K+ max payout.
7. **AddressList as system-wide SPOF.** *Low, Composability.* A bricked deny list freezes all token transfers. Recommendation: consider an automated failsafe or backup list.

### 7.3 Optional

8. **`_decimalsOffset() = 0` — minimal virtual offset.** *Low, Oracle/DVI.* The OZ built-in `+1` virtual shares mechanism makes the inflation attack non-profitable already; a larger offset would add defense-in-depth. Recommendation: consider `_decimalsOffset()=6` for extra margin.

## 8. Audit History

| Date | Firm | Tier | Scope |
| --- | --- | --- | --- |
| 01/2026 | Zellic | 1 | Full protocol — `ApxUSD`, `ApyUSD`, `CommitToken`, `UnlockToken`, `MinterV0`, `YieldDistributor`, `LinearVestV0`, `AddressList` (1 critical / 0 high / 2 medium / 2 low + 3 info) |
| 02/2026 | Quantstamp | 1 | APX USD Stablecoin |
| 03/2026 | Certora | 1 | APYX APX USD (apxUSD + apyUSD) — manual code review (0 critical / 1 high; high confirmed fixed) |

Three top-tier engagements in three consecutive months covering both the stablecoin and the vault is unusually thorough for a protocol this young. Engagement diversity matters for stablecoin systems: Zellic did a full-protocol scope including the lower-traffic helper contracts (`UnlockToken`, `LinearVestV0`, `AddressList`) where bugs often hide; Certora's review here was manual code review rather than formal verification, which is a less rigorous engagement than their typical FV work but still adds an independent set of eyes. No re-audit cycle is yet established; the framework's "Quarterly re-audits" green flag is not yet earned. No public bug bounty exists.

## 9. Contract Inventory

| Name | Address | Type | Compiler |
| --- | --- | --- | --- |
| apxUSD (Proxy) | `0x98A878b1Cd98131B271883B390f68D2c90674665` | UUPS Proxy | 0.8.30 |
| apxUSD (Impl) | `0xdd71fd677fde2ed2579a3c45204f41a11016ccb4` | Implementation | 0.8.30 |
| apyUSD (Proxy) | `0x38EEb52F0771140d10c4E9A9a72349A329Fe8a6A` | UUPS Proxy | 0.8.30 |
| apyUSD (Impl) | `0x208507bE7B01bEcFA4d93eE8a7d1F202eC66cACf` | Implementation | 0.8.30 |
| UnlockToken | `0x93775E2dFa4e716c361A1f53F212c7AE031BF4e6` | Immutable | 0.8.30 |
| CommitToken: apxUSD | `0x17122d869d981d184118B301313BCD157c79871e` | Immutable | 0.8.30 |
| CommitToken: apxUSD-USDC | `0xdfC3cF7E540628a52862907DC1AB935Cd5859375` | Immutable | 0.8.30 |
| CommitToken: apyUSD-apxUSD | `0x55095f69C30E58290eCaA80F44019557d2bC4A60` | Immutable | 0.8.30 |
| MinterV0 | `0x2c36e1adfaa80ee0324b04cc814f5207bb7ba76e` | Immutable | 0.8.30 |
| YieldDistributor | `0xdbca79adc13a0fa6f921d5cf5b3fae2b8a739c2a` | Immutable | 0.8.30 |
| AccessManager | `0xe167330E2Eac88666de253e9607C6d9ae0cA2824` | OZ AccessManager | — |
| Vesting | `0x0D62B4cC02b4B51Ed19DDF41D7a7979CF394C99f` | Immutable | — |

All Sourcify full-match verified; deployer EOA (`0x0442…`) revoked at block 24481052. The `apxUSD-USDC` Curve pool (`0xE1B96555…A414`) is an external trading venue, not part of the in-scope contract set.

## 10. References

- Website — [https://apyx.fi](https://apyx.fi)
- Documentation — [https://docs.apyx.fi](https://docs.apyx.fi)
- GitHub — [https://github.com/apyx-labs](https://github.com/apyx-labs)
- Audit reports — Zellic (Jan 2026), Quantstamp (Feb 2026), Certora (Mar 2026); see §8 for direct links
- Protocol dashboard — [/protocols/apyx](/protocols/apyx)

---

*Long-form companion to the dashboard. Descriptive technical analysis only — not financial advice.*
