---
title: "Inflating a meta-vault's NAV with a share donation: the Summer.fi FleetCommander drain"
date: 2026-07-06
tags: ["vault", "erc-4626", "nav-manipulation", "flashloan", "post-mortem"]
description: "An attacker drained ≈$6.0M from Summer.fi's Lazy Summer FleetCommander (LVUSDC) USDC vault in a single flash-loan-funded transaction. The lever: donate illiquid, pre-positioned SiloVault shares into an ark so the FleetCommander books them at full NAV, then round-trip deposit → donate → redeem in one call. A walkthrough of the nested-ERC-4626 accounting flaw and the prepared share funding leg traced back to FixedFloat."
kind: incident
incident:
  loss: "≈$6.0M (6,016,755 DAI); +$6.95M pre-positioned SiloVault share lever"
  scope: "cross-protocol"
  status: "post-mortem"
  occurredOn: 2026-07-06
---

# Inflating a meta-vault's NAV with a share donation: the Summer.fi FleetCommander drain

Summer.fi's *Lazy Summer* `FleetCommander` is an ERC-4626 meta-vault: user USDC sits in a buffer and is allocated by keepers into a set of **arks** (adapters), each wrapping an external yield source. The meta-vault's share price is the sum of every ark's `totalAssets()`. On 2026-07-06 an attacker drained ≈**$6.0M** of liquid value out of the USDC vault ([`LazyVault_LowerRisk_USDC`, LVUSDC](https://etherscan.io/address/0x98C49e13bf99D7CAd8069faa2A370933EC9EcF17)) in a **single** flash-loan-funded transaction, using pre-positioned SiloVault shares as the NAV lever.

The exploit composes two individually-mundane defects. The **root cause** is on-chain: each ark values its position as `underlyingVault.convertToAssets(underlyingVault.balanceOf(ark))`, so it counts *any* underlying shares transferred directly into the ark — an unsolicited donation — at full mark-to-NAV value, with no reconciliation against principal the FleetCommander actually deployed, and even when the underlying vault is fully **illiquid**. Because deposit and redeem are both callable in the same transaction, an attacker can mint shares at the un-inflated price, donate shares to spike NAV, and redeem at the inflated price. The **funding leg** is pre-positioned: the shares used as the lever came from attacker-prepared SiloVault share-holder addresses, with the initial funding traced back to FixedFloat. Those shares were illiquid (`maxWithdraw = 0`) and could not be redeemed directly — the FleetCommander NAV-donation flaw was the machine used to convert them into liquid USDC.

## At a glance

