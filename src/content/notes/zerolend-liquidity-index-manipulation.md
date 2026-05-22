---
title: "Inflating liquidityIndex with flashloan premiums: a ZeroLend post-mortem"
date: 2025-12-26
updated: 2026-05-08
tags: ["lending", "flashloan", "post-mortem"]
description: "A low-liquidity ZeroLend market backed by a post-maturity Pendle PT (PT Lombard LBTC 29MAY2025) was drained of ~4 LBTC. The attacker pumped liquidityIndex via flashloan premiums, accumulated ~10.9955 PT-LBTC via rounding-window arbitrage, then borrowed real LBTC against the drained collateral. A walkthrough of the on-chain facts and the accounting bugs that made it work."
kind: incident
incident:
  loss: "≈4 LBTC (~4 BTC)"
  scope: "single-market"
  status: "post-mortem"
  occurredOn: 2025-12-25
---

# Inflating liquidityIndex with flashloan premiums: a ZeroLend post-mortem

A ZeroLend market on Base — backed by **PT Lombard LBTC 29MAY2025** (a Pendle Principal Token, **post-maturity** at the time of attack and therefore 1:1 redeemable for LBTC ≈ BTC) and seeded with only 32,680 base units of that PT — was drained for ≈4 LBTC. The attack runs as one setup phase followed by a **3-iteration loop**:

**Setup — Flashloan inflation of the PT-LBTC market's `liquidityIndex`.** The attacker repeatedly flashloaned PT-LBTC tokens that were *not counted* in the pool's scaled bookkeeping. Each flashloan's premium was credited as LP income and pushed into `liquidityIndex`, which compounded multiplicatively because the denominator (`totalLiquidity`) was tiny. By the end of the loop, the PT-LBTC market's `liquidityIndex` had been pumped from `1e27` to ≈ `2015e27` — and beyond. This widens both the rounding window for the arb (loop step 1) and the gap between scaled bookkeeping and real ERC-20 balance.

**Loop iteration (× 3) — Many arbs → re-supply → one borrow.** Each iteration of the loop has three internal steps:

1. **Multiple rounding-window arb transactions.** `rayDiv(amount, index)` collapses a wide range of `amount` values to the same scaled integer. The attacker runs many `supply(small) → withdraw(large)` round-trip transactions; each tx round-trips scaledBalance to zero but pulls net PT-LBTC out of the AToken across its rounds. Many such transactions are needed in each iteration to accumulate enough PT-LBTC to be useful as collateral.
2. **Re-supply as collateral.** Once enough PT-LBTC has been accumulated, the attacker supplies it back into the same pool as honest collateral. The post-maturity PT is priced 1:1 against LBTC by the oracle, so the position is reported at face value — no `balanceOf` inflation in this step.
3. **One borrow transaction.** Against the supplied PT-LBTC, the attacker pulls some LBTC out of the LBTC reserve in a single borrow tx.

The loop runs **3 times**, producing **3 borrow transactions** that cumulatively pull **≈4 LBTC** out of the LBTC reserve. The cumulative collateral supplied across all 3 iterations is **≈10.9955 PT-LBTC**. The attacker never repaid. The PT-LBTC posted as "collateral" was the same dust the attacker had drained out of the protocol moments earlier — the protocol effectively accepted its own previously-stolen tokens as security against fresh borrows. The cashout (≈4 LBTC) is much smaller than the collateral pile (≈11 BTC-equivalent) because the **LBTC reserve depth, not collateral capacity, was the binding constraint** — once the reserve runs dry, more PT-LBTC posted does not buy more LBTC out.

The bug isn't in `rayDiv`, the interest-rate math, the AToken contract, or `supply` / `withdraw` themselves. It's the composition: a boundary mismatch between *what flashloans can borrow* (the AToken's real ERC-20 balance) and *what counts as liquidity* (the AToken's scaled `totalSupply`) — which lets the index inflate freely; combined with the fact that the same inflated index drives **`balanceOf`**, which the risk engine consumes as collateral. The asset choice is part of the operator-side risk: PT-LBTC is an exotic, low-liquidity wrapper, not a primary money like cbBTC or WBTC, and exotic assets are exactly the ones that get listed with dust seed liquidity in the same pool as deep liquid assets like LBTC — providing a route from "exploitable bookkeeping in a tiny market" to "real-asset extraction from a connected market."

