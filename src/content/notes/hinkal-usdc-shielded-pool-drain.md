---
title: "Hinkal shielded-pool drain: phantom notes from an unsound ZK proof"
date: 2026-07-03
updated: 2026-07-06
tags: ["zk", "privacy", "post-mortem", "incident"]
description: "A forensic writeup of the Hinkal USDC shielded-pool drain: five attacker addresses deposited 27,900 USDC, withdrew 800,992.64 USDC, and emptied the pool through proofs that appeared valid but failed to conserve hidden note value."
kind: incident
incident:
  loss: "773,092.64 USDC"
  scope: "protocol-wide"
  status: "post-mortem"
  occurredOn: 2026-07-02
---

# Security Incident Analysis — Hinkal Protocol Shielded-Pool Drain

**A post-incident forensic and root-cause report**

| Field | Value |
|---|---|
| Subject | Unauthorized drain of the Hinkal shielded pool (USDC), Ethereum mainnet |
| Affected contract | `0x25e5e82f5702a27c3466fe68f14abdbbadfca826` (Hinkal core) |
| Incident window | 2026-07-02 19:56 UTC (first exploit tx) → 2026-07-03 00:16 UTC (drain complete); contained 04:46 UTC |
| Net loss | **773,092.64 USDC** (≈ the entire pool) |
| Severity | **Critical** — complete, permissionless loss of pooled principal |
| Root cause | Soundness failure in the off-chain zero-knowledge withdrawal circuit / verifying key; the on-chain contract enforces no value conservation independent of the proof |
| Status | Contained (protocol paused by the owner) |
| Confidence | Root-cause *locus* — high (proven by elimination + empirical replay). Exact missing constraint — undetermined (requires off-chain circuit source). |
| Report date | 2026-07-03 |

---

## 1. Executive summary

An attacker withdrew essentially the **entire USDC balance of the Hinkal shielded pool** by abusing the protocol's normal `transact` entry point. The pool held **773,098.03 USDC** of legitimate deposits immediately before the incident and **5.39 USDC** after. Across a cluster of **five addresses** the attacker deposited only **27,900 USDC** of real funds and withdrew **800,992.64 USDC** — a net theft of **773,092.64 USDC**, taken from other depositors' principal.

The incident is **not** a Solidity coding bug, an admin-key compromise, a signature flaw, or a verifier swap. All of those were investigated and excluded. The failure is architectural and cryptographic: **Hinkal delegates 100 % of value-conservation to a zero-knowledge proof, and that proof system is unsound.** A genuine, correctly-functioning Groth16 verifier accepted proofs that let the attacker create shielded value from nothing ("phantom notes") and redeem it for real USDC.

The observed technique, confirmed across all five attacker addresses:

1. **Deposit once** (`prooflessDeposit`) to seed a single legitimate note.
2. **Repeatedly call `transact` with zero external USDC movement** — each call submits a valid proof that mints output notes worth more than the input notes it consumes (~310 of 422 pool-outbound transfers were zero-value; ~62 such calls per attacker address).
3. **Withdraw** the accumulated phantom balance as real USDC; the primary address extracted it in 25,000-USDC chunks.

The team contained the incident ~4.5 hours after the drain completed by setting the pool's helper contract to `address(0)`, which reverts every `transact`.

**Systemic implication:** because the flaw is in the proving system, every asset pool served by the same circuit family is exposed. The blanket pause was the correct mitigation. Recovery of funds is not achievable on-chain.

---

## 2. Severity and classification

| Dimension | Assessment |
|---|---|
| Impact | Critical — total loss of pooled principal (100 % of USDC pool) |
| Exploitability | Trivial once known — permissionless, no privileged access, no race, repeatable |
| Preconditions | None beyond a funded EOA and the ability to generate the malicious proof |
| Detectability (pre-exploit) | Low — requires circuit-level review; on-chain behavior looks like normal shielded activity |
| Class | Under-constrained ZK circuit / unsound verifying key (a recognized top-tier ZK vulnerability class) — compounded by absence of an on-chain value-conservation invariant (defense-in-depth failure) |

---

## 3. Affected system overview

Hinkal is a privacy (shielded-pool) protocol. Users deposit ERC-20s and hold value as commitments ("notes") in an on-chain Merkle tree; spends are authorized by zk-SNARK proofs and protected against double-spend by nullifiers.

**Contract topology (verified on-chain):**