| | |
|---|---|
| Protocol | Summer.fi — Lazy Summer (`FleetCommander` ERC-4626 meta-vault) |
| Victim vault | [`LazyVault_LowerRisk_USDC`](https://etherscan.io/address/0x98C49e13bf99D7CAd8069faa2A370933EC9EcF17) (LVUSDC), asset USDC |
| Chain | Ethereum mainnet |
| Incident time | 2026-07-06 05:17:59 UTC (block 25,471,348); pre-positioning at block 25,471,345 |
| Attacker | EOA [`0x7BF7…BDCa`](https://etherscan.io/address/0x7BF716167B48CF527725722C6d79494b45B3BDCa) · contract [`0x0514…FC61`](https://etherscan.io/address/0x0514F827C129C16418a0933E03C99A6AF982FC61) |
| Net liquid extraction | **6,016,755 DAI (~$6.0M)** cashed out via Curve 3pool |
| Class | Nested-ERC-4626 NAV inflation via unaccounted share donation + pre-positioned share funding leg |
| Severity | Critical — victim vault liquidity drained to ~$0.30; remaining LPs cannot exit |

## The vault stack

User USDC in the `FleetCommander` sits in a `BufferArk` (idle, fully liquid) and is allocated into arks, each wrapping an external yield source:

- `ERC4626Ark` — wraps a generic ERC-4626 (e.g. sUSDS).
- `MorphoVaultArk` / `MorphoV2VaultArk` — wraps a Morpho MetaMorpho / Vault V2.
- `SiloManagedVaultArk` — wraps a Silo `SiloVault`.

`FleetCommander.totalAssets()` — and therefore its share price — is the sum of every ark's `totalAssets()`, computed through a per-operation cache that snapshots each ark at the start of a deposit/redeem. Redemptions are served first from the buffer and then by force-disembarking from arks, but are capped at `maxRedeem = convertToShares(withdrawableTotalAssets())` — i.e. by *liquid* value, not booked value. That cap is the only thing standing between "inflated NAV" and "walk away with cash," and §*The liquidity gate* below is how the attacker defeats it.

## Root cause — an ark counts donated, illiquid shares

Every ark values itself by the shares it **physically holds** in the underlying vault:

```solidity
// SiloManagedVaultArk (identical shape in MorphoVaultArk / MorphoV2VaultArk / ERC4626Ark)
function totalAssets() public view override returns (uint256 assets) {
    uint256 shares = vault.balanceOf(address(this));   // <-- ANY shares at this address, incl. donated
    if (shares > 0) assets = vault.convertToAssets(shares); // <-- valued as if redeemable
}
```

Two independent defects live in these two lines:

- **Donation-countable NAV.** There is no reconciliation between "shares the FleetCommander deposited/tracks" and "shares sitting at the ark address." A bare `ERC20.transfer` of underlying shares into an ark instantly raises that ark's `totalAssets()`, and therefore `FleetCommander.totalAssets()` and its share price — with **no matching principal**.
- **Liquidity-blind valuation.** `convertToAssets` reports the mark-to-NAV value even when the underlying vault cannot honour a withdrawal (`maxWithdraw = 0`). The donated value is booked in full while being non-redeemable.

### Same-transaction deposit → donate → redeem

`FleetCommander.deposit` and `redeem` are both callable in one transaction and each takes a fresh NAV snapshot. This lets an attacker mint shares at the pre-donation price and burn them at the post-donation price within the same call frame — no cross-block holding, no exposure to other actors.

### The liquidity gate — why a "storm" is needed

Donating into an *illiquid* ark inflates share **value** but not `withdrawableTotalAssets`, and `maxRedeem` is bounded by the latter. To convert the inflated value into cash, the attacker must first raise withdrawable liquidity. Morpho `VaultV2.forceDeallocate()` is **permissionless** — anyone can call it to pull a Vault V2's Morpho-market positions back into its idle balance, which makes the corresponding FleetCommander ark withdrawable.

FleetCommander_98c4 holds **three** Morpho VaultV2s via `MorphoV2VaultArk`s, all illiquid at rest:

| VaultV2 | ark (commander = FC_98c4) | `forceDeallocatePenalty` | liquidity freed |
|---|---|---|---|
| `0x4Ef5…` "KPK USDC Prime" | `0xd0aadde1…` | **0** | ~$3.03M |
| `0xe222…` | `0x81f025c8…` | 0.01% | ~$0.97M |
| `0xebba…` | `0x857a0cac…` | 0.5% | ~$0.03M |

The "forceDeallocate storm" hit all three (plus `0x56bf…`, an ark of a sibling FleetCommander FC_e9cd), freeing ≈**$4.03M** of ark liquidity for FC_98c4. Combined with the buffer (~$1.6M) this is what lets the inflated redemption clear. Where the penalty is non-zero, the attacker holds a few dollars of that vault's shares — obtained via small deposits earlier in the tx — to pay it.

## Attack walkthrough

The whole thing is two transactions three blocks apart: a share consolidation pre-position, then an atomic flash-loan drain. Inside the drain, the share-price pivot is the crux:

| Step (within the drain tx) | FC share price | Attacker action |
|---|---|---|
| ② deposit 64.8M USDC | **1.0665** | mint 60.79M shares — buy ~87% of the vault cheap |
| ③ donate 19.552e15 shares → ark | 1.0665 → **1.1678** | ark `totalAssets` 0 → ~$7.12M; NAV +$7.12M, **no new principal** |
| ④ redeem 60.77M shares | **1.1678** | pull 70.96M USDC — sell dear |

Profit ≈ ownership × NAV_bump ≈ 87% × $7.12M ≈ $6.1M, capped by liquid funds (buffer $1.6M + `forceDeallocate`-freed $4.03M).

### TX1 — pre-positioned share consolidation

Block 25,471,345, tx [`0x92d2e2e5…`](https://etherscan.io/tx/0x92d2e2e52d86e580b9dd40af737ed7671665753d96fed5143b4589eaf019dede). The attacker moved **19.075e15 "Varlamore USDC Growth" shares (≈$6.95M)** from **5 prepared share-holder addresses** into the attacker contract:

| Prepared holder EOA | Shares moved |
|---|---|
| `0xd39d1733…` | 11.20e15 |
| `0xe5bff5a3…` | 4.41e15 |
| `0x11946f3b…` | 1.76e15 |
| `0x14ec7a28…` | 1.27e15 |
| `0x341a58a1…` | 0.43e15 |

The holder addresses were prepared ahead of the drain, and the initial funding path traces back to FixedFloat. An incidental `_accrueFee` mint fires here because Silo's share movement accrues fees first; those fee shares go to the SiloVault's curator Safe, **not** the attacker (see the note below).

### TX2 — the drain

Block 25,471,348, tx [`0x0db528c4…`](https://etherscan.io/tx/0x0db528c44f23fc7fa4544684a2fab81096450a14aae8bc89f42cd0592d43da12) (15M gas), atomic:

1. **Flash loans + share buy.** Morpho Blue `flashLoan(USDC, 65,419,171)` + `flashLoan(USDT, 1,000,000)`; **buy ~0.476e15 more SiloVault shares on Balancer V3** (added to the 19.075e15 pre-positioned in TX1 → 19.552e15 total lever).
2. **Liquidity storm.** `forceDeallocate` across all three of FC_98c4's Morpho-Vault-V2 arks — `0x4Ef5` KPK (penalty 0), `0xe222` (penalty 0.01%), `0xebba` (penalty 0.5%) — pulling Morpho-market liquidity into idle, raising `withdrawableTotalAssets` by ≈$4.03M. (`0x56bf`, an FC_e9cd ark, was force-deallocated too.)
3. **Deposit (low NAV).** `FC.deposit(64,828,535 USDC)` → **60,787,157 LVUSDC @ price 1.0665** (SiloArk `totalAssets` still 0). The flash-loaned size buys ≈**87%** of the vault.
4. **Inject (spike NAV).** `SILO.transfer(<SiloManagedVaultArk>, 19.552e15)` → the ark's `totalAssets()` jumps **0 → ~$7.12M**, inflating the FleetCommander share price.
5. **Redeem (high NAV).** `FC.redeem(60,766,209 shares)` → **70,959,584 USDC @ price 1.1678**, drawn from the buffer + the freshly-freed ark liquidity.
6. **Repay & cash out.** Repay both flash loans; swap the ~5.7M USDC surplus to DAI on Curve 3pool.

**Result:** attacker EOA balance `0 → 6,016,755 DAI`; FleetCommander `withdrawableTotalAssets` `1,605,240 → 12`.

### A note on the incidental fee mint

The SiloVault fee recipient (`0xd8454B37…`) is the vault's `feeRecipient()` = `owner()` — the "Varlamore" curator's Gnosis Safe, **not** the attacker. Silo's `transfer`/`transferFrom` run `_accrueFee()` before moving shares, minting a 7.5% performance fee (on interest since the last update) to the recipient. The attacker's share movement incidentally triggered this; it enriched the curator and, by raising `totalSupply` at constant `totalAssets`, marginally *reduced* the attacker's lever. Orthogonal to the drain.

## Impact & loss attribution

- **Share lever:** ~19.075e15 "Varlamore USDC Growth" shares were consolidated from 5 attacker-prepared holder addresses; initial funding traces back to FixedFloat.
- **Liquid funds extracted:** the ~$6M the attacker walked away with was paid out of the FleetCommander's liquid sources reached through the arks — Morpho Blue markets (−4.60M USDC) and an Aave/Silo lending proxy `0x377c3bd9…` (−1.29M USDC).
- **FleetCommander LVUSDC:** left holding the illiquid, donated SiloVault shares in place of its liquidity; `withdrawableTotalAssets` remains ≈$0 — remaining LPs cannot exit.

## What would have blocked it

Root-cause fixes on the FleetCommander / Ark side:

1. **Account principal, not `balanceOf`.** Track shares the FleetCommander itself deployed into each ark (internal accounting) instead of reading `underlyingVault.balanceOf(ark)`. Ignore or skim unsolicited share transfers so a donation cannot move NAV.
2. **Liquidity-aware valuation.** Cap an ark's contribution to *withdrawable* NAV by the underlying's `maxWithdraw`/`maxRedeem`; do not book illiquid positions at full `convertToAssets`.
3. **Block same-block deposit → redeem** (or enforce a minimum holding period / commit-reveal) to kill atomic NAV round-trips.
4. **Virtual shares / offset** and a minimum-liquidity invariant on redemption pricing.
5. **Gate or price `forceDeallocate`** meaningfully — a permissionless, zero-penalty deallocation that lets any actor reshape a vault's liquidity is a reusable exploit primitive.

Any one of the first three closes the round-trip; the accounting fix (1) is the true root-cause remedy. The immediate operational response is to pause deposits/withdrawals on affected FleetCommanders and treat all ark `totalAssets` as untrusted; investigators should preserve the pre-positioning trail from FixedFloat into the prepared SiloVault share-holder addresses.

## Severity

| | |
|---|---|
| Impact | Critical — full drain of the affected vault's liquid value |
| Reproducibility | High — the round-trip is deterministic and atomic |
| Cost to exploit | Low — flash loans plus pre-positioned SiloVault share lever |
| Fix complexity | Medium — internal principal accounting + liquidity caps on ark valuation |

## The bigger pattern

This is a **nested-ERC-4626 NAV-inflation** bug: a meta-vault trusting a naive `underlying.convertToAssets(underlying.balanceOf(self))` for its own share price. It is exploitable whenever (a) shares can be transferred into the accounting address, (b) valuation ignores redeemability, and (c) deposit and redeem are atomically composable. The flash loan supplies the majority stake so a fixed NAV bump maps to maximal extraction; the pre-positioned shares make the NAV lever available; the permissionless `forceDeallocate` supplies exit liquidity. Each ingredient is individually mundane — the composition is the exploit.

The takeaway for anyone integrating a vault-of-vaults: assume `convertToAssets(balanceOf(self))` is donation-inflatable and illiquidity-blind. Prefer internal principal accounting plus liquidity caps. For any Summer.fi-style meta-vault, the questions worth answering up front are how each adapter/ark computes `totalAssets`, whether it can be inflated by a bare token transfer, whether it discounts illiquid underlyings, and whether deposit and redeem are same-block composable. A "yes / no / yes" is a Critical finding.

## References

- Pre-position tx (share consolidation): [`0x92d2e2e5…dede`](https://etherscan.io/tx/0x92d2e2e52d86e580b9dd40af737ed7671665753d96fed5143b4589eaf019dede) (block 25,471,345)
- Drain tx: [`0x0db528c4…da12`](https://etherscan.io/tx/0x0db528c44f23fc7fa4544684a2fab81096450a14aae8bc89f42cd0592d43da12) (block 25,471,348)
- Victim vault (FleetCommander LVUSDC): [`0x98C4…EcF17`](https://etherscan.io/address/0x98C49e13bf99D7CAd8069faa2A370933EC9EcF17)
- Attacker EOA: [`0x7BF7…BDCa`](https://etherscan.io/address/0x7BF716167B48CF527725722C6d79494b45B3BDCa) · attacker contract: [`0x0514…FC61`](https://etherscan.io/address/0x0514F827C129C16418a0933E03C99A6AF982FC61)
- Cash-out: 6,016,755 DAI to the attacker EOA (via Curve 3pool USDC→DAI)

*This note is a post-incident analysis of an already-executed on-chain exploit.*
