# DiligenceIQ — Design Tokens & UI Principles

Phase 0 baseline. Phase 1 implements these as CSS custom properties, the source of truth, and maps them into Tailwind v4 `@theme`. shadcn/ui components consume the semantic tokens, never raw hex values.

## Principles
- **Analyst research, not chat.** Briefs read like a sell-side or consulting research note: serif headings, tight metadata rows, tables, and citation chips. No chat bubbles, no sparkle icons, no gradients, no glassmorphism.
- **Restrained and dense.** Information-dense without clutter. Hierarchy comes from typography and spacing, not color.
- **One accent.** Muted teal marks interactive and primary elements. Status colors are reserved for status.
- **Evidence is first-class.** Citation chips, source metadata, and the evidence drawer get the most care.
- **Light theme only for v1.** Dark mode is deferred. Desktop-first density, responsive down to tablet and phone.

## Color (contrast computed in Phase 0, WCAG 2.1 relative luminance)

Ratios are computed against all three backgrounds a token can sit on: `--bg` `#FBFAF7`, `--surface` `#FFFFFF`, and `--surface-subtle` `#F1EFEA` (the darkest, so the binding constraint). Targets: ≥ 4.5 : 1 for text, ≥ 3 : 1 for non-text UI boundaries (WCAG 1.4.11).

| Token | Hex | Use | On `--bg` | On `--surface` | On `--surface-subtle` |
|---|---|---|---|---|---|
| `--bg` | `#FBFAF7` | App background (warm white) | — | — | — |
| `--surface` | `#FFFFFF` | Cards, tables, drawers | — | — | — |
| `--surface-subtle` | `#F1EFEA` | Table headers, zebra rows, inset panels | — | — | — |
| `--border` | `#E3E0D8` | Hairline borders (decorative only, no contrast requirement) | — | — | — |
| `--border-strong` | `#7D838C` | Input borders, non-text UI boundaries | 3.66 : 1 | 3.82 : 1 | 3.32 : 1 |
| `--ink` | `#0F1B2D` | Primary text, navigation background | 16.56 : 1 | — | 15.04 : 1 |
| `--ink-2` | `#334155` | Secondary text | 9.92 : 1 | — | 9.01 : 1 |
| `--muted` | `#5B6474` | Metadata, captions | 5.72 : 1 | — | 5.19 : 1 |
| `--accent` | `#0F766E` | Primary actions, links, focus ring | 5.24 : 1 | — | 4.76 : 1 |
| `--accent-hover` | `#115E59` | Hover/pressed | — | — | — |
| `--accent-subtle` | `#E6F2F0` | Selected rows, active nav item background | — | — | — |
| `--success` | `#166534` | Resolved, Complete | 6.83 : 1 | — | 6.21 : 1 |
| `--warning` | `#92400E` | Needs Follow-Up, In Progress, unverified figure | 6.79 : 1 | — | 6.17 : 1 |
| `--danger` | `#B91C1C` | Errors, invalid citation | 6.20 : 1 | — | 5.63 : 1 |
| `--info` | `#1E40AF` | Informational notes (coverage warnings) | 8.36 : 1 | — | 7.59 : 1 |

`--border-strong` was `#8A8F98` in the first draft: 3.11 : 1 on `--bg` but only 2.83 : 1 on `--surface-subtle`, which fails 3 : 1. `#7D838C` passes on all three backgrounds with one token. White text on `--accent` is 5.47 : 1. Text tokens on `--surface` (white) are always higher than on `--bg`, so that column is omitted for them.

Status badges use a tinted background (the status color at ~10% over `--surface`) with status-colored text. Text contrast is checked on the tinted background in Phase 1.

Left navigation: `--ink` background, with text `#E6E8EC` (14.09 : 1 on `--ink`). The active item uses a 2 px accent marker plus a lighter background.

## Typography
- **UI:** Inter (variable), with system UI as the fallback.
- **Brief and display headings:** Source Serif 4. Used only for brief titles, section headings, and the IC Brief.
- **Numerals:** `font-variant-numeric: tabular-nums` in tables and statistics.
- **Mono:** JetBrains Mono / ui-monospace for citation IDs and request IDs.

| Token | Size / line-height | Use |
|---|---|---|
| `--text-xs` | 12 / 16 | Badges, table metadata |
| `--text-sm` | 13 / 20 | Dense tables, secondary text |
| `--text-base` | 14 / 22 | Default UI text |
| `--text-md` | 16 / 24 | Brief body text |
| `--text-lg` | 18 / 26 | Card titles |
| `--text-xl` | 22 / 30 | Page titles |
| `--text-2xl` | 28 / 36 | Brief title (serif) |
| `--text-stat` | 32 / 36 | KPI numerals (tabular) |

## Spacing, radius, elevation
- **Spacing:** a 4 px base scale (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Page gutter is 32 px on desktop and 16 px on mobile.
- **Radius:** `--radius-sm` 4 px (badges, chips), `--radius` 6 px (inputs, buttons), `--radius-lg` 8 px (cards, drawers). Nothing pill-shaped except status dots.
- **Elevation:** borders by default. `--shadow-sm` is used only on drawers and popovers, as a subtle neutral shadow with no colored glow.
- **Layout:** fixed left navigation (240 px, collapsible to 64 px) and a content max-width of 1280 px. The brief body is constrained to ~760 px for readability, with the evidence drawer at 480 px on the right.

## Interaction & accessibility
- **Focus:** a visible 2 px `--accent` outline with a 2 px offset on every interactive element. Never removed.
- **Keyboard:** all controls are reachable. Drawers and dialogs trap focus and close on Esc (Radix primitives).
- **Semantic markup:** landmarks (`nav`, `main`, `aside`), real `<table>` elements for tabular data, and `aria-live="polite"` for analysis stage updates.
- **Motion:** 150–200 ms ease-out transitions only. `prefers-reduced-motion` is respected.
- **Loading:** skeletons for content, and real stage text for the analysis. No spinners lasting longer than the real work.
- **Error states:** plain-language messages with a request ID and a recovery action. No stack traces.

## Component inventory (Phase 1)
- App shell: left nav plus a top bar showing the engagement name and the "+ New Analysis" primary action.
- Buttons (primary, secondary, ghost, destructive)
- Inputs, textarea, select, multi-select (companies), checkbox, and segmented control
- Cards
- KPI stat tiles
- Progress bar
- Data table (sortable, compact)
- Badges (status, filing type, section)
- **Citation chip**
- Drawers (evidence)
- Dialogs
- Tabs
- Tooltip
- Toasts
- Skeletons
- Empty states
- Error panel with request ID
