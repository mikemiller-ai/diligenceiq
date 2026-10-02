import { CircleDashed } from 'lucide-react';
import type * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Provenance labels (SPEC §8.6, §37): what produced a piece of dashboard content. */
export function PlaceholderBadge({ className }: { className?: string }) {
  return (
    <Badge tone="neutral" className={cn('border border-dashed border-muted-foreground/40 bg-transparent', className)}>
      Placeholder, not filing data
    </Badge>
  );
}

export function GeneralContextBadge() {
  return <Badge tone="info">General context</Badge>;
}

/** Text the offline profile call wrote (validated offline against the filings; SPEC §32.2). */
export function ModelWrittenBadge({ children = 'Model-written' }: { children?: React.ReactNode }) {
  return <Badge tone="outline">{children}</Badge>;
}

export function FilingTextBadge() {
  return <Badge tone="outline">Filing text</Badge>;
}

/**
 * A section slot with nothing built behind it yet. The copy says what will appear here;
 * it never states anything about the company.
 */
export function PlaceholderSlot({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-card border border-dashed border-muted-foreground/40 bg-card/60 px-4 py-3.5', className)}>
      <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <PlaceholderBadge />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
