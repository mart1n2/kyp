---
title: "How to read a KYP dashboard"
date: 2026-05-08
tags: ["meta", "guide"]
description: "A short walkthrough of the dashboard's gate outcome, trust surfaces, and audit-tier badges — what to scan for in 30 seconds, and where to dig deeper."
---

# How to read a KYP dashboard

Each protocol on KYP has a **dashboard** at `/protocols/<slug>` and a **long-form analysis** at `/reports/<slug>/...`. The dashboard is for triage; the long-form is for reading. This note is a quick pass on the dashboard.

## The hero strip — 30-second scan

Four KPI tiles sit at the top: **Deal Breaker Gate**, **Score**, **Risk Level**, **Re-check Cadence**. The gate is the first signal:

- `PASS` — no deal-breaker conditions triggered
- `CONDITIONAL` — passed with material caveats
- `WATCHLIST` — open concerns that warrant monitoring
- `FAIL` — one or more deal breakers triggered
- `INCONCLUSIVE` — assessment incomplete

Below the tiles, a chip strip shows quick counts: deal-breaker FAILs, open issues (with a P0 sub-pill), EOA surfaces, contracts, audits (with a Tier-1 sub-pill).

## Trust Surfaces — who can move funds

The most important table on the page. Each row is a *power* on a contract that, if abused, affects user funds. Columns: surface, controller, controller type, minimum delay, worst case.

What to look for:
- `EOA` controllers with `Instant` delay — these are single-key trust surfaces. Compromise = instant fund loss.
- `Timelock` controllers — abuse requires waiting through the public delay window.
- `Multisig N/M` — multiple signers, but read carefully if the M is small relative to N.

## Audit Tiers

Tier 1 (Trail of Bits, OpenZeppelin, Certora, Spearbit, Sigma Prime, Cantina) typically does deep formal-verification or multi-week reviews. Tier 2 (Three Sigma, Halborn, Quantstamp, ChainSecurity, Code4rena contests) is standard manual review. Tier 3 covers smaller and independent firms. **Tier alone is not a verdict** — read the actual report.

## The long-form

The long-form analysis at `/reports/<slug>/...` is the comprehensive report — narrative findings with evidence, full deal-breaker matrix, trust matrix, contract inventory, audit history, and aggravating factors. Read it when you want depth on one protocol.

The dashboard is the index. The long-form is the document.
