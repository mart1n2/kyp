# Know Your Protocol (KYP)

> DeFi Protocol Permission Analysis & Audit Report Database

**🔗 [kyp.one](https://kyp.one)** | [Docs](https://github.com/mart1n2/kyp)

## What is KYP?

KYP is a static website that helps DeFi investors and protocol managers assess protocol risk before interacting with or investing in smart contracts. It displays:

- **Permission Dashboard** — Who controls what, and how (EOA vs Multisig vs Governance)
- **Risk Summary & Deal Breakers** — Critical security findings at a glance
- **Contract Inventory** — All protocol contracts with verification status
- **Full Audit Reports** — Searchable, organized audit reports by protocol

## Tech Stack

- **[Astro](https://astro.build/)** — Static site generation
- **[Pagefind](https://pagefind.app/)** — Client-side full-text search
- **[TailwindCSS](https://tailwindcss.com/)** — Styling
- **[GitHub Actions](https://github.com/features/actions)** — CI/CD deployment
- **GitHub Pages** — Hosting with custom domain `kyp.one`

## Project Structure

```
kyp/
├── src/
│   ├── content/
│   │   └── reports/           # Markdown reports organized by protocol folder
│   │       └── saturn-credit/
│   │           ├── saturn-ethereum-2026-04-15.md
│   │           └── saturn-ethereum-2026-04-15.metadata.json
│   ├── pages/
│   │   ├── index.astro        # Homepage — protocol list + filters + search
│   │   ├── protocols/[slug].astro  # Protocol permission dashboard
│   │   └── reports/[...slug].astro # Full audit report page
│   └── components/
│       ├── DealBreakerList.astro
│       ├── PermissionTable.astro
│       ├── ContractList.astro
│       └── ...
├── public/
│   ├── CNAME                  # Custom domain (kyp.one)
│   └── robots.txt
├── .github/workflows/
│   └── deploy.yml             # GitHub Pages auto-deploy
└── package.json
```

## Adding a New Report

1. Create a folder under `src/content/reports/` with the protocol slug (e.g., `src/content/reports/my-protocol/`)
2. Place the audit report markdown file inside
3. Generate the metadata JSON — ask an AI agent to extract structured metadata from the report and create `report-name.metadata.json`
4. Push to `main` branch — GitHub Actions will auto-deploy

## Metadata JSON Format

Each report needs a companion `.metadata.json` file:

```json
{
  "slug": "report-filename-without-ext",
  "protocol": "Protocol Name",
  "protocolSlug": "protocol-name",
  "chain": "Ethereum",
  "auditDate": "04/15/2026",
  "auditor": "Auditor Name",
  "securityScore": 0,
  "securityGrade": "F",
  "riskLevel": "Critical",
  "dealBreakers": "3 Failed — REJECT",
  "dealBreakerDetails": [ ... ],
  "accessControlRoles": [ ... ],
  "contracts": [ ... ],
  "keyFindings": [ ... ],
  "securityAssessment": "..."
}
```

## Local Development

```bash
npm install
npm run dev        # Start dev server at http://localhost:4321
npm run build      # Build static site + Pagefind index
npm run preview    # Preview built site
npm test           # Run metadata validation tests
```

## Disclaimer

> **For technical reference only. This does not constitute financial advice. Use at your own risk.**

## License

MIT
