# DiligenceIQ — Design Tokens & UI Principles

DiligenceIQ runs on the **Evidence** system shared by Mike's products (ResolveIQ, TrustResponse, CareerOps, ArchIQ), as defined in the private brand kit `mikemiller-ai/web-brand-kit` (`BRAND-ARCHITECTURE.md`, `LAYOUT.md`, `layout/section.tsx`). The kit's rule is *"One layout. Two type voices. One token of difference per product."* DiligenceIQ follows it. It shares the layout grammar, role names, navy ground and type, and it differs from its siblings in `--primary` (plus the gradient built on it) and its navy rail.

The tokens are CSS custom properties in `apps/web/src/app/globals.css` and are mapped into Tailwind v4 through `@theme inline`. Components use role names only and never name a hex value. Contrast and family rules are asserted against that file by `apps/web/src/lib/tokens.test.ts`.

> **Phase 1 revision (2026-10-01).** The Phase 0 draft (teal accent, warm off-white, Inter + Source Serif 4, "no gradients") broke the family rules: teal is reserved for status, and a third typeface is drift. Mike asked for the product to match the polish of his other products, with navy and gradients. This file replaces that draft.

## Principles
- **Analyst research, not chat.** Briefs read like a research note: tight metadata rows, tables, mono citation chips. There are no chat bubbles or sparkle-as-AI motifs.
- **The Evidence grammar.** Every section is eyebrow → headline → lede → content inside one of three grounds: default, banded, or navy. The grammar uses a 1152px shell, a 672px headline cap, and an 80px rhythm. The primitive is `components/evidence/section.tsx`, copied from the kit.
- **Navy for analysis moments.** The working body is light. Navy is reserved for the landing hero, the Company Intelligence header (company name and 30-second view), the Diligence Brief header with its executive summary, the IC Brief title band (P1), and the evidence drawer header. On navy, the shared atmosphere is two blurred orbs plus a masked 52px grid.
- **Accent as text in one place.** The mono eyebrow is the only place the brand colour appears as running text. Links and chips use `--primary` as an interactive colour.
- **Status is a fill, never a word.** A status colour is a tinted background with ink text on it and a coloured dot.
- **Evidence is first-class.** Citation chips are mono and labelled `§ AAPL FY2025 · 1A`, and the full chunk ID stays in the accessible name. Each chip opens the evidence drawer, which has a navy header, a "Validated — supplied to the model" pill, the quote in a `--secondary` panel, and mono metadata.
- **Light theme for v1.** Dark mode is deferred. When added, it is a real palette (the accent lightens and takes an ink label), not an inversion.

## Color

`--primary` is **Sapphire `#2B48CA`**, `hsl(229 65% 48%)`, the deepest blue in the family. Its CIE76 ΔE to the sibling accents:
- CareerOps `#1C54E3`: 8.2 (nearest)
- ResolveIQ `#5851E6`: 12.6
- mikemiller.ai `#4F46E5`: 17.2
- TrustResponse `#3A58F9`: 17.4

That puts it inside the kit's 8–15 band from the nearest sibling. The test reproduces the kit's own calibration figure of 7.2 for mikemiller.ai vs ResolveIQ.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--background` | `#F3F4F8` | App ground | — |
| `--card` / `--popover` | `#FFFFFF` | Cards, tables, drawers | — |
| `--secondary` | `#F6F6FA` | Table heads, quote panels, banded ground | — |
| `--muted` | `#F3F3F8` | Neutral fills | — |
| `--foreground` | `#14151F` | Primary text | 16.5 on bg, 18.2 on card |
| foreground at 80% | — | Secondary body text | ≥ 8.4 on every ground |
| `--muted-foreground` | `#5C6070` | Metadata, captions | ≥ 5.4 on every ground |
| `--primary` | `#2B48CA` | Buttons, links, chips, focus ring | 6.6 on bg, 7.3 on card; white label 7.3 |
| `--primary-hover` | `#213AAB` | Hover/pressed | white label 9.3 |
| `--accent` / `--accent-foreground` | `#EDF0FD` / `#2B48CA` | shadcn soft fill (ticker badges, icon tiles) | 6.4 |
| `--destructive` | `#D42531` | Errors, invalid citations (family red, `hsl(358 75% 48%)`) | 5.1 on card; white label 5.1 |
| `--border` | `#E6E7F0` | Decorative hairlines | — |
| `--input` | `#84899C` | Form-control boundaries | ≥ 3:1 on card (WCAG 1.4.11) |
| `--navy` | `#0A0B13` | Shared Evidence hero and analysis ground (never changes) | — |
| `--rail` | `#0A1124` | App sidebar | — |
| `--rail-ink` / `--rail-muted` | `#C3CBE0` / `#8C95AE` | Rail text | 11.6 / 6.3 on rail |
| `--on-navy-accent` | `#8BA1F9` | Eyebrows and links on navy | 8.0 on navy |
| `--ok`, `--risk-low/med/high/critical` | `#30A66D`, `#12A594`, `#E0A838`, `#F58129`, `#E5484D` | Status fills and dots (ResolveIQ scale) | ink on tint ≥ 14 |

