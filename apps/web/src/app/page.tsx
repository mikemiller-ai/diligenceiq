import { ArrowRight, Bookmark, Building2, Columns3, FileSearch, Network, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Eyebrow, NavyAtmosphere } from '@/components/evidence/section';
import { BrandMark, Wordmark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { corpusStats } from '@/lib/corpus-stats';
import { formatCount } from '@/lib/format';

/** The journey (SPEC §5.1), as the surfaces a user meets in order. Product description, not data. */
const JOURNEY = [
  { step: 'Understand', surface: 'Company Intelligence', text: 'Pick a company and see how it is performing and what it faces.', icon: Building2 },
  { step: 'Notice', surface: 'What’s changed', text: 'Changes across filings and the signals worth attention, with why they matter.', icon: ShieldCheck },
  { step: 'Investigate', surface: 'Compare · Deep Analysis', text: 'Compare companies, or ask any question for a cited Diligence Brief.', icon: Columns3 },
  { step: 'Verify', surface: 'Evidence', text: 'Every claim opens the filing passage it came from.', icon: FileSearch },
  { step: 'Capture', surface: 'Findings', text: 'Save what matters, with its evidence, for the Investment Committee.', icon: Bookmark },
];

/** Compact landing (SPEC §7): the panel reaches the working product in one click. */
export default function LandingPage() {
  const stats = corpusStats();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <section className="relative flex-1 overflow-hidden bg-navy text-white">
        <NavyAtmosphere />
        <div className="relative mx-auto max-w-shell px-5 py-6 sm:px-8">
          <header className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5" aria-label="DiligenceIQ home">
              <BrandMark />
              <Wordmark inverted />
            </Link>
            <Link
              href="/architecture/"
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3.5 py-2 text-sm text-white/80 hover:bg-white/5 hover:text-white"
            >
              <Network className="size-3.5" />
              <span>How it works</span>
            </Link>
          </header>

          <div className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <Eyebrow onNavy>Investment Intelligence</Eyebrow>
              <h1 className="mt-5 text-[40px] font-light leading-[1.06] tracking-tight text-balance sm:text-5xl lg:text-[3.3rem]">
                Know what changed. <span className="text-gradient-hero">Know what matters.</span>{' '}
                <span className="font-semibold">Know what to investigate next.</span>
              </h1>
              <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/70">
                Turn SEC filings into evidence-backed investment decisions. Understand a company in seconds, notice what
                changed, investigate with evidence, and prepare findings for the Investment Committee, without needing to
                know where to look in a 10-K.
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
                <Link href="/architecture/" className="text-sm text-white/70 underline-offset-4 hover:text-white hover:underline">
                  How it works
                </Link>
              </div>
              <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-5">
                <HeroStat label="Filings" value={formatCount(stats.filings)} />
                <HeroStat label="Companies" value={String(stats.companies)} />
                <HeroStat label="Period ends" value={`${stats.firstPeriod.slice(0, 4)}–${stats.lastPeriod.slice(0, 4)}`} />
              </dl>
            </div>

            <ol className="flex flex-col gap-2.5" aria-label="How DiligenceIQ works">
              {JOURNEY.map((j, i) => (
                <li key={j.step} className="flex gap-3.5 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/30 text-[#c7d2fe]">
                    <j.icon aria-hidden className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11px] text-white/50">{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-[15px] font-semibold text-white">{j.step}</span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-on-navy-accent">{j.surface}</span>
                    </p>
                    <p className="mt-0.5 text-[13.5px] leading-snug text-white/65">{j.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-2 px-5 py-5 text-xs text-muted-foreground sm:px-8">
          <span className="flex items-center gap-2">
            <BrandMark className="size-6 [&_svg]:size-3.5" />
            Source data: public SEC EDGAR filings. No account required.
          </span>
          <span className="font-mono">DiligenceIQ · Investment intelligence</span>
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
