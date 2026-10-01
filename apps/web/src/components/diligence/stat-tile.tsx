import type * as React from 'react';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-card border border-border bg-card px-4 py-3.5 shadow-sm', className)}>
      <div aria-hidden className="bg-wash pointer-events-none absolute inset-0" />
      <dt className="relative font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="relative mt-2 text-stat font-semibold tabular-nums tracking-tight text-foreground">{value}</dd>
      {detail && <dd className="relative mt-1 text-xs text-muted-foreground">{detail}</dd>}
    </div>
  );
}
