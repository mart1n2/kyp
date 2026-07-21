---
title: "Allbridge Core Solana drain: same-pool account aliasing inflated vUSD state"
date: 2026-07-20
tags: ["solana", "bridge", "stablecoin", "flash-loan", "post-mortem", "incident"]
description: "A forensic analysis of the July 2026 Allbridge Core Solana drain: duplicate source and destination pool accounts were accepted by swap, repeated same-token calls compounded internal vUSD state, and approximately 1.657 million nominal stablecoin units left the USDC and USDT vaults."
relatedProtocol: "Allbridge Core"
kind: incident
incident:
  loss: "1,656,942.281791 nominal stablecoin units"
  scope: "protocol-wide"
  status: "ongoing"
  occurredOn: 2026-07-19
---

# Allbridge Core Solana drain: same-pool account aliasing inflated vUSD state

On 19 July 2026, an unprivileged account used a Kamino flash loan and seven Allbridge Core swaps to remove **1,118,249.784288 USDC and 538,692.497503 USDT** from the protocol's Solana vaults. Valuing each stablecoin at a nominal $1, the pool loss was **1,656,942.281791 stablecoin units**.

The confirmed entry condition was a missing relationship check in Allbridge Core's Solana `Swap` path. Five abnormal calls supplied the same USDT mint, the same mutable `Pool` account, and the same token vault in both the source and destination roles. All five calls succeeded. Their logged internal vUSD output grew from 161,803.722 to 1,824,451.735 vUSD before a final, ordinary USDT-to-USDC swap paid 2,240,206.783787 USDC for 3,987.465 USDT.

The most strongly supported explanation is mutable-account aliasing with stale logical copies of pool state: source-side and destination-side calculations treated one physical account as two roles, after which one serialization overwrote the other. That mechanism fits the decoded account metas, execution logs, deployed ELF structure, Anchor account behavior, and a StableSwap recurrence model. It is not yet field-level confirmed because the investigation did not have a pinned pre-exploit snapshot of every mutable account and a historical-state replay of the deployed binary.

Allbridge's stop authority disabled Solana swaps **2 hours, 19 minutes, and 5 seconds** after the exploit. Later swap-and-bridge calls failed with `ForbiddenAction`, while deposits and withdrawals remained enabled at the pinned configuration slot. No program upgrade was observed. The immediate path was therefore contained by the kill-switch, but the report found no deployed code fix.

## Incident at a glance

| Field | Value |
|---|---|
| Affected product | Allbridge Core on Solana, not Allbridge Classic |
| Exploit transaction | `3LNLaGi36bqoSBFBqcQ3ZvDbnGCxrxu4rqahZrnfHZjKSYxfR1mqiCXtBXjjeBmoRQDeSiKxZ7c1nFb8pBgTY39Q` |
| Exploit slot | `433,941,722` |
| Exploit time | 2026-07-19 17:51:28 UTC |
| Direct pool loss | 1,118,249.784288 USDC + 538,692.497503 USDT |
| Confirmed root-cause class | Missing same-asset and duplicate-account validation in `Swap` |
| Mechanism confidence | Same-pool accounting inconsistency strongly supported; exact write order inferred |
| Containment | Solana swap action disabled at slot `433,961,517` |
| Code-fix status in the report | No program upgrade observed |

The loss figure uses nominal stablecoin units to communicate scale; it is not a historical market-price valuation.

## Affected program and accounts

The exploited deployment was the Allbridge Core program `BrdgN2RPzEMWF96ZbnnJaUtQDQx7VRXYaHHbYCBvceWB`. Its upgradeable-loader ProgramData account was `GMztYKwP1HktGVArjhkEQUYbteqy9QMU8A9etUC5R4KT`, with upgrade authority `tempg6Y1TeRAYm5aHG43yGAtV5UYCNuHFpC17hmYAWz`. Program-data metadata placed the last upgrade at slot `204,727,029`, long before the incident.