> **A note on units.** PT-LBTC has 8 decimals (LBTC matches WBTC's 8-decimal convention), so the smallest unit is the same numerical resolution as a Bitcoin satoshi. Throughout this post we use raw integer amounts (e.g. `32,680`) — read them as 8-decimal base units of the PT.

## On-chain facts

**Market initialization** ([tx](https://basescan.org/tx/0xf7d6adc8bebacb6897277334949b2d952a7266eaae47085f9035923d0f5f94a5)) supplied 32,680 base units (≈0.000327 PT-LBTC) and left the reserve in this state:

```
liquidityIndex      = 1e27
variableBorrowIndex = 1e27
liquidityRate       = 0
variableBorrowRate  = 0
```

The pool's bookkept liquidity was negligible.

**Attacker setup.** Instead of calling `supply()`, the attacker transferred ~0.05 PT-LBTC (5,032,680 base units) *directly to the AToken contract address*. A raw ERC-20 transfer:

- does not go through `Pool.supply`
- does not update `ReserveData`
- does not change scaled `totalSupply` / `totalLiquidity`

But the assets are physically present in the AToken's balance — and that's what flashloans are settled against.

**Flashloan loop** ([tx](https://basescan.org/tx/0xa14b926bd19ce0e23b17d94802816700e1ea2353f7ceb8e493ae0ddcca4cbad6)). Each iteration:

- Borrow: 5,032,680 base units of PT-LBTC
- Repay: 5,035,196 base units
- Premium: 2,516 base units (≈0.05% fee)

`liquidityIndex` after each iteration:

```
After flashloan #1:  ≈ 1.076958384 × 1e27
After flashloan #2:  ≈ 1.153914582 × 1e27
...
```

The index moves while `liquidityRate == 0`. There is no "real" interest here.

## Why the index moves

Per `ReserveLogic.sol`, `liquidityIndex` only changes via three paths: linear interest accrual (gated on `liquidityRate != 0`), treasury accrual, and `cumulateToLiquidityIndex()`. With `liquidityRate == 0` and no normal borrowing, only the third path applies.

`cumulateToLiquidityIndex` computes:

```
newIndex = (amount / totalLiquidity + 1) × oldLiquidityIndex
```

where `amount` is treated as new income to LPs, and `totalLiquidity` is the **scaled** view of the reserve.

The flashloan flow pushes the premium through this function as protocol income. With:

```
amount         = 2,516 base units
totalLiquidity ≈ 32,680 base units
```

each iteration multiplies the index by roughly `1.077`. Repeated `n` times:

```
liquidityIndex_n = liquidityIndex_0 × ∏ (1 + premium / totalLiquidity)
```

That's geometric growth — and with the ratio fixed at ~7.7% per round because the denominator never updates, the index runs away quickly.

## The accounting boundary the attack exploited

The decisive split is:

> The pool's `totalLiquidity` is derived only from the AToken's scaled `totalSupply` — but flashloans can borrow against the AToken's actual ERC-20 balance.

`totalLiquidity` only changes on `supply()`, `withdraw()`, or interest accrual. It does **not** change when:

- someone transfers tokens directly to the AToken contract
- a flashloan borrows and repays principal

So the attacker created a state where the AToken's *real* PT-LBTC balance (~5M base units, available to flashloan) was ~150× larger than its *bookkept* `totalLiquidity` (32,680, the divisor in `cumulateToLiquidityIndex`). Premiums on the large balance were divided by the tiny denominator. The result was non-linear.

## The exploit loop — drain (many txs) → re-supply → borrow, × 3

After inflation, `liquidityIndex` was pinned at **2,015,006,668,255,152,945,905,879,352,770** — i.e. ≈ **2015 × 1e27**, the original index inflated 2015×. The attacker then ran a 3-iteration loop. Each iteration consists of *multiple* rounding-window arb transactions (each draining a small amount of PT-LBTC into the attacker's wallet), followed by *one* re-supply and *one* borrow against the accumulated collateral. Over the full 3 iterations, the attacker supplied a cumulative **≈10.9955 PT-LBTC** of collateral and produced **3 borrow transactions** totalling **≈4 LBTC** of cashout.

### Loop step 1 — Many rounding-window arb transactions to drain PT-LBTC

The first step of each iteration is the slow part: many small arb transactions. `rayDiv(amount, index)` rounding asymmetry lets each `supply → withdraw` round trip pull a small amount of PT-LBTC out of the AToken without consuming any real position; doing this in bulk accumulates a usable position over many transactions.

[Tx 0xbaf6…30f8](https://basescan.org/tx/0xbaf678512e38435f869aa811686a5f835036784576fa5bd4dc171586576130f8) is a representative example: **1,151 `supply → withdraw` round trips** back-to-back in a single tx, draining ~0.0115 PT-LBTC into the attacker's wallet. The attacker ran multiple such transactions in each loop iteration (refilling the AToken's real balance via direct transfers between txs where needed) before pausing the arb to do the re-supply and borrow.

### The rounding window

AToken accounting (Aave v3 lineage):

```solidity
// supply(amount):
//   amountScaled = amount.rayDiv(liquidityIndex)   // (a*RAY + I/2) / I, integer div
//   _mint(onBehalfOf, amountScaled)
//   underlying.safeTransferFrom(user, aToken, amount)

// withdraw(amount):
//   amountScaled = amount.rayDiv(liquidityIndex)
//   _burn(from, amountScaled)
//   underlying.safeTransfer(to, amount)
```

`rayDiv(a, I)` is integer division with half-rounding: `(a × 1e27 + I/2) / I`. With `I ≈ 2015e27` (so `I / RAY ≈ 2015`), the function maps **a wide range of `amount` values to the same integer `amountScaled`**. For `amountScaled = 1`, the window is roughly:

```
amount ∈ [I/(2·RAY), 3·I/(2·RAY)]   ≈   [1008, 3022] base units
```

Anywhere in that ~2015-wide window, `rayDiv(amount, I) = 1`. The accounting only sees "1 unit of scaled balance"; the underlying transfer uses the raw `amount`.

### What each round trip actually does

The arb tx repeats this pair:

```
supply(2016)    →  scaledAmount = rayDiv(2016, 2015e27) = 1   // mints scaled=1
withdraw(3021)  →  scaledAmount = rayDiv(3021, 2015e27) = 1   // burns scaled=1
```

Net effect per round:

| | scaled balance | PT-LBTC in/out |
|---|---|---|
| `supply(2016)` | +1 | −2,016 (user → AToken) |
| `withdraw(3021)` | −1 | +3,021 (AToken → user) |
| **net** | **0** | **+1,005** |

ScaledBalance is round-tripped to zero, but the AToken's real PT-LBTC balance shrinks by 1,005 base units per round. The attacker pockets the difference.

The first round of the tx is a one-off bootstrap: `supply(4032) → withdraw(3021)`, which mints `scaledAmount = rayDiv(4032, 2015e27) = 2` and burns 1 — leaving the attacker with `+1` scaledBalance, at a sunk cost of 1,011 base units. From that point on, every subsequent round is the steady-state `(2016, 3021)` pair.

### Tx-level totals

Aggregating across all 1,151 round trips in the single arb tx:

```
liquidityIndex (constant)  = 2,015,006,668,255,152,945,905,879,352,770
                           ≈ 2015 × 1e27     (2015× inflation)

Round 1   (bootstrap):  supply 4,032 → withdraw 3,021   (net −1,011)
Round 2..1151:          supply 2,016 → withdraw 3,021   (net +1,005, ×1,150)

Total supplied:   2,322,432 base units   (4032 + 2016·1150)
Total withdrawn:  3,477,171 base units   (3021·1151)
Net drained:      1,154,739 base units   ≈ 0.01155 PT-LBTC
```

This single tx accumulates ~0.0115 PT-LBTC. Each loop iteration includes multiple such arb transactions; across the 3 iterations of the full loop, the cumulative drained-then-re-supplied PT-LBTC totals ≈10.9955.

### Why this works at all

Three properties of `rayDiv` rounding combine:

1. **The window grows linearly with the index.** At `I = 1e27`, the window for `scaledAmount = 1` is `[0, 1]` — no asymmetry exists. At `I = 2015e27`, the window is ~2015 wide. **Inflating the index inflates the rounding window.**
2. **`supply` and `withdraw` use the same rounding rule on the same index.** Both can pick any point in the window. There is no "supply rounds up, withdraw rounds down" asymmetry baked in to *prevent* the round trip from netting positive — both round half-up.
3. **There is no minimum supply or maximum withdraw guard relative to the index width.** Aave v3 enforces `amountScaled != 0` at mint time but does not require `amountScaled` to be larger than some floor. So the attacker can stay forever in the `scaledAmount = 1` window.

The bug isn't in `rayDiv`; rounding is correct. The bug is that an inflated `liquidityIndex` widens the rounding window to a size where round-trip arbitrage is profitable, and there is no defense against that beyond keeping the index from inflating in the first place.

### Loop steps 2–3 — Supply the accumulated PT-LBTC, borrow LBTC

After enough arb transactions to build up a usable position, the iteration finishes with one supply and one borrow:

1. **Supply as collateral.** The accumulated PT-LBTC is supplied back into the same pool. PT-LBTC is post-maturity and 1:1 redeemable for LBTC; the oracle prices it accordingly at ≈1 BTC per unit. The collateral position is reported honestly — there's no `balanceOf` inflation in this step. The protocol accepts it at face value.
2. **One borrow transaction.** Against the supplied PT-LBTC, the attacker pulls LBTC out of the LBTC reserve. The borrow is within LTV; the risk engine sees a healthy collateralisation ratio.

Three iterations produce **3 borrow transactions** that cumulatively pull ≈4 LBTC out of the LBTC reserve. The reason the cashout is bounded at ≈4 LBTC is that **the LBTC reserve depth, not collateral capacity, was the binding constraint** — by the third borrow the LBTC reserve was running dry, so additional iterations would not have produced more LBTC.

The attacker never repaid. [Hacker wallet 0x218c…7719](https://debank.com/profile/0x218c572b1ab6065d74bebcb708a3f523d14f7719) holds the ≈4 LBTC across the three borrow txs. The PT-LBTC sitting as collateral has a notional value larger than the borrowed amount, but **it's the same PT-LBTC the attacker drained from the protocol via the arb step of each iteration**. The protocol effectively accepted its own previously-stolen tokens as security against fresh borrows — so liquidating the collateral does not recover the loss; it merely returns the protocol to the pre-borrow state, with the ≈4 LBTC still gone.

### Why the borrow leg is necessary at all

A reasonable question: if the attacker already drained ~11 PT-LBTC into their wallet over the loop, why bother with the borrow leg? Why not just sell the PT-LBTC for LBTC on a DEX and call it done?

Two reasons:

1. **Liquidity asymmetry.** PT-LBTC at maturity has shallow secondary-market depth. Selling ~11 PT-LBTC into a thin pool would cost meaningful slippage and likely move the price against the attacker. Borrowing LBTC against it through a lending market is a straight-through conversion at zero slippage — and the lending pool happens to have deep LBTC liquidity precisely because LBTC is a primary money.
2. **Asset preference.** LBTC is more universally accepted than PT-LBTC across DeFi. Once the LBTC is in the attacker's wallet, it's straightforward to bridge or swap further. PT-LBTC, even post-maturity, is a niche wrapper most venues don't list.

The borrow leg converts an awkward exotic-token position into a clean liquid-asset payout. This is the "single-pool composability" pattern that makes the attack damaging: the manipulated market and the clean LBTC market sit in the same pool, so collateral in one underwrites borrows in the other without needing a DEX hop. The LBTC reserve depth (~4 LBTC available) bounded the cashout — the attacker's PT-LBTC pile could have supported a larger borrow if the reserve had held more LBTC.

### Why an oracle that's "correct" still doesn't help

PT-LBTC's oracle returns a correct unit price. The price-manipulation defenses (Chainlink staleness checks, deviation thresholds, multi-source aggregation) all pass. There is no oracle bug to patch.

The vulnerability is upstream of price: it's the *quantity* the protocol believes is in circulation. The Phase-2 arb pulls real PT-LBTC out of the protocol while leaving the scaled bookkeeping unchanged — a discrepancy invisible to any price oracle. The Phase-3 borrow then uses the (correctly-priced, real) PT-LBTC as collateral. No oracle-level defense, no matter how robust, would have detected this attack chain.

This is what makes the pattern dangerous in Aave forks generally: most oracle hardening assumes the issue lives in `oracle.price`, but here the issue lives in the asymmetry between scaled bookkeeping and real ERC-20 balances.

## What is and isn't the bug

A few things people reach for that aren't the root cause:

- **Interest-rate model.** Untouched. `liquidityRate` was 0 the whole time.
- **AToken contract.** Behaved exactly as written.
- **`rayDiv` rounding by itself.** `rayDiv` rounds correctly. The arbitrage profit isn't from a rounding error; it's from rounding *windows* widening to cashout-worthy sizes once the index is inflated.

The actual bug is the composition of design choices that are individually defensible.

**Setup (inflation) exploits:**

1. Flashloans settle against real ERC-20 balance, so unsolicited transfers can be borrowed.
2. Flashloan premium is credited as LP income via `cumulateToLiquidityIndex`.
3. The denominator in that function is the scaled `totalLiquidity`, which is decoupled from real balance — so inflation is unbounded in a dust-liquidity market.

**Loop step 1 (rounding-window arb to drain PT-LBTC) exploits:**

4. The same `liquidityIndex` drives `rayDiv` rounding in both `supply` and `withdraw`. As the index inflates, the rounding window for each integer scaledAmount widens proportionally.
5. There is no minimum-scaled-amount floor relative to index width — the attacker can stay forever in the `scaledAmount = 1` window where `supply` and `withdraw` map to the same scaled integer but to different underlying amounts.

**Loop steps 2–3 (re-supply drained PT-LBTC, borrow LBTC) exploits:**

6. The PT-LBTC market sits in the same lending pool as a deep LBTC market; collateral in one reserve underwrites borrow capacity in the other. There is no isolation-mode-style restriction that would prevent collateral in an exotic asset from underwriting borrows of a primary asset.
7. The protocol accepts as collateral the very tokens it just lost — there is no global accounting check that the supplied collateral represents net-new value into the protocol versus a re-deposit of recently-extracted assets.

Any one of these in isolation is fine. Together, in a low-liquidity market for an exotic asset listed alongside deep liquid assets, they compose into a 3-iteration loop: drain-via-arb → re-supply → borrow → repeat. Each iteration produces one borrow transaction; the loop terminates when the LBTC reserve runs dry. The setup phase makes all of this possible by inflating the index that the loop steps depend on.

## Necessary conditions

For this attack to work you need *all* of:

**Setup — flashloan inflation:**
- `totalLiquidity` very small (a freshly initialized or otherwise tiny market)
- flashloans available against real balance, not scaled balance
- premium routed into `liquidityIndex` via `cumulateToLiquidityIndex`

**Loop step 1 — rounding-window arb to drain PT-LBTC:**
- `supply` and `withdraw` use the same `liquidityIndex` and the same rounding rule
- no floor enforcing `amountScaled` larger than some minimum relative to index width

**Loop steps 2–3 — re-supply drained PT-LBTC, borrow LBTC (≈4 LBTC cashout across 3 iterations):**
- the manipulated reserve sits in a pool that also lists a deep liquid asset (here LBTC)
- no isolation-mode or supply-cap restriction prevents collateral in the exotic asset from underwriting borrows in connected reserves
- no global accounting check that supplied collateral is net-new value, not a re-deposit of recently-drained tokens

The first item is the operational lever: any new market spinning up with token-dust seed liquidity is in scope. The rest are protocol invariants of the Aave v3 lineage.

The asset choice amplifies the operational lever. PT-LBTC 29MAY2025 is a Pendle Principal Token whose maturity had already passed at the time of attack; post-maturity PTs are 1:1 redeemable for the underlying but they trade thinly compared to LBTC itself. Listing a market for an exotic, low-liquidity wrapper is what makes a 32,680-base-unit seed plausible in the first place — nobody is going to pre-fund the market with meaningful TVL, so the dust state persists.

## Severity

| | |
|---|---|
| Impact | Critical (full drain of affected market) |
| Reproducibility | High (single index manipulation, repeatable arbitrage) |
| Cost to exploit | Low (gas + flashloan fees) |
| Fix complexity | High (touches the flashloan/index accounting boundary) |

## The bigger pattern

Lending markets that route flashloan premiums into a multiplicative index need a floor on the divisor — either a minimum `totalLiquidity` to enable flashloans, or a cap on the per-call index delta, or premium accrual that bypasses `cumulateToLiquidityIndex` entirely when the pool is below some liquidity threshold. The Aave v3 lineage that ZeroLend forks from has carried this shape for a long time; it only becomes exploitable when an operator deploys a market with seed liquidity small enough to make the ratio explosive.

There's a second lesson specific to this incident: **exotic wrappers compound the listing risk**. PT tokens, restaking derivatives, and other long-tail wrappers naturally have shallow liquidity. Operators listing them as collateral or borrow assets need to either (a) seed the market with non-trivial TVL before flashloans go live, (b) gate flashloans behind a `totalLiquidity` floor, or (c) accept that the market is unsafe until organic deposits arrive. ZeroLend did none of these.

The lesson for protocol operators: **a freshly initialized market with dust liquidity is not a benign state** — and listing exotic, thin-liquidity assets makes that state long-lived.

## References

- Market init: [0xf7d6adc8…f5f94a5](https://basescan.org/tx/0xf7d6adc8bebacb6897277334949b2d952a7266eaae47085f9035923d0f5f94a5)
- Flashloan attack: [0xa14b926b…cca4cbad6](https://basescan.org/tx/0xa14b926bd19ce0e23b17d94802816700e1ea2353f7ceb8e493ae0ddcca4cbad6)
- Supply/withdraw rounding-window arb: [0xbaf67851…576130f8](https://basescan.org/tx/0xbaf678512e38435f869aa811686a5f835036784576fa5bd4dc171586576130f8)
- Hacker wallet (Base): [0x218c572b…f7719](https://debank.com/profile/0x218c572b1ab6065d74bebcb708a3f523d14f7719)
