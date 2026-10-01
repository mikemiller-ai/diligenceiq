import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Analysis stages mirror real worker steps (architecture §1); the UI only shows
 * the stage the API reports and never advances on a timer.
 */
export const ANALYSIS_STAGES = [
  { id: 'QUEUED', label: 'Queued' },
  { id: 'LOADING_INDEX', label: 'Loading filing index' },
  { id: 'RETRIEVING', label: 'Searching SEC filings' },
  { id: 'BALANCING', label: 'Balancing evidence across companies' },
  { id: 'BUILDING_CONTEXT', label: 'Preparing source context' },
  { id: 'GENERATING', label: 'Generating diligence brief' },
  { id: 'VALIDATING', label: 'Validating citations' },
] as const;

export type AnalysisStage = (typeof ANALYSIS_STAGES)[number]['id'];

export function StageTracker({ stage }: { stage: string }) {
  const current = Math.max(0, ANALYSIS_STAGES.findIndex((s) => s.id === stage));
  const label = ANALYSIS_STAGES[current]?.label ?? 'Working';
  return (
    <div className="rounded-card border border-border bg-card p-5 shadow-sm">
      <p aria-live="polite" className="text-base font-semibold text-foreground">
        {label}…
      </p>
      <ol className="mt-4 flex flex-col gap-2.5">
        {ANALYSIS_STAGES.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'pending';
          return (
            <li key={s.id} className="flex items-center gap-3 text-sm" aria-current={state === 'current' ? 'step' : undefined}>
              <span
                className={cn(
                  'grid size-6 place-items-center rounded-md border font-mono text-[11px]',
                  state === 'done' && 'border-ok/40 bg-ok/15 text-foreground',
                  state === 'current' && 'border-primary bg-brand-gradient text-white',
                  state === 'pending' && 'border-border text-muted-foreground',
                )}
              >
                {state === 'done' ? <Check aria-hidden className="size-3" /> : i + 1}
              </span>
              <span className={cn(state === 'pending' ? 'text-muted-foreground' : 'text-foreground', state === 'current' && 'font-medium')}>
                {s.label}
              </span>
              <span className="sr-only">{state === 'done' ? '(done)' : state === 'current' ? '(in progress)' : '(pending)'}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
