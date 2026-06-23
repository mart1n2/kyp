---
name: report-metadata-extractor
description: Convert a raw DeFi audit report (Audit Framework V1.x output) into the KYP site content. Produces TWO artifacts — public metadata.json (dashboard) and a self-contained long-form markdown (/reports/...). Raw audit is INPUT ONLY. Descriptive framing only — no investment advice, no position sizing.
---

# KYP — Raw Audit Report → Site Version

The KYP site has two pages per protocol:

1. `/protocols/<protocolSlug>` — the **dashboard** (structured, scannable). Driven by `metadata.json`.
2. `/reports/<protocolSlug>/<slug>` — the **long-form analysis** (narrative). Driven by the markdown body.

This skill converts the user's raw audit report (the Audit Framework V1.x output) into both artifacts:

```
src/content/reports/<protocolSlug>/
  ├── <slug>.md              ← site-version long-form (NOT a copy of the raw)
  └── <slug>.metadata.json   ← public audit metadata
```

The raw report is **input only**. It is not shipped to the site. Both site artifacts are derived from it.

## Public-view framing — read first

The site is **public** and presents **technical audit findings only**. It does **not** issue
investment advice. Apply this everywhere:

- **Describe findings, do not prescribe actions.** Use language like "the deal-breaker gate fails on X" or "EOA controls upgrade authority", not "do not invest" / "avoid" / "REJECT".
- **Do not include capital-allocation guidance** — position-size caps, exposure limits, monitoring frequency for active positions, exit triggers. The schema has no fields for these.
- The auditor's `Recommendation` paragraph in the raw report is fund-internal language. Translate it to a `findingsSummary` (descriptive, factual) for the dashboard, and into the `## Findings` section of the long-form (narrative, factual).
- The `dealBreakers` headline string should read "N Failed — Gate not cleared" or similar, not "REJECT".
- `openIssues[].recommendation` IS appropriate — those are technical recommendations from the auditor TO the protocol team. Keep verbatim.

## Sources of truth (read these before extracting)

- **Zod schema (runtime validation):** `src/content.config.ts`
- **JSON schema (field reference):** `schemas/report-metadata.json`
- **Canonical metadata example:** `src/content/reports/saturn-credit/saturn-ethereum-2026-04-15.metadata.json`
- **Canonical long-form example:** `src/content/reports/saturn-credit/saturn-ethereum-2026-04-15.md`

If the schema files have evolved beyond what this skill describes, **trust the schema files**.

## Inputs

- Path to the raw audit report markdown (the framework V1.x output). If not provided, ask the user for one.
- (Optional) Override `protocolSlug` or `slug` if not derivable.

## Workflow

1. Read the raw report. Identify framework version and complexity tier from the header table.
2. Derive identifiers:
   - `protocolSlug` = lowercase protocol name, non-alphanumerics → `-`, trim. *Saturn Credit* → `saturn-credit`.
   - `slug` = `<protocolSlug-distinctive>-<chain-lower>-<auditDate-iso>` (e.g. `saturn-ethereum-2026-04-15`).
3. Create `src/content/reports/<protocolSlug>/` if missing.
4. Build `<slug>.metadata.json` per the section mapping below.
5. **Write a fresh `<slug>.md` per the long-form template below.** Do NOT copy the raw report verbatim. The long-form is a narrative companion, not a transcript of the framework output.
6. Validate: run `npm test`. Fix any Zod/schema failures before declaring done.

---

## Part A — `metadata.json` (drives the dashboard)

### Section-by-section mapping (Audit Framework V1.x → metadata.json)

