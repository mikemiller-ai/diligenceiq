import { ArrowRight, Cloud, Database, MessageSquareText, Server } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EvidenceCard, Eyebrow, NavyAtmosphere, Section } from '@/components/evidence/section';
import { BrandMark, Wordmark } from '@/components/shell/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export const metadata: Metadata = { title: 'Architecture and business value' };

/*
 * Architecture and business value (SPEC §18). Static: it describes the design and shows no
 * metrics. Measured evaluation, latency and cost numbers arrive in Phase 7, each traceable to
 * docs/evaluation.md or telemetry. Every mechanism is stated as what it is: built and deployed,
 * built but not yet deployed (the Phase 5 api), or designed with the phase that builds it.
 */

/** What exists in this build vs what is designed (implementation plan phases). */
type BuildStatus = 'Built' | 'Built · not yet deployed' | `Designed · Phase ${string}`;

function StatusBadge({ status }: { status: BuildStatus }) {
  return <Badge tone={status === 'Built' ? 'success' : status === 'Built · not yet deployed' ? 'info' : 'neutral'}>{status}</Badge>;
}

/** What the product is for. The "This build" section says what exists today. */
const VALUE = [
  { title: 'Tells you what is happening', text: 'A company dashboard before any question: performance, current risks, and what to look at first.' },
  { title: 'Shows what changed', text: 'Filing-to-filing changes and attention signals, each with the passages for every period compared.' },
  { title: 'Explains why it matters', text: 'Plain-language context that educates without rating, scoring, or recommending.' },
  { title: 'Suggests what to investigate', text: 'Recommended questions open Deep Analysis prefilled; nothing runs until the analyst clicks Run.' },
  { title: 'Answers any question', text: 'Deep Analysis over every filing, multi-company and multi-year, as a cited Diligence Brief.' },
  { title: 'Proves every conclusion', text: 'Each claim opens its source passage; citations outside the supplied evidence are removed and flagged.' },
  { title: 'Keeps what the team learns', text: 'Findings carry a copy of their cited passages, ready for the Investment Committee.' },
  { title: 'Compares companies', text: 'Common, distinctive and diverging attention areas across two to five companies, composed without a model call.' },
];

/** The Deep Analysis worker path (architecture §4.1, §5). Built and deployed in Phases 3–4. */
const FLOW = [
  { step: 'Claim job', detail: 'Conditional QUEUED → RUNNING with a claim token; a redelivered message is acknowledged without work.' },
  { step: 'Analyze query', detail: 'Deterministic: companies, aliases, sectors, fiscal periods, filing types. No model call.' },
  { step: 'Retrieve', detail: 'Hybrid keyword and vector search over a pre-built index, with lanes so every company and period asked about is represented.' },
  { step: 'Build context', detail: 'Deduplicated passages with citation IDs inside a fixed budget, marked as untrusted filing text.' },
  { step: 'Generate', detail: 'Exactly one Bedrock request. The count is persisted before the call; SDK retries are off.' },
  { step: 'Validate', detail: 'Schema, citation IDs against the supplied passages, and figures against their cited text.' },
];

const SYSTEM: { icon: typeof Cloud; title: string; status: BuildStatus; lines: string[] }[] = [
  { icon: Cloud, title: 'Amplify Hosting', status: 'Built', lines: ['Static Next.js export', 'Same-origin /api rewrite', 'Opening a page never calls a model'] },
  {
    icon: Server,
    title: 'HTTP API → api Lambda',
    status: 'Built · not yet deployed',
    lines: ['Sessions, findings, stored profiles and Compare; no Bedrock permission', 'Checks the kill switch and the spend caps before it queues an analysis', 'The deployed api is still the earlier build'],
  },
  {
    icon: Database,
    title: 'SQS → worker Lambda',
    status: 'Built',
    lines: ['Hybrid retrieval over the S3 index', 'The one generation call per question', 'Validation, then idle'],
  },
];

/** What this build does, plainly. "Not yet deployed" is code that is built and tested but not live. */
const TODAY: { item: string; status: BuildStatus }[] = [
  {
    item: 'Company Intelligence preview profiles for Apple, Microsoft and NVIDIA: every risk heading the extraction rule found in the latest annual report, each cited to the index; everything else a labeled placeholder',
    status: 'Built',
  },
  { item: 'Ingestion, chunking and the hybrid keyword and vector index over every filing', status: 'Built' },
  { item: 'The analysis worker: retrieval, exactly one generation request, deterministic validation of citations and figures', status: 'Built' },
  { item: 'Kill switch on new analyses, and a CDK test that fails the build if an always-on resource appears', status: 'Built' },
  { item: 'Deep Analysis form with an editable prefill that never runs by itself; Run queues the analysis for the worker and the page shows its real stages', status: 'Built · not yet deployed' },
  { item: 'Demo workspaces without an account, seeded with real pre-run briefs; findings saved on the server with their cited passages', status: 'Built · not yet deployed' },
  { item: 'Spend caps: per workspace per hour, for the whole demo per day, and on new workspaces per network and per day', status: 'Built · not yet deployed' },
  { item: 'Profiles served from a stored set selected by one parameter; Compare composed from them without a model call', status: 'Built · not yet deployed' },
  { item: 'Offline profile build: deterministic and model-written sets, build ledger, set switch', status: 'Designed · Phase 4b' },
];