| Role | Address | Significance |
|---|---|---|
| Allbridge Core program | `BrdgN2RPzEMWF96ZbnnJaUtQDQx7VRXYaHHbYCBvceWB` | Invoked by all seven swaps |
| Config | `EroEBUxixXh3pZ53u4xRbyRjRBifsiZuHChDQXQ7eMrn` | Stores action gates; `can_swap=false` at pinned slot `434,074,537` |
| Stop authority | `HchRpjmb9QT4iiVUGLrZE23y4q8GnLMTYe8wT96dSx8q` | Signed the containment transactions |
| Pool authority | `7DyZQw3iV5zhHssnNA6Nopi5zc8NGLbYjHMcaok6NN66` | Controls the token vaults |
| USDC pool | `5NQbhSDg4TKVvq7z3PTbqSzAiHwB7amxmxqkViQnyVnZ` | Destination pool in the final extraction swap |
| USDC vault | `G6Qo3WW7RbWpSmACAocTBVgx6JW5kgRpUhABphEoDMfP` | Lost 1,118,249.784288 USDC |
| USDT pool | `DW4a2Eq7X5MiPkzscGMJmgjsDaSWrWMkqPtRGLFyZwCX` | Occupied both pool roles in five same-token swaps |
| USDT vault | `2xY9TDMjfvdoXQPYMATQLEY6z55KpJrHf8NpkNdAvohV` | Occupied both vault roles and lost 538,692.497503 USDT |
| Attacker signer | `FhffBraZsGn4H2LxLNToEcaHWEfWwT2UcSz4oRHb7Qdc` | Signed the exploit and received extracted tokens |
| Kamino Lend program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | Supplied the atomic flash loan |

The public JavaScript SDK and its bundled IDL describe a similar interface, but the IDL declares a different program ID. The report therefore treated it only as corroboration. The confirmed entry-condition analysis instead used the exploited program's ELF and the transaction's actual account metas.

## Exploit sequence

The transaction began with a flash borrow of **1,121,956.999499 USDC** from Kamino. A normal Allbridge USDC-to-USDT swap returned **948,927.526416 USDT** and placed the pools in the starting state used by the aliasing loop.

The attacker then submitted five USDT-to-USDT swaps of 100,000 USDT each. In every call, the logical source and destination roles resolved to the same physical objects:

| Logical role | Physical account supplied |
|---|---|
| Send mint | USDT mint |
| Receive mint | USDT mint |
| Send pool | `DW4a2Eq7X5MiPkzscGMJmgjsDaSWrWMkqPtRGLFyZwCX` |
| Receive pool | `DW4a2Eq7X5MiPkzscGMJmgjsDaSWrWMkqPtRGLFyZwCX` |
| Send vault | `2xY9TDMjfvdoXQPYMATQLEY6z55KpJrHf8NpkNdAvohV` |
| Receive vault | `2xY9TDMjfvdoXQPYMATQLEY6z55KpJrHf8NpkNdAvohV` |

The repeated calls returned only 93,752.455887 USDT in aggregate against 500,000 USDT sent. Their economic purpose was not direct token profit. Each successful call left the internal pool state more favorable for the next quote:

| Swap | Direction | Input | Logged vUSD output |
|---:|---|---:|---:|
| 1 | USDC → USDT | 1,121,956.999499 USDC | 1,057,098.378 |
| 2 | USDT → USDT | 100,000 USDT | 161,803.722 |
| 3 | USDT → USDT | 100,000 USDT | 256,223.396 |
| 4 | USDT → USDT | 100,000 USDT | 470,599.423 |
| 5 | USDT → USDT | 100,000 USDT | 917,974.418 |
| 6 | USDT → USDT | 100,000 USDT | 1,824,451.735 |
| 7 | USDT → USDC | 3,987.465 USDT | 2,243,572.118 |

The final USDT-to-USDC call transferred **2,240,206.783787 USDC** to the attacker after curve and fee accounting. The attacker repaid the flash principal and an **11.219570 USDC** Kamino fee in the same atomic transaction.