**Gradients.**
- `--gradient-brand`: `135deg #2B48CA → #1E58F7`. It runs from Sapphire to the mikemiller.ai logo blue and is the family's only all-blue brand gradient. It is used on the brand tile, primary CTAs, the active-nav marker and the progress fill. White text is ≥ 5.5:1 at both ends.
- `--gradient-hero-text`: `90deg #9CB2FC → #B7A4FA`. It is used only for the emphasised hero phrase on navy.
- `--gradient-banner`: the closing band, derived from the identity `--mm-banner`.
- `--gradient-wash`: a faint 103° Sapphire wash on stat tiles and pinned findings.

## Typography
- **Geist** (sans) and **Geist Mono**, self-hosted via `@fontsource-variable/*`, with no network fetch at build time. These are the product voice in the kit.
- **Headings:** tracking −0.025em. Heroes are **light (300)** with a semibold second line (the ResolveIQ voice). Section and page heads are semibold. Weight 800 is not used.
- **Mono** is used for eyebrows (11.5px, uppercase, 0.18em), in-card micro-labels (11px, 0.14em), citation chips, IDs, figures and request IDs. Tables use `tabular-nums`.
- **Dense product scale:** 12 / 13 / 14 (base) / 15 / 17 / 20 / 26 px, plus `--text-stat` at 30px. Marketing ledes use 15–17px.

## Spacing, radius, elevation
- **Shell:** 1152px (`max-w-shell`); headlines are capped at 672px (`max-w-prose`). The gutter is 20px, rising to 32px from 640px. Marketing sections use 80px rhythm, or 64px when `tight`.
- **Radius:** `--radius` 0.85rem, the card radius. `md` = −2px, `sm` = −4px; `xl` is used for hero CTAs and `2xl` for navy analysis cards.
- **Elevation:** cards use `shadow-sm`. Navy analysis cards use a soft navy shadow. Primary CTAs use `--shadow-cta`, a Sapphire glow.

## Layout
- **App shell** (revised for DD-15): a navy rail (240px, collapsible to 64px) with the gradient brand tile, the "DiligenceIQ" wordmark (IQ in `--on-navy-accent`), a mono "Intelligence" group label over the primary nav (Company Intelligence, Compare, Deep Analysis, Findings; Thesis and Watchlist join in Phase 8b), a secondary group (Architecture), and active items with a 3px gradient marker. There is no engagement card. The top bar is translucent white with a mono company breadcrumb (`Company Intelligence / Apple · AAPL`) and a gradient **"Ask a question"** CTA that opens an empty Deep Analysis.
- **Provenance labels, not a permanent badge.** There is no global "Sample data" badge. Phase 1 fixture slots carry an inline "Placeholder, not filing data" label (muted, dashed border) and disappear once real profiles load. Seeded analyses and findings carry a small "Seeded from a real pipeline run" chip. Deterministic "why this matters" text carries a "General context" label (DD-16). The profile's `generation.mode` is shown in the dashboard footer.
- **Brief:** a navy header card holds the title, question, mono metadata, executive summary with on-navy chips, and resolved scope. It is followed by light key-finding, comparison, consideration and gap sections, and a sticky Sources panel.

## Interaction & accessibility
- **Focus:** a 2px `--ring` outline with a 2px offset on every interactive element.
- **Keyboard and dialogs:** drawers and dialogs trap focus and close on Esc (Radix).
- **Semantics:** landmarks, real tables, and `aria-live` for stage and filter updates.
- **Motion:** 150–200ms transitions; `prefers-reduced-motion` is respected.
- **Print:** navy bands fall back to white (`print-light`), and controls are hidden.
- **Errors:** plain-language messages with a request ID and a recovery action.

## Component inventory (Phase 1)
- App shell (navy rail and top bar) and the Evidence `Section`, `Eyebrow`, `EvidenceCard`, `MicroLabel` and `NavyAtmosphere`.
- Buttons: primary, brand (gradient), secondary, ghost, ghost-dark, destructive and link.
- Inputs, textarea, native select, company multi-select, checkbox, switch and segmented control.
- Cards, stat tiles, a progress bar (on light and on navy), a sortable data table and badges (status, ticker, filing type).
- Citation chips (light and on-navy variants) and the evidence drawer.
- Dialogs, tabs, tooltip, toasts, skeletons, empty states, an error panel with request ID, a notice bar and a stage tracker.