const FUTURE: { stage: string; scope: string; state: 'In progress' | 'Next' | 'Later' }[] = [
  { stage: 'Public company intelligence', scope: 'SEC filings · Company Intelligence · Compare · Deep Analysis · Findings', state: 'In progress' },
  { stage: 'Thesis, watchlist, IC brief', scope: 'Thesis tracking, historical filing and intelligence events, an IC Brief with print mode', state: 'Next' },
  { stage: 'Live monitoring', scope: 'New filings detected, indexed and compared; watch matches become alerts', state: 'Later' },
  { stage: 'Deal room intelligence', scope: 'CIMs, quality-of-earnings reports, financial models, contracts, management presentations', state: 'Later' },
  { stage: 'Investment Committee workflow', scope: 'Collaboration, approvals, memo workflows, diligence ownership', state: 'Later' },
  { stage: 'Portfolio intelligence', scope: 'KPI monitoring, new-filing alerts, covenant risk, operating signals, benchmarking', state: 'Later' },
];

export default function ArchitecturePage() {
  return (
    <div className="min-h-dvh bg-background">
      <section className="relative overflow-hidden bg-navy text-white">
        <NavyAtmosphere />
        <div className="relative mx-auto max-w-shell px-5 py-6 sm:px-8">
          <header className="flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2.5" aria-label="DiligenceIQ home">
              <BrandMark />
              <Wordmark inverted />
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost-dark" size="sm">
                <Link href="/intelligence/">
                  Open Company Intelligence <ArrowRight />
                </Link>
              </Button>
              {/* Global primary action (SPEC §5.2): an empty Deep Analysis from every page. */}
              <Button asChild variant="brand" size="sm">
                <Link href="/analysis/new/" aria-label="Ask a question">
                  <MessageSquareText />
                  <span className="max-sm:sr-only">Ask a question</span>
                </Link>
              </Button>
              <ThemeToggle onNavy />
            </div>
          </header>
          <div className="max-w-3xl py-16 sm:py-20">
            <Eyebrow onNavy>Architecture and business value</Eyebrow>
            <h1 className="mt-5 text-[38px] font-light leading-[1.06] tracking-tight text-balance sm:text-5xl">
              General AI answers questions. <span className="text-gradient-hero">DiligenceIQ structures</span>{' '}
              <span className="font-semibold">the diligence before them.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/70">
              Investors get value before they know what to ask: what is happening, what changed, what deserves attention,
              and why. When they need to go deeper, any question becomes a cited brief written by exactly one model call.
              This page describes the design; each part not built yet is marked with the phase that builds it.
            </p>
          </div>
        </div>
      </section>

      <Section
        eyebrow="Business value"
        headline="How this creates value for a private-equity deal team."
        lede="It knows how to structure the diligence process, so associates spend their time on judgment rather than on finding the right page of a 10-K."
      >
        <ul className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE.map((v) => (
            <li key={v.title} className="rounded-card border border-border bg-card p-4 shadow-sm">
              <h3 className="text-[15px] font-semibold tracking-tight">{v.title}</h3>
              <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{v.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        ground="banded"
        eyebrow="Two planes"
        headline="Questions run live. Company profiles are built offline."
        lede="Everything a user opens is read from storage. Only an explicit Run analysis will reach a model."
      >
        <div className="grid gap-3.5 md:grid-cols-2">
          <EvidenceCard label="LIVE · BUILT, PHASES 3–5" title="One generative call per question">
            Deep Analysis is retrieval, then exactly one generation request, then validation, in a worker that runs only
            when an analysis is queued. Every run, including a re-run after a failure, is a new analysis with its own
            single call. The api that queues analyses, checks the kill switch and the spend caps, and keeps findings is
            built and tested but not yet deployed. Compare, Save Finding and the Findings Board are deterministic
            application logic.
          </EvidenceCard>
          <EvidenceCard label="OFFLINE · DESIGNED, PHASE 4B" title="Profiles computed once per index version">
            Company Intelligence profiles will be built by an admin-run script after indexing: deterministic figures, risks
            and change signals, plus at most one model call per company per index and prompt version, enforced by a build
            ledger and a required call budget. The builder is never deployed and never scheduled, and pages only read the
            stored result. This build shows preview profiles assembled from filing text with no model call.
          </EvidenceCard>
        </div>
        <div className="mt-3.5 rounded-card border border-primary/25 bg-primary/5 p-4 text-sm leading-relaxed text-foreground/85">
          <p className="font-semibold text-foreground">The one cost exception, stated plainly</p>
          <p className="mt-1">
            The offline profile build is the only place a model call is not a direct response to a user’s question. It was
            chosen deliberately, it is bounded as described above, and it can be withdrawn at any time: the design always
            builds a zero-call deterministic profile set alongside it, and one parameter switches the product to that set
            instantly, with no rebuild or deploy.
          </p>
        </div>
      </Section>

      <Section
        ground="navy"
        eyebrow="Single-call guarantee · built, Phase 4"
        headline="Six steps. One of them talks to a model."
        lede="Defense in depth: a conditional claim, an SDK client with retries off, a per-analysis gateway that refuses a second call, a persisted call count, and tests that assert exactly one call on success, error, malformed output and redelivery."
      >
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map((f, i) => {
            const generate = f.step === 'Generate';
            return (
              <li
                key={f.step}
                className={generate ? 'rounded-xl border border-sapphire/50 bg-sapphire/20 p-4 shadow-cta' : 'rounded-xl border border-white/10 bg-white/[0.03] p-4'}
              >
                <span
                  className={`grid size-7 place-items-center rounded-md font-mono text-[11px] ${generate ? 'bg-brand-gradient text-white' : 'bg-sapphire/30 text-on-navy-ink'}`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="mt-3 text-[15px] font-semibold text-white">{f.step}</p>
                <p className="mt-1 text-[13px] leading-snug text-white/65">{f.detail}</p>
                {generate && (
                  <p className="mt-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-on-navy-accent">The one model call</p>
                )}
              </li>
            );
          })}
        </ol>
      </Section>

      <Section
        eyebrow="System"
        headline="Serverless tiers that scale to near zero when idle."
        lede="State lives in on-demand DynamoDB; the corpus, the pre-built index and the profile sets live in S3. Every stack is CDK TypeScript."
      >
        <ol className="grid gap-3.5 md:grid-cols-3">
          {SYSTEM.map((s, i) => (
            <li key={s.title} className="rounded-card border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-primary">{String(i + 1).padStart(2, '0')}</span>
                <span className="grid size-8 place-items-center rounded-lg bg-accent text-primary">
                  <s.icon aria-hidden className="size-4" />
                </span>
              </div>
              <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{s.title}</h3>
              <div className="mt-1.5">
                <StatusBadge status={s.status} />
              </div>
              <ul className="mt-1.5 space-y-1 text-[13px] text-muted-foreground">
                {s.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <div className="mt-3.5 grid gap-3.5 md:grid-cols-2">
          <EvidenceCard label="IDLE" title="Storage only">
            No search cluster, NAT gateway, servers, containers, relational database, firewall, provisioned concurrency or
            scheduled jobs. A CDK test fails the build if one appears.
          </EvidenceCard>
          <EvidenceCard label="IN USE" title="Proportional to questions asked">
            By design the single generation request dominates the cost of an analysis. Spend is bounded by a kill switch
            (built), a global daily cap, per-workspace caps and a cap on new workspaces (built, not yet deployed), and an
            AWS Budget alert (Phase 8).
          </EvidenceCard>
        </div>
      </Section>

      <Section
        tight
        eyebrow="This build"
        headline="What exists today, and what is designed."
        lede="Built means it runs in this deployment. Built, not yet deployed means the code exists and is tested but is not live yet. Designed means a later phase builds it."
      >
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card shadow-sm">
          {TODAY.map((t) => (
            <li key={t.item} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="text-foreground/85">{t.item}</span>
              <span className="shrink-0">
                <StatusBadge status={t.status} />
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        ground="banded"
        tight
        eyebrow="Evaluation"
        headline="Measured, not claimed."
        lede="Retrieval quality, citation validity, latency and cost per analysis are measured by an evaluation harness. Results are published here once they are measured; this page shows no estimated or illustrative numbers."
      />

      <Section
        tight
        eyebrow="Future state"
        headline="From public filings to the whole deal."
        lede="What is being built now, what comes next, and the longer-term direction. Nothing marked next or later exists yet."
      >
        <div className="overflow-hidden rounded-card border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr>
                {['Stage', 'Scope', 'Status'].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FUTURE.map((f) => (
                <tr key={f.stage} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground">{f.stage}</td>
                  <td className="px-4 py-3 text-foreground/80">{f.scope}</td>
                  <td className="px-4 py-3">
                    <Badge tone={f.state === 'In progress' ? 'info' : f.state === 'Next' ? 'warning' : 'neutral'}>{f.state}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Scenario questions, such as which areas look most exposed if demand weakens, are future state. DiligenceIQ does not
          produce price targets or financial forecasts.
        </p>
      </Section>
    </div>
  );
}
