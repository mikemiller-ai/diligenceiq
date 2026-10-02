import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The stages the worker actually writes (SPEC §38.1; architecture §4.1), in order. The UI shows
 * the stage the poll reports and never advances on a timer. Loading the filing index happens
 * only on a cold start, so it is marked as such rather than shown as a step every run takes.
 */
export const ANALYSIS_STAGES = [
  { id: 'queued', label: 'Waiting to start' },
  { id: 'claimed', label: 'Starting' },
  { id: 'loading_index', label: 'Loading filing index', note: 'only after idle' },
  { id: 'analyzing', label: 'Interpreting the question' },
  { id: 'retrieving', label: 'Searching SEC filings' },
  { id: 'balancing', label: 'Balancing evidence across companies and periods' },
  { id: 'context', label: 'Preparing source context' },
  { id: 'generating', label: 'Generating diligence brief' },
  { id: 'validating', label: 'Validating citations and figures' },
] as const;

export type AnalysisStage = (typeof ANALYSIS_STAGES)[number]['id'];

export function StageTracker({ stage }: { stage: string }) {
  const found = ANALYSIS_STAGES.findIndex((s) => s.id === stage);
  const current = Math.max(0, found);
  const label = ANALYSIS_STAGES[current]?.label ?? 'Working';
  return (
    <div className="rounded-card border border-border bg-card p-5 shadow-sm">
      <p aria-live="polite" className="text-base font-semibold text-foreground">
        {label}…
      </p>
      <p className="mt-1 text-xs text-muted-foreground">These are the steps the analysis service reports as it runs. Most of the time goes to the one model request.</p>
      <ol className="mt-4 flex flex-col gap-2.5">
        {ANALYSIS_STAGES.map((s, i) => {
          // A passed cold-start step may not have run at all (the index was already in memory), so it gets no check mark.
          const state = i < current ? (s.id === 'loading_index' ? 'passed' : 'done') : i === current ? 'current' : 'pending';
          return (
            <li key={s.id} className="flex items-center gap-3 text-sm" aria-current={state === 'current' ? 'step' : undefined}>
              <span
                className={cn(
                  'grid size-6 place-items-center rounded-md border font-mono text-[11px]',
                  state === 'done' && 'border-ok/40 bg-ok/15 text-foreground',
                  state === 'current' && 'border-primary bg-brand-gradient text-white',
                  (state === 'pending' || state === 'passed') && 'border-border text-muted-foreground',
                )}
              >
                {state === 'done' ? <Check aria-hidden className="size-3" /> : state === 'passed' ? '–' : i + 1}
              </span>
              <span className={cn(state === 'pending' || state === 'passed' ? 'text-muted-foreground' : 'text-foreground', state === 'current' && 'font-medium')}>
                {s.label}
                {'note' in s && <span className="ml-1.5 text-xs text-muted-foreground">({s.note})</span>}
              </span>
              <span className="sr-only">{state === 'done' ? '(done)' : state === 'passed' ? '(done or not needed)' : state === 'current' ? '(in progress)' : '(pending)'}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
