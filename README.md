# Know Your Protocol (KYP)

> A public, technical reference for DeFi protocol permissions, trust assumptions, and audit findings.

[![Deploy to GitHub Pages](https://github.com/mart1n2/kyp/actions/workflows/deploy.yml/badge.svg)](https://github.com/mart1n2/kyp/actions/workflows/deploy.yml)
[![Astro](https://img.shields.io/badge/Astro-5-BC52EE?logo=astro&logoColor=white)](https://astro.build/)

**[Explore KYP](https://www.kyp.one)** · **[Research notes → mart1n.xyz](https://www.mart1n.xyz)**

## What KYP does

KYP turns DeFi security assessments into structured, searchable protocol profiles. It is designed for security engineers, researchers, fund analysts, and protocol contributors who need to understand not only whether a protocol was audited, but also who can change it and how quickly those powers can affect user funds.

Each profile brings together:

- **Security assessment** — score, grade, risk level, deal-breaker gate, and key findings
- **Trust surfaces** — upgrade authority, privileged roles, timelocks, multisigs, and worst-case impact
- **Contract inventory** — deployed addresses, contract types, compiler versions, and verification status
- **Open issues** — severity, impact, remediation priority, and expected timeline
- **Audit history** — prior reviews, scope, findings, and source reports

KYP is descriptive, not advisory. Every entry is a point-in-time technical assessment and should be read alongside its full report and primary sources.

Long-form writing — incident post-mortems, security research, and essays — lives separately at
**[mart1n.xyz](https://www.mart1n.xyz)** ([digital-garden](https://github.com/mart1n2/digital-garden)).
This repository is the protocol database only.

## How the site is organized

```text
src/
├── content/
│   └── reports/
│       └── <protocol>/
│           ├── <report>.md
│           └── <report>.metadata.json
├── components/               # Dashboard, report, navigation, and badge UI
├── pages/
│   ├── index.astro            # Filterable protocol database (was /protocols)
│   ├── protocols/[slug].astro # Protocol profile and assessment history
│   ├── reports/[...slug].astro
│   └── notes/                 # Redirect stubs → mart1n.xyz (see utils/moved-notes.ts)
├── styles/
└── utils/

schemas/report-metadata.json   # Public metadata contract
src/content.config.ts          # Runtime content validation
postbuild.mjs                  # Pagefind search-index generation
```

Reports use a paired-file model: the Markdown file contains the full assessment, while the adjacent metadata JSON powers the dashboard and protocol pages.

`src/pages/notes/` no longer holds content. It generates canonical + meta-refresh stubs for the note
URLs that existed before the split, mapped in `src/utils/moved-notes.ts`, so old links still land on
the right entry at mart1n.xyz.

## Add a report

1. Create `src/content/reports/<protocol-slug>/`.
2. Add the full report as `<report-slug>.md`.
3. Add `<report-slug>.metadata.json` beside it.
4. Run `npm test` and `npm run build`.
5. Open the generated pages locally with `npm run preview`.

Minimal metadata:

```json
{
  "slug": "protocol-ethereum-2026-07-17",
  "protocol": "Protocol Name",
  "protocolSlug": "protocol-name",
  "chain": "Ethereum",
  "auditDate": "07/17/2026",
  "securityScore": 72,
  "securityGrade": "B",
  "riskLevel": "Medium",
  "dealBreakers": "0 Failed — Gate cleared",
  "dealBreakerGate": "Conditional"
}
```

See [`schemas/report-metadata.json`](schemas/report-metadata.json) for the public schema and [`src/content.config.ts`](src/content.config.ts) for the fields enforced at build time.

## Local development

Requires Node.js 24 and npm.

```bash
npm ci
npm run dev
```

The development server starts at `http://localhost:4321`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Astro development server |
| `npm test` | Validate metadata and utility behavior with Vitest |
| `npm run build` | Build the static site and generate the Pagefind index |
| `npm run preview` | Preview the production build locally |

## Stack and deployment

- [Astro](https://astro.build/) for static generation and content collections
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Pagefind](https://pagefind.app/) for client-side full-text search
- GitHub Actions and GitHub Pages for deployment

Pushes to `main` run the Pages workflow and deploy the generated `dist/` directory to [www.kyp.one](https://www.kyp.one).

## Disclaimer

KYP provides technical audit findings and protocol metadata only. It does not constitute financial, investment, legal, or tax advice, and it does not endorse any protocol. Smart-contract systems change over time; assessments may be incomplete or outdated. Verify current on-chain state and use protocols at your own risk.
