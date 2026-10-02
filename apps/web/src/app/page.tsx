import {
  ArrowRight,
  Bookmark,
  Building2,
  Calculator,
  Cloud,
  Columns3,
  FileSearch,
  Gauge,
  Layers,
  ListChecks,
  MessageSquareText,
  Network,
  PlayCircle,
  Quote,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { EvidenceCard, Eyebrow, NavyAtmosphere, Section } from '@/components/evidence/section';
import { DESCRIPTIVE_LABELS } from '@/components/landing/descriptive-labels';
import { LaunchFilm } from '@/components/landing/launch-film';
import { RiskPreview, previewCompanyList } from '@/components/landing/risk-preview';
import { SEEDED_QUESTIONS } from '@/components/landing/seeded-questions';
import { BrandMark, Wordmark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { corpusStats } from '@/lib/corpus-stats';
import { formatCount } from '@/lib/format';
import { launchFilmAssets } from '@/lib/launch-film';
import { compareHref } from '@/lib/links';

/*
 * Product landing (SPEC §7), in the family layout of ResolveIQ, TrustResponse, ArchIQ and
 * CareerOps: navy hero, the launch film under it, then problem → how it works → shows its work
 * → two ways in → how it is built → closing CTA. Static: opening it never calls the api.
 * Copy is product description and must be true of the current build (only the preview companies
 * have profiles until Phase 4b). The only numbers are corpus counts derived from the filing rows,
 * the preview filing's fiscal year, the seeded questions and the citation labels (tested).
 */

/** The journey (SPEC §5.1), as the surfaces a user meets in order. */
const JOURNEY = [
  { step: 'Understand', surface: 'Company Intelligence', text: 'Pick a company and read what it faces in plain language, each point cited to its filing.', icon: Building2 },
  { step: 'Notice', surface: 'What’s changed', text: 'What changed between filings and why it can matter, as the offline profile build reaches each company.', icon: ShieldCheck },
  { step: 'Investigate', surface: 'Compare · Deep Analysis', text: 'Put companies side by side, or ask any question for a cited Diligence Brief.', icon: Columns3 },
  { step: 'Verify', surface: 'Evidence', text: 'Every claim opens the filing passage it came from.', icon: FileSearch },
  { step: 'Capture', surface: 'Findings', text: 'Save what matters, with its evidence, for the Investment Committee.', icon: Bookmark },
];

const PROBLEMS = [
  {
    title: 'Too much to read',
    text: 'Each company files an annual report and three quarterly reports a year, written for regulators rather than for a deal team.',
  },
  {
    title: 'Change hides between filings',
    text: 'A new risk, a reworded outlook or a segment that stopped growing only shows when one period sits beside the last.',
  },
  {
    title: 'Answers nobody can check',
    text: 'An answer without its source passage cannot go in front of an Investment Committee, however fluent it sounds.',
  },
];

const EVIDENCE = [
  { icon: Quote, title: 'Cited to the passage', text: 'Every claim opens the filing passage it came from. A citation to anything outside the supplied evidence is removed and flagged.' },
  { icon: Calculator, title: 'Figures checked against their source', text: 'Dollar and percentage figures in a brief are checked against the passages they cite, and any that can’t be matched are marked unverified.' },
  { icon: Gauge, title: 'Descriptive, never a rating', text: `Labels describe, never judge: ${DESCRIPTIVE_LABELS.join(', ')}. No scores, ratings or recommendations.` },
  { icon: Bookmark, title: 'Evidence that stays put', text: 'A saved finding keeps a copy of its cited passages, so it reads the same at the Investment Committee.' },
];

const BUILT = [
  { icon: Zap, title: 'One generation call per question', text: 'Query analysis, context building and validation are deterministic; retrieval embeds the question once; each analysis makes at most one generation request.' },
  { icon: Layers, title: 'Profiles built ahead of time', text: 'Company Intelligence is read from stored profile sets. Opening a page never calls a model.' },
  { icon: Cloud, title: 'Serverless, scale to zero', text: 'Amplify, Lambda, SQS, DynamoDB and S3 on AWS. No clusters and no always-on servers.' },
  { icon: ListChecks, title: 'Spend under control', text: 'A kill switch and caps per workspace and per day bound what the demo can spend.' },
];

export default function LandingPage() {
  const stats = corpusStats();
  const film = launchFilmAssets();

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      {/* The header sits over the navy hero; <main> starts with the hero's h1. */}
      <header className="absolute inset-x-0 top-0 z-10 text-white">
        <div className="mx-auto flex max-w-shell items-center justify-between gap-3 px-5 py-6 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="DiligenceIQ home">
            <BrandMark />
            <Wordmark inverted />
          </Link>
          <nav aria-label="Landing" className="flex items-center gap-1 sm:gap-2">
            {film && (
              <a href="#film" className="hidden rounded-lg px-3 py-2 text-sm text-white/70 hover:text-white sm:inline-block">
                Launch film
              </a>
            )}
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-sm text-white/70 hover:text-white sm:inline-block">
              Product
            </a>
            <Link
              href="/architecture/"
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3.5 py-2 text-sm text-white/80 hover:bg-white/5 hover:text-white"
            >
              <Network className="size-3.5" />
              <span>How it works</span>
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* HERO */}
        <section className="relative overflow-hidden bg-navy text-white" data-testid="landing-hero">
          <NavyAtmosphere />
          <div className="relative mx-auto max-w-shell px-5 pb-6 pt-16 sm:px-8">
            <div className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr]">
              <div>
                <Eyebrow onNavy>Investment intelligence for private equity</Eyebrow>
                <h1 className="mt-5 text-[40px] font-light leading-[1.06] tracking-tight text-balance sm:text-5xl lg:text-[3.3rem]">
                  Know what changed. <span className="text-gradient-hero">Know what matters.</span>{' '}
                  <span className="font-semibold">Know what to investigate next.</span>
                </h1>
                <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/70">
                  Turn SEC filings into evidence-backed investment decisions. Understand a company in seconds, notice what
                  changed, investigate with evidence, and prepare findings for the Investment Committee, without needing to
                  know where to look in a filing.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3.5">
                  <Button asChild variant="brand" size="lg">
                    <Link href="/intelligence/">
                      Open Company Intelligence <ArrowRight />
                    </Link>
                  </Button>
                  <Button asChild variant="ghost-dark" size="lg">
                    <Link href="/analysis/new/">Ask any question</Link>
                  </Button>
                  {film && (
                    <a href="#film" className="inline-flex items-center gap-2 text-sm text-white/70 underline-offset-4 hover:text-white hover:underline">
                      <PlayCircle className="size-4" /> Watch the launch film
                    </a>
                  )}
                  <Link href="/architecture/" className="text-sm text-white/70 underline-offset-4 hover:text-white hover:underline">
                    How it works
                  </Link>
                </div>
                <p className="mt-6 font-mono text-[11.5px] text-white/50">No account required · Public SEC filings · Every claim cited</p>
                <dl className="mt-7 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-5">
                  <HeroStat label="Filings" value={formatCount(stats.filings)} />
                  <HeroStat label="Companies" value={String(stats.companies)} />
                  <HeroStat label="Period ends" value={`${stats.firstPeriod.slice(0, 4)}–${stats.lastPeriod.slice(0, 4)}`} />
                </dl>
              </div>

              <RiskPreview />
            </div>
          </div>
        </section>

        {/* LAUNCH FILM: first after the hero, as on every sibling product */}
        <Section
          id="film"
          eyebrow="Launch film"
          headline="From a company’s filings to findings you can defend."
          lede="Pick a company, see what changed and why it matters, ask a question, check the evidence and save the finding, in the working product."
        >
          <LaunchFilm film={film} />
        </Section>

        {/* PROBLEM */}
        <Section
          ground="banded"
          eyebrow="The problem"
          headline="The answers are in the filings. Finding them takes days."
          lede="A deal team needs to know what is happening at a company, what changed and what deserves a closer look, before the Investment Committee asks."
        >
          <div className="grid gap-4 md:grid-cols-3">
            {PROBLEMS.map((p) => (
              <EvidenceCard key={p.title} title={p.title}>
                {p.text}
              </EvidenceCard>
            ))}
          </div>
        </Section>

        {/* HOW IT WORKS */}
        <Section
          id="how"
          eyebrow="How DiligenceIQ works"
          headline="Value before the first question, evidence behind every answer."
          lede="The product follows the way a diligence team works: understand, notice, investigate, verify, capture."
        >
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="How DiligenceIQ works">
            {JOURNEY.map((j, i) => (
              <li key={j.step} className="flex flex-col rounded-card border border-border bg-card p-4 shadow-sm">
                <span className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-primary">{String(i + 1).padStart(2, '0')}</span>
                  <span className="grid size-8 place-items-center rounded-lg bg-accent text-primary">
                    <j.icon aria-hidden className="size-4" />
                  </span>
                </span>
                <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{j.step}</h3>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{j.surface}</p>
                <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{j.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* SHOWS ITS WORK (analysis moment) */}
        <Section
          ground="navy"
          eyebrow="Shows its work"
          headline="Every conclusion carries its evidence."
          lede="Built so an analyst can check every line before it reaches the Investment Committee."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {EVIDENCE.map((e) => (
              <div key={e.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <span className="grid size-9 place-items-center rounded-lg bg-primary/30 text-[#c7d2fe]">
                  <e.icon aria-hidden className="size-4" />
                </span>
                <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-white">{e.title}</h3>
                <p className="mt-1.5 text-[13px] leading-snug text-white/65">{e.text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* TWO WAYS IN */}
        <Section
          eyebrow="Two ways in"
          headline="Start with a company, or start with a question."
          lede="Guided for anyone new to SEC filings, direct for the analyst who already knows what to ask."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
              <span className="grid size-10 place-items-center rounded-xl bg-accent text-primary">
                <Building2 aria-hidden className="size-5" />
              </span>
              <h3 className="mt-4 text-xl font-semibold tracking-tight">Company Intelligence</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">No question needed. Pick a company for a view built from its filings:</p>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {['Current risks, grouped in plain language and cited to the filing', 'What changed between filings, and why it can matter', 'What to investigate next, one click from a prefilled question'].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-[13px] leading-snug" data-testid="intelligence-status">
                <span className="font-semibold">Preview today:</span> {previewCompanyList()}, with every risk heading from the
                latest annual report cited. Full profiles for every company arrive with the offline profile build.
              </p>
              <p className="mt-3 text-[13px] text-muted-foreground">
                <Link href={compareHref()} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                  <Columns3 aria-hidden className="size-3.5" /> Compare
                </Link>{' '}
                puts companies side by side; today it works across the preview companies.
              </p>
              <div className="mt-auto pt-6">
                <Button asChild variant="brand">
                  <Link href="/intelligence/">
                    Open Company Intelligence <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
              <span className="grid size-10 place-items-center rounded-xl bg-accent text-primary">
                <MessageSquareText aria-hidden className="size-5" />
              </span>
              <h3 className="mt-4 text-xl font-semibold tracking-tight">Deep Analysis</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Ask anything across {stats.companies} companies and {formatCount(stats.filings)} filings, multi-company and
                multi-year, and get a cited Diligence Brief. Pre-run in every demo workspace:
              </p>
              <ul className="mt-3 flex flex-col gap-2" aria-label="Pre-run questions">
                {SEEDED_QUESTIONS.map((q) => (
                  <li key={q} data-seeded-question="" className="rounded-lg border border-border bg-secondary/60 px-3 py-2 text-[13px] leading-snug">
                    {q}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-6">
                <Button asChild variant="secondary">
                  <Link href="/analysis/new/">
                    Ask any question <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </Section>

        {/* HOW IT IS BUILT */}
        <Section
          ground="banded"
          eyebrow="How it is built"
          headline="One generation call per question. Nothing running when nobody is."
          lede="Retrieval-augmented generation over the filings, on a serverless AWS stack that idles at close to zero."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BUILT.map((b) => (
              <div key={b.title} className="rounded-card border border-border bg-card p-4 shadow-sm">
                <span className="grid size-8 place-items-center rounded-lg bg-accent text-primary">
                  <b.icon aria-hidden className="size-4" />
                </span>
                <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{b.title}</h3>
                <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{b.text}</p>
              </div>
            ))}
          </div>
          <Link href="/architecture/" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
            Architecture and business value <ArrowRight className="size-3.5" />
          </Link>
        </Section>

        {/* CLOSING CTA */}
        <section className="relative overflow-hidden bg-navy text-white">
          <NavyAtmosphere subtle />
          <div className="relative mx-auto flex max-w-shell flex-col items-center px-5 py-20 text-center sm:px-8">
            <Eyebrow onNavy>No account required</Eyebrow>
            <h2 className="mt-3 max-w-prose text-[30px] font-semibold leading-[36px] tracking-tight text-balance">
              Pick a company. See what matters.
            </h2>
            <p className="mt-2.5 max-w-xl text-md text-white/70">A demo workspace opens with pre-run briefs and saved findings to explore.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3.5">
              <Button asChild variant="brand" size="lg">
                <Link href="/intelligence/">
                  Open Company Intelligence <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="ghost-dark" size="lg">
                <Link href="/analysis/new/">Ask any question</Link>
              </Button>
            </div>
          </div>
        </section>

      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-2 px-5 py-5 text-xs text-muted-foreground sm:px-8">
          <span className="flex items-center gap-2">
            <BrandMark className="size-6 [&_svg]:size-3.5" />
            Source data: public SEC EDGAR filings. Not investment advice.
          </span>
          <span>
            Built by{' '}
            <a href="https://mikemiller.ai" className="font-medium text-foreground underline-offset-4 hover:underline">
              Mike Miller
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/50">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-medium tabular-nums text-white">{value}</dd>
    </div>
  );
}
