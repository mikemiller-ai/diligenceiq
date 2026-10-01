import type * as React from 'react';
import { Eyebrow } from '@/components/evidence/section';
import { cn } from '@/lib/utils';

/** Page container: the 1152px Evidence shell; 32px gutter on desktop, 20px on mobile. */
export function PageContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('print-full mx-auto w-full max-w-shell px-5 py-7 sm:px-8 md:py-9', className)} {...props} />;
}

/** Eyebrow → headline → lede, the same grammar as every Evidence section. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-base text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Micro-label heading for page sections. */
export function SectionHeading({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <h2 id={id} className={cn('font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground', className)}>
      {children}
    </h2>
  );
}