## Why duplicate mutable accounts matter

The deployed ELF contains the Swap discriminator and the account-role sequence `send_mint`, `receive_mint`, `send_pool`, `receive_pool`, `send_bridge_token`, and `receive_bridge_token`. The exploit transaction supplied the duplicate objects in those exact positions. Successful execution is direct evidence that the deployed path did not enforce the necessary inequalities; the existence of a generic Anchor error string elsewhere in the binary would not change that conclusion.

The deeper implementation mechanism requires a narrower confidence statement. Anchor's public `Account<T>` model can deserialize two occurrences of the same `AccountInfo` into separate owned values. If a handler mutates both logical values and serializes them in sequence, the later exit can overwrite state written by the earlier one. In this incident, that would allow source-side and destination-side curve calculations to start from stale copies of one pool, preventing their deltas from composing into a conserved state transition.

Several observations support this explanation:

- The ELF contains separate source and destination role names and a distinct core execution path that constructs SPL Token instructions.
- Each abnormal call completed both token-program CPIs with Allbridge's quote and accounting logs between them.
- The same-token vUSD sequence compounds predictably across five calls.
- A StableSwap model with amplification parameter 20 reproduced the recurrence to approximately `1.5e-7` relative error and the final payout to within roughly 0.04%.

None of those observations exposes the exact pool byte offsets written by each logical role. The investigation did not replay the deployed ELF against a complete pre-exploit account snapshot, so it did not elevate the stale-write explanation to a field-level confirmed result. A different state field or CPI effect could only be excluded conclusively by that historical replay.

The violated invariants are nevertheless clear. Source and destination mints, pools, and vaults must represent distinct sides of a trade; one writable account must not occupy roles whose updates are independently computed; serialized pool deltas must reconcile with actual vault deltas; and a same-asset swap must be rejected or economically idempotent after fees.

## Loss reconciliation

The pool loss was independently reconstructed from decoded transfers and pre/post token balances.

**Attacker USDC balance:**

```text
+ 1,121,956.999499  flash borrow
+ 2,240,206.783787  final Allbridge payout
- 1,121,956.999499  first Allbridge input
- 1,121,956.999499  flash principal repayment
-        11.219570  Kamino fee
= 1,118,238.564718  attacker net USDC
```

**Attacker USDT balance:**

```text
+ 948,927.526416  first swap output
+  93,752.455887  five loop outputs
- 500,000.000000  five loop inputs
-   3,987.465000  final swap input
= 538,692.497503  attacker net USDT
```

The Allbridge USDC vault fell by 1,118,249.784288 USDC. That equals the attacker's 1,118,238.564718 USDC net plus the 11.219570 USDC paid to Kamino. The USDT vault fell by exactly the attacker's 538,692.497503 USDT net. No unexplained residual remained.

## Cross-chain fund flow

The extracted assets were routed from Solana through Mayan. Circle message data showed destination domain `0`, which identifies **Ethereum**, not Arbitrum. Mayan hook data encoded `0x651591b68a9c9650fb23f642162353306281ffde` as the final initial beneficiary; `0x82d9a407f99a95db4671e7021d625cbd0787a407` was a referrer. The beneficiary is an EOA, not Mayan's forwarding contract.

Initial Ethereum settlement delivered **578.45520830 ETH** and **557,774.209343 DAI**. The subsequent public trace split into three material routes:

1. Net deposits of 283.41423634 ETH through Maya Protocol delivered **930.46160047 ZEC** to `t1KHDfWNpTQZjiipfW8z36QmdkaWL87zsBq`. Three outgoing transactions moved effectively the full balance into Zcash Orchard outputs, ending the public value trace.
2. A RAILGUN route shielded 307,004.7740690175 DAI and later unshielded 306,237.26213384495 DAI back to the same Ethereum beneficiary. It was therefore a round-trip, not a terminal destination.
3. The beneficiary forwarded 295 ETH and 256,000 DAI through `0x8fef26dc551f61ae40e03cea7757342fd1ea0234` to `0x2cff890f0378a11913b6129b2e97417a2c302680`.