| Component | Address | Verified source? | Role |
|---|---|---|---|
| Core (`Hinkal`) | `0x25e5e82f5702a27c3466fe68f14abdbbadfca826` | ✅ | Entry point (`transact`, `prooflessDeposit`); holds the money and the Merkle tree |
| Helper (`HinkalHelper`) | `0xF498fa8b0C1328a22f5d3764DcaB712728d12562` | ✅ | Builds the proof's public inputs; input validation |
| In-logic (`HinkalInLogic`) | `0xde88ff7ba99ac02109f4604bef2b48e01be27a4b` | ✅ | `delegatecall` target for deposit/internal accounting |
| Verifier forwarder | `0x163fe0B047ef9B4553E2AfF620AE3020883DFec5` (dims 1,2,1) | ❌ bytecode only | Routes `verifyProof` to the real verifier |
| **Groth16 verifier** | `0x2617f5b358dd51fe8e2357b0ef80254e8d515d74` | ❌ bytecode only | bn254 pairing checks + embedded verifying key |
| Owner (EOA) | `0xbdc77a0c69f13207acb70a6981cad60b4c1d1942` | — | Holds `onlyOwner` powers; executed the pause |

Notes established by direct verification: the core is **not** a delegating proxy (EIP-1967 implementation slot is empty; it holds its own verified bytecode — Etherscan's "implementation `0x94c8…`" label is a heuristic pointing at an older `HinkalInLogic`). The circuit source and verifying key are **not published** — the verifier embeds the VK as opaque constants and its source is unverified.

---

## 4. Incident timeline (UTC)

| Time | Block | Event |
|---|---|---|
| 2026-07-02 19:02:11 | 25,446,788 | Attacker EOA `0x105ad1…d7c0` funded with 0.257 ETH (its first-ever tx) |
| 2026-07-02 19:56:35 | 25,447,059 | **First exploit tx** — `prooflessDeposit` by `0x105ad1` (tx `0xb6dab069…54d9`); begins 3 deposits (100 USDC total) + 190 transacts, withdraws 0 — R&D / calibration |
| 2026-07-02 20:08:47 | 25,447,119 | `0x105ad1` prooflessDeposit `0xfbedf0cd…2f11` (a later deposit in its loop) |
| 2026-07-02 22:13 – ~00:00 | 25,447,737 – ~25,448,300 | Three more addresses (`0x3e15`, `0xc75d`, `0xd74c`) run near break-even loops — further calibration; each deposits ~1,000 USDC |
| 2026-07-03 00:07:23 | 25,448,306 | Primary address `0xbb3f…fc20` deposits 25,000 USDC and starts its run |
| 2026-07-03 ~00:15–00:16 | 25,448,345 – 25,448,351 | Bulk extraction: **30 × 25,000-USDC** withdrawals to `0xbb3f`; pool emptied |
| 2026-07-03 00:16:23 | 25,448,351 | Attacker activity ends; pool ≈ 5.39 USDC |
| 2026-07-03 ~00:21 | 25,448,374 | Launder: 797,000 USDC → ~454 WETH (Uniswap Universal Router), unwrapped to ETH |
| 2026-07-03 ~00:43–00:48 | 25,448,486–510 | Launder: 410 ETH into Tornado Cash (11×10 + 3×100) |
| 2026-07-03 ~01:22 | 25,448,683 | Launder: 44.67 ETH → BTC via THORChain → `bc1qr2sf…zn3w` |
| 2026-07-03 04:46:35 | 25,449,694 | **Containment** — owner calls `setHinkalHelper(address(0))` (tx `0x05c1f7ca…bb60c`); all `transact` now revert (~3.5 h after the attacker had fully exited) |

Balance ground truth (USDC `balanceOf` the pool):

| Block | Pool USDC |
|---|---|
| 25,445,000 – 25,447,118 (pre-attack, legit, stable) | 773,098.03 |
| 25,447,532 (after early attacker deposits) | 773,198.03 |
| 25,448,310 (mid, pre-bulk) | 765,798.03 |
| 25,449,694 (pause) & latest | 5.39 |

---

## 5. Impact assessment

- **Direct loss: 773,092.64 USDC**, reconciled exactly two independent ways (event-sum vs. balance snapshots):
  `773,098.03 (legit pre-attack) + 27,900.00 (attacker deposits, 5 addresses) − 800,992.64 (attacker withdrawals) = 5.39 (post)`.
- **Scope:** the entire pre-existing USDC pool — third-party depositors' principal — was taken. Attacker net gain ≈ the whole pool.
- **Beneficiary concentration:** `0xbb3f` netted +772,000 of the 773,092.64.
- **Recoverability:** effectively none for the USDC — proceeds were swapped, mixed through Tornado Cash, and partially bridged to Bitcoin (§5.1) before the protocol was even paused.

**Assets drained** — the exploit is circuit-wide, not USDC-specific:

| Asset | Pre-attack pool | Attacker in | Out | Net loss | Status |
|---|---:|---:|---:|:--|:--|
| USDC | 773,098.03 | 27,900 | 800,992.64 | **−773,092.64 USDC** | fully drained |
| ETH (native) | ~10.91 ETH | ~0.01 | ~0.40 ETH | **−~0.39 ETH** (~$0.7k) | partially drained; ~10.52 ETH remains |

The attacker fully monetized the USDC pool and took a small amount from the ETH pool (sub-1-ETH test withdrawals). **Every Hinkal pool remains at risk until the circuit is fixed** — the surviving ETH balance is protected only by the pause.

### 5.1 Post-incident fund flow (laundering trail)

The primary address `0xbb3f` laundered the proceeds within ~1 hour of the drain — and ~3.5 hours *before* containment — traced end-to-end on-chain:

| Step | Action | Amount | Destination / tx |
|---|---|---|---|
| 1 | Swap USDC → WETH (Uniswap Universal Router) then unwrap to ETH | 797,000 USDC → **454.24 WETH** | router `0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca`, tx `0x3d57b6f0…8036` |
| 2 | Deposit to **Tornado Cash** (14 deposits: 11×10 ETH + 3×100 ETH) | **410 ETH** | Tornado Router `0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b`, blocks 25,448,486–25,448,510 |
| 3 | Bridge to **Bitcoin via THORChain** | **44.6747 ETH** | THORChain Router `0xd37bbe5744D730a1d98d8DC97c42F0Ca46aD7146`, tx `0x14dd7a30…6deb` |

The THORChain deposit memo — `=:b:bc1qr2sfkehuqgr0sp87sp25uzw79242523l26zn3w:122370548/0/25:sto:0` — is a swap to native BTC delivered to Bitcoin address **`bc1qr2sfkehuqgr0sp87sp25uzw79242523l26zn3w`**. In total ≈ 454.7 ETH left via Tornado Cash (410) and a cross-chain BTC bridge (44.7). The attacker had fully exited before the protocol was paused (04:46 UTC).

---

## 6. Attack analysis

### 6.1 Threat actor and infrastructure

Five coordinated EOAs, each exhibiting the identical pattern (`prooflessDeposit` + many `transact`), plus three withdrawal-only payout addresses:

| Address | Deposited | Withdrawn | Net | Tx pattern | Role |
|---|---:|---:|---:|---|---|
| `0x105ad144e8952236144dfe2e135ced7812e3d7c0` | 100 | 0 | −100 | 3 deposit + 190 transact | **first prober / R&D** (from 19:56 UTC; never cashed out) |
| `0xd74c58561adf1e9a10e7ad67fb5920d7c20ccaa4` | 800 | 1,000 | +200 | 1 deposit + 62 transact | probe |
| `0x3e15f3e96115735340f03d6044e0d6c21f8f6056` | 1,000 | 1,200 | +200 | 1 deposit + 94 transact | probe |
| `0xc75d0b625570f3dbe81f329e516e41a29f0644dc` | 1,000 | 1,000 | 0 | 1 deposit + 94 transact | probe |
| `0xbb3f01a1b1c68f3deb36c55342b5f5706c32fc20` | 25,000 | 797,000 | **+772,000** | 1 deposit + 94 transact | primary drainer |
| *3 payout-only addrs* (`0xbe4c2d07…`, `0xe42ce2de…`, `0xb8d5e90d…`) | 0 | 792.64 | +792.64 | withdrawal recipients | test/dust destinations |
| **Total** | **27,900** | **800,992.64** | **+773,092.64** | | |

### 6.2 Kill chain

- **Phase 1 — Seed (one honest deposit).** A single `prooflessDeposit` (`0x0ed4a94e`) transfers real USDC in and mints one legitimate note, establishing a valid Merkle root to spend against. This is the only honest value transfer.
- **Phase 2 — Mint (repeated zero-value transacts).** The bulk of activity is `transact` (`0x979a77a8`) calls that move **0 USDC** externally. Each supplies a valid proof creating output-note commitments whose hidden value exceeds the input notes being nullified. Because value conservation is enforced only by the proof (§7), each call mints phantom shielded balance at no cost. Empirically, **~310 of 422** pool-outbound USDC transfers were zero-value (~62 per attacker address).
- **Phase 3 — Extract (withdrawals).** A smaller set of `transact` calls carry negative `amountChanges`, releasing real USDC to external addresses. Nonzero withdrawal distribution: **25,000 × 30**, 1,000 × 47, 100 × 32, plus dust — the whale `0xbb3f` pulled 797,000, dominated by the 25k chunks.

### 6.3 Mapping to the three sample transactions

| Tx | Function | Meaning |
|---|---|---|
| `0x26c1a6…4630` | `prooflessDeposit` (1,000 USDC in) | Phase 1 — seed one note |
| `0x6092eb…896f` | `transact` — **0 USDC** external, 1 `Nullified` + 1 `NewCommitment` | Phase 2 — phantom mint (repeated) |
| `0x753e0a…c1b6` | `transact` — 1,000 USDC out to a fresh address, `amountChanges = -1000e6` | Phase 3 — withdrawal |

---

## 7. Root cause analysis

### 7.1 Where value conservation is (not) enforced

`transact()` gates every call on four checks. Only the zk proof actually constrains value:

1. **Proof verification** — `require(verifyProof(a,b,c, publicInputs, verifierId))`.
2. **Root validity** — `require(rootHashExists(rootHashHinkal))` (trivially satisfiable after one deposit).
3. **Per-token balance equation** — `balanceDif == amountChanges[i] + utxoAmount + approvalChanges + …`.
4. **Nullifier uniqueness** — `require(!nullifiers[n])`, then mark spent.

The design intent is that (1) proves value conservation among hidden notes, while (2)–(4) bind the proof to on-chain state.

### 7.2 Why the on-chain guards cannot catch this

- **The balance equation is a tautology for withdrawals.** With no on-chain change note and approvals deprecated, check (3) reduces to `balanceDif == amountChanges[i]` → `-sumAbs == -sumAbs`. It only confirms the tokens that left equal the number the caller *claimed* would leave — never that the burned note actually held that value. The core stores **no per-note balances**; note values are hidden inside commitments (Poseidon hashes), opaque to the contract.
- **Nullifier uniqueness only blocks replay of the *same* note.** A valid-looking proof can present a fresh nullifier each call — consistent with the many distinct nullifiers observed. The double-spend guard is correct but out of scope for this attack.
- **Consequence:** the sole real barrier to withdrawing more than deposited is the **proof**. If the proof system is unsound, nothing on-chain contains the loss. This is a **defense-in-depth failure**: there is no independent on-chain invariant bounding withdrawals by deposits.

### 7.3 Hypothesis testing — causes investigated and excluded

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Solidity logic bug in the core | **Excluded** | `Hinkal`, `HinkalHelper`, `HinkalInLogic` are all verified and internally consistent; `transact` flow reviewed line-by-line |
| Faulty public-input assembly (helper) | **Excluded** | Verified `HinkalHelper.formBasicInput` binds `rootHash`, `amountChanges`, `inputNullifiers`, `outCommitments`, `timeStamp`, `calldataHash` as public signals; `performHinkalChecks` enforces `getHashedCalldata == calldataHash` (calldata integrity); `dimensionsCheck` forces verifier selection to match array lengths |
| Verifier is a no-op / stub | **Excluded** | Real ~2.6 KB Groth16 verifier: bn254 pairing precompiles (0x06/0x07/0x08), embedded field prime and VK constants |
| Verifier swapped / owner compromise near attack | **Excluded** | Full history: 117 `VerifierRegistered`, **0** `VerifierRemoved`; last registration block 25,285,711 (~3 weeks prior); ownership last changed block 23,119,995 — none near the incident |
| Wrong code analyzed (proxy indirection) | **Excluded** | EIP-1967 implementation slot is empty; core holds its own verified bytecode |
| **Under-constrained circuit / unsound verifying key** | **Confirmed locus** | See §7.4–7.5 |

*Residual caveat:* a verifier *registered* ~3 weeks before the attack could in principle have been intentionally backdoored at registration; this is still an "off-chain zk" fault (with owner implication) and cannot be distinguished from an honest-but-unsound circuit using on-chain data alone.

### 7.4 Confirmed root cause

**A soundness failure in the off-chain zk withdrawal circuit / verifying key.** The registered Groth16 verifier accepted proofs for shielded spends/outputs that violate value conservation (`Σ input-note value == Σ output-note value + withdrawal`). This lets an attacker mint phantom notes and redeem them. With every auditable layer verified sound, the defect necessarily resides in the one unpublished component: the circuit and its VK — i.e., an **under-constrained circuit** (a missing value-conservation and/or Merkle-membership constraint) or a **compromised/incorrect trusted setup**.

Logical chain:
> `transact` succeeded ⇒ a real Groth16 verifier accepted the proof ⇒ yet withdrawals exceeded deposits (value was minted) ⇒ the proven statement does not enforce value conservation ⇒ the circuit is under-constrained or its VK/trusted setup is unsound.

### 7.5 Empirical verification (proof replay)

The critical link — "a real verifier accepted the attacker's proof" — was reproduced on-chain, not merely inferred:

1. Recovered the proof `(a,b,c)` from a real attacker `transact` (`0x753e0a…c1b6`).
2. Reconstructed the exact **14 public signals** by calling `HinkalHelper.performHinkalChecks(circomData, dimensions, sender)` on-chain at the tx's block (25,448,295).
3. Called `verifierMap[verifierId].verifyProof(a,b,c,input,verifierId)` at the same block → **returned `true`**.
4. **Control:** flipped a single public-input bit → **returned `false`**.

The control proves the verifier performs genuine cryptographic checking (not a rubber stamp). Therefore the attacker's proof was a *valid* Groth16 proof — for a statement that fails to enforce value conservation.

### 7.6 Domain context

Under-constrained circuits are a recognized top-tier vulnerability class in ZK systems: a circuit that is missing a constraint accepts witnesses that satisfy the (incomplete) relation while violating the intended invariant, and the verifier — doing exactly its job — returns "valid." A verifying key is a **one-way commitment** to the circuit: it cannot be reversed to recover the constraints, which is precisely why the specific defect is not determinable from on-chain bytecode. In a shielded pool the canonical missing constraints are (a) balance/value conservation across inputs and outputs, and (b) Merkle-membership of every spent note. Either omission produces exactly the behavior observed here.

---

## 8. Evidence & methodology (reproducibility and calibration)

**Data sources:** Etherscan V2 API (source, ABIs, tx/receipt/logs); Infura archive RPC (historical `balanceOf`, storage/getter reads, `eth_getLogs`, historical `eth_call`); `cast` (Foundry) for decoding and calls.

**Key techniques:**
- Loss quantified authoritatively via `eth_getLogs` on the USDC `Transfer` topic filtered by the pool address, cross-checked against `balanceOf` snapshots — agreement to the cent (5.39 residual).
- Attacker attribution via per-address `txlist` filtered to the pool (selector classification).
- Helper timeline and verifier registration via historical `eth_call` and full-history `getLogs`.
- Verifier authenticity via bytecode disassembly (opcode profile, precompile usage, VK constants).
- Proof acceptance via on-chain replay with a tampered-input control.

**Calibration:**

- **Proven (hard on-chain evidence):** loss magnitude and reconciliation; attacker addresses and tx pattern; zero-value-transact prevalence; contract topology and verification status; no verifier/ownership change near the incident; the tautological balance check and nullifier scope; verifier accepts the real proof / rejects tampered input.
- **Inferred (strong, by elimination + logic):** the fault is in the off-chain circuit/VK rather than any on-chain component.
- **Undetermined (not obtainable on-chain):** the *specific* missing constraint, and whether the fault is an under-constrained circuit vs. a compromised trusted setup. Resolving these requires the off-chain circuit source and ceremony artifacts. (Scope note: this analysis covered Hinkal's Ethereum USDC and ETH pools; pools of other tokens or on other chains were not examined and should be checked by the team.)

---

## 9. Detection & containment

- **Action:** owner `0xbdc77a0c…` called `setHinkalHelper(address(0))` at block 25,449,694 (2026-07-03 04:46:35 UTC).
- **Mechanism:** `performHinkalChecks` is invoked at the top of both `transact` and `prooflessDeposit`; with the helper at `address(0)` the external call reverts (empty-account check), halting every fund-touching path in a single transaction. The helper was used as a **kill-switch, not because it was faulty** — they set it to `0` (halt), not to a corrected helper. Verified empirically: after the pause block the *only* transaction the pool received is that `setHinkalHelper` call.
- **Gap:** the drain completed in ~9 minutes of concentrated activity, ~4.5 hours before containment. The pause limited *further* loss but did not prevent the primary drain. There is no dedicated `pause()`; a single owner EOA halted the protocol unilaterally.

