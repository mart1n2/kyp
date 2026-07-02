# Theme system (dark/light) + tag visibility — design

Date: 2026-07-02 · Status: approved direction (user chose "toggle + system default")

## Problem

1. The site is dark-only, with ~515 hardcoded Tailwind `slate-*`/status color
   classes across 21 files. Users want light mode.
2. Tags are gray-on-gray (`text-slate-500` on `bg-slate-900` ≈ 3:1) — hard to see.

## Approaches considered

- **A. `dark:` variants everywhere** — rewrite every color class light-first with
  a `dark:` twin. Doubles class noise, ~1000 edits, error-prone. Rejected.
- **B. Semantic tokens (chosen)** — CSS variables per theme on
  `html[data-theme]`, mapped into Tailwind as named colors
  (`rgb(var(--c-x) / <alpha-value>)`). Components say what a color *means*
  (`text-ink-3`, `bg-danger/10`), themes decide what it *is*. One edit per class
  instance, roughly same count as today, and future components are theme-proof.
- **C. CSS override hack** — `html.light .text-slate-400 { … }` overrides.
  Minimal diff but whack-a-mole with opacity variants (`/40`, `/60`) and leaves
  the codebase lying about its colors. Rejected.

## Token set

Neutral roles (per theme, RGB triplets for alpha composition):

| Token | Dark | Light |
|---|---|---|
| `page` | `#020617` | `#f4f7fb` |
| `surface` | `#0f172a` | `#ffffff` |
| `elevated` | `#1e293b` | `#ffffff` |
| `inset` | `#0b1120` | `#f1f5f9` |
| `ink` | `#f1f5f9` | `#0f172a` |
| `ink-2` | `#cbd5e1` | `#334155` |
| `ink-3` | `#94a3b8` | `#475569` |
| `ink-4` | `#64748b` | `#64748b` |
| `line` (rgba, alpha baked) | slate-400 @12% | slate-900 @10% |
| `line-2` | slate-400 @25% | slate-900 @16% |
| `accent` | `#60a5fa` | `#2563eb` |
| `accent-2` | `#93c5fd` | `#1d4ed8` |

Status roles (fg; chips are `bg-<status>/10..15 border-<status>/30..40`):

| Token | Dark | Light | Used for |
|---|---|---|---|
| `danger` | `#fca5a5` | `#b91c1c` | Fail, Critical, EOA chips |
| `hot` | `#fdba74` | `#9a3412` | High risk |
| `warn` | `#fde047` | `#854d0e` | Conditional, Medium, research |
| `ok` | `#86efac` | `#166534` | Pass, Low, Tier-1, verified |
| `info` | `#93c5fd` | `#1d4ed8` | Watchlist |

Validated with the dataviz palette validator + WCAG math: all status text ≥4.5:1
on its tinted chip in both themes (dark ≥6:1). Light `warn`↔`hot` are close for
deutan viewers — acceptable because status text is always a word, never color
alone. Dark values are today's exact hues, so dark mode stays pixel-familiar.

## Theme switching

- Inline `<script is:inline>` in `<head>` (pre-paint, no flash): reads
  `localStorage.theme`, else `prefers-color-scheme`, sets
  `document.documentElement.dataset.theme` + `color-scheme`.
- Sun/moon toggle button in the header nav; persists choice; while no explicit
  choice is stored, follows live system changes via `matchMedia` listener.
- `<meta name="theme-color">` ×2 with `media` attributes.
- Shiki: `themes: { light: 'github-light', dark: 'github-dark' }`,
  `defaultColor: false`; global CSS activates `--shiki-light/dark` per
  `[data-theme]` (both the MDX pipeline and `renderMarkdown` for reports).

## Tags

New `.kyp-tag` class in `global.css`, applied at all 5 render sites
(home note cards, notes index ×2, note detail, protocol related-notes):
accent-tinted chip — `bg-accent/10, text-accent-2, border-accent/25`,
12px medium, rounded-full. Contrast: 6.9:1 dark / 5.8:1 light. Tag *filters*
(clickable, notes index) get a hover/active state on the same chip.

## Conversion mapping (mechanical sweep)

- `text-white|slate-50|slate-100` → `text-ink`; `slate-200|300` → `text-ink-2`;
  `slate-400` → `text-ink-3`; `slate-500|600` → `text-ink-4`
- `bg-slate-950/X` → `bg-page/X`; `bg-slate-900/X` → `bg-surface/X`;
  `bg-slate-800/X` → `bg-inset/X` (wells/rows/inputs) or `bg-elevated` (chips)
- `bg-white/5`, `hover:bg-white/5` → `…-ink/5`; `border-white/5` → `border-line`
- `border-slate-800` → `border-line`; `border-slate-700(/60)` → `border-line-2`
- `text-blue-400` → `text-accent`; `text-blue-300|200` → `text-accent-2`
- Status colors per table above; `utils/badges.ts` is the single source for
  gate/risk/score/severity classes and converts wholesale.
- `global.css` component classes (`kyp-card/panel/inset/kpi/label`, ambient
  gradient, scrollbar, selection, note stripes) become var-driven with
  `[data-theme="light"]` overrides.

## Out of scope

Per-tag color coding; theming the OG images; redesigning layout/typography.

## Verification

Unit: none meaningful (CSS). Runtime: build + Playwright — screenshot
home/protocol/notes in both themes, toggle persistence across reload,
computed-style contrast spot checks.