The last address was an unlabeled, high-throughput, multi-asset wallet with commingled balances. The flow establishes receipt, but not whether it was controlled by the attacker or operated as a service. At the investigation cutoff, Ethereum block `25,573,058`, the initial beneficiary retained **300,237.263291619 DAI**, **45.708329 USDC**, and **0.053633427448522814 ETH**.

## Containment and residual exposure

At 20:10:02 UTC, the protocol set `HchRpjmb9QT4iiVUGLrZE23y4q8GnLMTYe8wT96dSx8q` as stop authority. Thirty-one seconds later, `stop_bridge(Swap)` disabled swapping. The elapsed time from exploitation was 2:19:05.

At pinned Solana config slot `434,074,537`, the gates read:

```text
can_swap     = false
can_deposit  = true
can_withdraw = true
```

Two later `SwapAndBridge` transactions failed with custom error 6011, `ForbiddenAction`, confirming that the action gate was active. Those failures do not establish that the callers were repeat exploiters. Later successful pool-authority transactions decoded as LP withdrawals rather than administrative rebalancing.

The incident concerns the Solana implementation of Allbridge Core. Other Solana Core pools using the same instruction, configuration, and code path share the relationship-check exposure whenever swapping is enabled. Deployments on other chains use different runtime implementations and are not automatically affected without code-specific analysis.

## Evidence verdict

| Claim | Verdict | Basis |
|---|---|---|
| Exploit transaction, signer, and seven-swap sequence | Confirmed | Finalized transaction data and decoded instructions |
| Duplicate USDT mint, pool, and vault reuse | Confirmed | Actual account metas in five successful swaps |
| Pool loss | Confirmed | Inner transfers and pre/post balances reconcile exactly |
| Missing effective duplicate-account rejection | Confirmed | The deployed path accepted and executed the calls |
| Same-pool two-half accounting inconsistency | Strongly supported | Account aliasing, logs, curve recurrence, and ELF role separation |
| Stale write-back as the exact binary mechanism | Inferred | Best fit, but no historical-state deployed-ELF replay |
| Ethereum as the Mayan/CCTP destination | Confirmed | CCTP domain, hook data, and settlement transactions |
| `0x6515…ffde` as initial Ethereum beneficiary | Confirmed | Encoded hook destination and direct payouts |
| `0x2cff…2680` as attacker-controlled | Unresolved | Fund flow exists, but commingling prevents ownership attribution |
| ZEC entering Orchard shielded outputs | Confirmed | Transparent debits and Orchard-containing transactions |
| A deployed program fix | Not observed | Swap gate changed; no program upgrade observed in the report |

The incident establishes the vulnerable input relationship and the accounting-inconsistency root-cause class. Confirming the exact field mutation and serialization order still requires a replay of the pinned deployed ELF against complete historical account state and a patched counterfactual.

## References

- [Allbridge Core technical documentation](https://github.com/allbridge-io/allbridge-core-docs)
- [Allbridge Core JavaScript SDK and Solana IDL](https://github.com/allbridge-io/allbridge-core-js-sdk)
- [Anchor `Account<T>` implementation](https://github.com/coral-xyz/anchor/blob/v0.26.0/lang/src/accounts/account.rs)
- [Anchor generated `AccountsExit` implementation](https://github.com/coral-xyz/anchor/blob/v0.26.0/lang/syn/src/codegen/accounts/exit.rs)
- [Circle CCTP supported domains](https://developers.circle.com/cctp/cctp-supported-blockchains)
- [Maya Protocol memo guide](https://dev.mayaprotocol.com/swap-guide/memos)
- [CipherScan result for the Zcash destination](https://api.mainnet.cipherscan.app/api/address/t1KHDfWNpTQZjiipfW8z36QmdkaWL87zsBq)

*This note is a post-incident analysis of an already-executed on-chain exploit. Status and balances are pinned to the slots and cutoff block stated above.*