| Raw report section                          | Metadata field(s) |
| ------------------------------------------- | ----------------- |
| Header table                                | `protocol`, `chain`, `auditDate`, `complexityTier` |
| Executive Summary table                     | `securityScore`, `securityGrade`, `riskLevel`, `dealBreakers` (rephrased), `dealBreakerGate`, `monitoringCadence` |
| Executive Summary → Key Findings (numbered) | `keyFindings[]` (headline form) |
| Executive Summary → Recommendation          | `findingsSummary` (rewritten descriptively) |
| §1 Deal Breaker Analysis (sub-tables)       | `dealBreakerDetails[]` with `category` per sub-section; `dealBreakerSummary` from §1 totals |
| §4.3 Investment Decision                    | confirms `dealBreakerGate`, `monitoringCadence` |
| §5.1 Open Issues table                      | `openIssues[]` |
| §6.1 Protocol Overview                      | `protocolMeta` |
| §6.2 Smart Contract Addresses               | `contracts[]` |
| §6.3 Audit History                          | `auditHistory[]` (tier mapping below) |
| §6.4 Multisig & Governance Configuration    | `adminControlMatrix[]` (consolidated trust surfaces) |
| §6.6 Access Control Role Summary            | `accessControlRoles[]` |
| Bug bounty mention                          | `bugBounty` object, or `null` if none |
| §4.3 Conditions for Re-evaluation           | **DROP — not on the public site** |
| §5.2 Monitoring Plan                        | **DROP — not on the public site** |
| §5.3 Exit Triggers                          | **DROP — not on the public site** |

### `dealBreakerGate`

| Framework decision   | `dealBreakerGate` |
| -------------------- | ----------------- |
| REJECT / REJECTED    | `Fail` |
| CONDITIONAL          | `Conditional` |
| WATCH                | `Watchlist` |
| ACCEPT / APPROVED    | `Pass` |
| Pipeline halted, undecidable | `Inconclusive` |

**Do not infer `Pass` when one or more deal breakers are FAIL** — that's `Fail`.

### `monitoringCadence`

| Framework value                       | `monitoringCadence` |
| ------------------------------------- | ------------------- |
| Daily / Weekly / Monthly / Quarterly  | same |
| Avoid / N/A / not applicable          | `N/A` |

### `findingsSummary`

Rewrite the auditor's `Recommendation` paragraph descriptively (1–3 sentences). Replace prescriptive openings with the underlying finding. Example:

- "Do not invest. Three of four core upgradeable contracts can be unilaterally upgraded by a single EOA…"
  → "Three of four core upgradeable contracts can be unilaterally upgraded by a single EOA. The deal-breaker gate fails on EOA upgrade control, EOA fund control, and timelock backdoors."

### `dealBreakers` headline string

If the framework wrote "3 Failed — REJECT", change to "3 Failed — Gate not cleared". For zero failures: "0 Failed — Gate cleared".

### `dealBreakerDetails[].category`

Use the §1 sub-section heading verbatim:
- `Access Control & Governance`
- `Oracle & Price Integrity`
- `Smart Contract Architecture`
- `Audit & Verification`
- `Economic & Liquidity`
- `Cross-Chain & Bridges`

### `dealBreakerSummary`

Sum statuses: `{ pass, fail, na, inconclusive }`. Cross-check against §1 totals.

### `adminControlMatrix[]`

Each row is a **trust surface** (a power that, if abused, affects funds), not a literal §6.4 row. Consolidate §6.4 and §1.1 upgrade-authority callouts into:

```json
{
  "surface": "<Contract> — <Power>",
  "controller": "<full 0x address or label>",
  "controllerType": "EOA" | "Multisig" | "Governance" | "Timelock" | "Contract" | "Unknown",
  "multisigConfig": "M/N",
  "delayHours": 0,
  "worstCase": "<one short sentence: what an abuse achieves>"
}
```

`controllerType` heuristics:
- `code size = 0` or `(EOA)` flag → `EOA`
- "Gnosis Safe" / "Safe" / "M/N multisig" → `Multisig`
- "TimelockController" / "Timelock" → `Timelock`
- "Governance" / "DAO" / "Governor" → `Governance`
- Other contract address → `Contract`
- Unclear → `Unknown`

`delayHours` is 0 unless a timelock sits on the path.

### `auditHistory[].tier`

Default tier mapping (override only if the raw provides explicit tiers):
- **Tier 1**: Trail of Bits, OpenZeppelin, Certora, ConsenSys Diligence, Spearbit, Sigma Prime, Cantina (top engagements)
- **Tier 2**: Three Sigma, Halborn, Quantstamp, ChainSecurity, Pashov, Zellic, Code4rena (contest)
- **Tier 3**: Independent reviewers, unverified firms, internal audits

If table cells are `Unknown`, keep `date: "Unknown"` and omit `findings`.

### `openIssues[]`

Direct mapping from §5.1 columns. The `recommendation` field is the auditor's technical recommendation to the protocol team — keep verbatim.

### `protocolMeta`

