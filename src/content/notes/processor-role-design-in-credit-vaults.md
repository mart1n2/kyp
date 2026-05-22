---
title: "PROCESSOR_ROLE design in credit-vault stablecoins"
date: 2026-05-02
tags: ["stablecoin", "operator-risk", "vault-design"]
description: "Trusted off-chain operators are the rule, not the exception, in credit-vault stablecoins. The interesting question is what bounds the role on-chain. A short comparison using Saturn Credit as a starting point."
relatedProtocol: "saturn-credit"
---

# PROCESSOR_ROLE design in credit-vault stablecoins

Credit-vault stablecoins — vaults where deposits are converted to off-chain instruments and yield is reflected back on-chain — universally rely on a trusted operator role. The interesting question isn't *whether* the operator is trusted (they are) but *what bounds them on-chain*.

## The role's powers

Across the protocols I've looked at, the operator role typically has authority over three things:

1. **Asset conversion**: turning the vault asset into an off-chain instrument and back.
2. **Reward distribution**: writing yield back into the vault's accounting.
3. **Withdrawal settlement**: moving queued withdrawal requests through to fulfillment.

Each is a value-transfer surface. Bounding any of them on-chain is a defense-in-depth story.

## The bounding mechanisms

There are roughly four bounding mechanisms in common use:

- **Tolerance bands on conversions.** The on-chain code rejects a conversion that lands too far from the oracle price. Saturn uses `toleranceBps = 2000` (20%) — wide. A few other vaults are tighter (5–10%) or scale tolerance with realized oracle volatility.
- **Vesting on rewards.** New rewards enter a "locked" pool that decays linearly into share price. This caps the per-distribution share-price impact. Saturn has `maxRewardsBps = 2.5%` per cycle, which is reasonable.
- **Internal balance tracking.** The contract tracks its own balance independently of `IERC20.balanceOf`, so the off-chain leg can't quietly drain assets without a corresponding on-chain accounting update. Saturn does this; it's a useful belt-and-suspenders pattern.
- **Rate limits / per-cycle caps.** A maximum amount the processor can move per epoch or block. **This is the one I see least often.** Saturn has none.

## Why rate limits matter

The first three mechanisms bound *rate of price impact* but not *absolute magnitude over a short window*. A compromised or rogue processor could, in principle, move the entire vault's worth of assets in a single block — within tolerance, with vesting absorbing the optics, with internal accounting matching. The first three checks all pass; only an attacker holding the processor key can do this, but that's exactly the threat model.

A simple rate limit ("processor cannot move more than X% of `totalAssets` per epoch") doesn't prevent gradual misbehavior, but it rules out the single-block extraction path. The implementation cost is low — a `lastProcessedEpoch` storage slot and a `processedThisEpoch` counter — so the absence is more about design choice than engineering effort.

## The bigger pattern

Trusted operator roles aren't going away. The protocols that age well are the ones that treat the role as a hostile-but-cooperative party: assume the key will eventually be compromised, and design every operator action so that the worst case (single-block compromise) has a finite blast radius.

Saturn does the first three well. The fourth — rate limits — is the gap.

## Notes

- Vesting and internal-balance tracking together cover most of the *bookkeeping* attack surface, but not the *magnitude* of asset movement.
- A timelock on processor actions is overkill — it would cripple legitimate operations. Rate limits are the right granularity.
- Operator-key rotation should be in scope for any protocol with a processor role; I haven't seen it implemented well anywhere yet.