Pull from §6.1. `tvlUsd: null` if not tracked. If not on DeFiLlama, `tvlSource: "Not listed on DeFiLlama"`.

### `bugBounty`

If a program exists: `{ provider, maxBountyUsd, url }`. If none / "404", set the entire field to `null`.

### `keyFindings[]`

Headline-form bullets, ≤ ~120 chars. 3–6 items. Include all deal-breaker FAILs plus material non-deal-breaker risks from §2.

---

## Part B — long-form `.md` (drives `/reports/...`)

The long-form is a **self-contained, public-facing technical report** — the comprehensive document a reader can study end-to-end without bouncing to the dashboard. It is NOT the raw audit, and it is NOT a thin pointer back to the dashboard. It is a fresh markdown document, **~2000–3500 words** (scaling with complexity tier), written from the raw report's content and including the structured detail inline as markdown tables.

The dashboard is the scan/triage view across protocols. The long-form is the deep-read view of one protocol. Each is self-sufficient for its task; some content overlap (contract inventory, trust matrix, deal-breaker matrix) is intentional.

Things the long-form **must NOT contain**:

- The framework's executive-summary verbatim with prescriptive language.
- "Investment Decision: REJECTED", "Max Position Size", "Monitoring Frequency: Avoid", or any prescriptive recommendation to readers.
- Re-evaluation conditions, monitoring plans, exit triggers — those are operational/private.
- Framework boilerplate (Auditor Sign-off, Data Sources tables, simulation gate text, score-calculation walks).

### Long-form template (numbered sections, technical-report style)

```markdown
# <Protocol Name> — Long-form Analysis

> One-sentence abstract: what the protocol does.

## 1. Executive Summary

2–3 paragraphs. What the protocol is, the headline finding(s), the gate
outcome at a high level, and the score/grade/risk in plain English. This
is the section a reader skims first.

## 2. Protocol Overview

4–6 paragraphs. Comprehensive description:
- Mission, asset model, mechanics
- Operator roles (PROCESSOR_ROLE, COMPLIANCE_ROLE, etc.) — what they do
- Yield / withdrawal flow narrated step-by-step
- Key parameters (tolerance, vesting caps, oracle bounds, etc.)
- Deployment scope (chain, contract count, audit count)

## 3. Findings

H3 sub-section per material finding. **Each finding is 3–5 paragraphs**:
1. What was observed (with concrete evidence — addresses, role names, function signatures).
2. Why it matters (technical impact analysis: what an attacker / compromised party can do).
3. What context softens or sharpens it (related controls, asymmetries with other parts of the protocol).

### 3.1 <Headline of finding 1>
…
### 3.2 <Headline of finding 2>
…

Promote ALL deal-breaker FAILs and material non-deal-breaker risks (typically 4–7 findings total).

## 4. Deal Breaker Analysis

Categorical walk-through of all 23 deal-breaker items as markdown tables, grouped by sub-section. Header sentence summarizes the gate outcome.

### 4.1 Access Control & Governance
| Item | Status | Notes |
| --- | --- | --- |
| ... | ... | ... |

### 4.2 Oracle & Price Integrity
…

### 4.3 Smart Contract Architecture
…

### 4.4 Audit & Verification
…

### 4.5 Economic & Liquidity
…

### 4.6 Cross-Chain & Bridges
…

## 5. Trust & Permissions

Open with a markdown table of all trust surfaces (same shape as adminControlMatrix in metadata). Then a narrative section discussing the trust posture: where authority concentrates, what delays apply, where the better posture lives, and what would resolve the dominant trust risks.

## 6. Architecture Notes

H3 sub-sections, each 1–3 paragraphs, covering the major architectural patterns:

### 6.1 Upgrade pattern
### 6.2 Oracle integration
### 6.3 Reentrancy and locking
### 6.4 Reward and vesting mechanics  *(or other protocol-specific section)*
### 6.5 Aggravating factors beyond the deal breakers

The "aggravating factors" sub-section captures items not in the deal-breaker list but still material (admin rescue functions, blacklist redistribution, off-chain dependencies, etc.).

## 7. Open Issues

All issues from §5.1 of the raw, in narrative form, grouped by priority. State that priorities are addressed to the protocol team, not to readers.

### 7.1 P0 — immediate
1. **<Issue title>.** *<Severity>, <Category>.* Impact. Recommendation.
2. …

### 7.2 P1 — within 1 month
…

### 7.3 P2 — within 3 months
…

## 8. Audit History

Markdown table with firm, tier, and short note per audit, followed by 1 paragraph discussing what the engagement model implies (e.g. Certora typically does formal verification of specific properties; Code4rena is a contest model; etc.).

## 9. Contract Inventory

Markdown table of all in-scope contracts with full addresses, type, and compiler version. This is reference material; brief.

## 10. References

- Website — <url>
- Documentation — <url>
- Audit reports (PDFs) — link or reference dashboard
- Optional: link to the protocol dashboard for the structured filterable view

---

*Long-form companion to the dashboard. Descriptive technical analysis only — not financial advice.*
```

### Long-form mapping (raw report → long-form sections)

| Raw report content                          | Long-form section |
| ------------------------------------------- | ----------------- |
| Executive Summary table (without prescriptive verbs) | §1 Executive Summary |
| §2 Architectural Observations               | §2 Protocol Overview (most of it) |
| §6.1 Protocol Overview                      | §2 Protocol Overview (chain, type) + §10 References (URLs) |
| Executive Summary Key Findings + §1 FAILs   | §3 Findings (one H3 per material item) |
| §2 Risk Patterns Observed                   | §3 Findings (lower-priority items) + §6.5 Aggravating Factors |
| §1 Deal Breaker Analysis (all sub-tables)   | §4 Deal Breaker Analysis (tables, grouped) |
| §6.4 Multisig & Governance + §1.1 callouts  | §5 Trust & Permissions (table + narrative) |
| §2 Positive Security Patterns               | §6 Architecture Notes (split across sub-sections) |
| §5.1 Open Issues                            | §7 Open Issues (narrative, grouped by priority) |
| §6.3 Audit History                          | §8 Audit History (table + paragraph) |
| §6.2 Smart Contract Addresses               | §9 Contract Inventory (table) |
| §6.5 Data Sources / Website / Docs          | §10 References |
| §4.3 Conditions for Re-evaluation           | **DROP — not on the public site** |
| §5.2 Monitoring Plan, §5.3 Exit Triggers    | **DROP — not on the public site** |

### Voice & length

- **Length target:** ~2000–3500 words. Scale by complexity tier: Simple ~2000–2500, Moderate ~2500–3000, Complex ~3000–4000.
- Full sentences and paragraphs in §1, §2, §3, §5 narrative, §7. Markdown tables in §4, §5 (lead), §8, §9.
- Truncated addresses (`0x6101…6820`) for inline narrative references; full addresses in §9 and metadata.
- Code-style backticks for contract names, role identifiers, function signatures, and Solidity symbols (`USDat`, `DEFAULT_ADMIN_ROLE`, `_disableInitializers()`).
- No "Recommendation" or "Conclusion" section addressed to readers. The findings speak for themselves.
- Section numbering uses plain integers (1, 2, 3 — not §1, §1.1) for clean rendering.

---

## Output paths

```
src/content/reports/<protocolSlug>/
  ├── <slug>.md              ← long-form (Part B)
  └── <slug>.metadata.json   ← metadata (Part A)
```

Multiple reports per protocol are supported — the dashboard shows the latest by `auditDate` and lists older ones in the footer.

## Validation (do not skip)

```
npm test
```

`npm run build` is the secondary gate; if Astro's Zod fails, the metadata violates the schema.

## Common mistakes to avoid

- **Copying the raw report into `<slug>.md` verbatim.** The long-form is a fresh narrative; the framework's tables and prescriptive sections do not belong on the public site.
- **Reintroducing prescriptive language.** "REJECTED", "Do not invest", "Avoid", or position-size caps must not appear in metadata or long-form. Use descriptive equivalents.
- **Re-stating dashboard tables in the long-form.** No deal-breaker tables, contract inventory tables, or role tables — those live on the dashboard. The long-form is prose.
- **Conflating EOA label with the address.** Store the full 40-hex address in metadata `controller`; the `EOA` label goes in `controllerType`.
- **Treating §6.4 rows as 1:1 trust surfaces.** Collapse to the effective trust surface — what an abuse can do.
- **Writing metadata before reading the schema.** `src/content.config.ts` is the contract.
