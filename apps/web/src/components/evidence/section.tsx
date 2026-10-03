/*
 * The Evidence page grammar (mikemiller-ai/web-brand-kit, layout/section.tsx):
 * eyebrow → headline → lede → content, inside one of three grounds. Using this
 * instead of hand-written classes keeps the 1152px / 672px / 80px rhythm from drifting.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Ground = 'default' | 'banded' | 'navy';

const GROUND: Record<Ground, string> = {
  default: '',
  banded: 'border-y border-border bg-secondary/60',
  navy: 'relative overflow-hidden bg-navy text-white',
};

const SHELL = 'mx-auto max-w-shell px-5 sm:px-8';

/** The only place the brand colour appears as text on marketing pages. */
export function Eyebrow({ children, onNavy = false, className }: { children: ReactNode; onNavy?: boolean; className?: string }) {
  return (
    <p
      className={cn(
        'font-mono text-[11.5px] font-semibold uppercase tracking-[0.18em]',
        onNavy ? 'text-on-navy-accent' : 'text-primary',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Section({
  ground = 'default',
  eyebrow,
  headline,
  lede,
  tight = false,
  id,
  children,
}: {
  ground?: Ground;
  eyebrow?: string;
  headline?: ReactNode;
  lede?: ReactNode;
  tight?: boolean;
  id?: string;
  children?: ReactNode;
}) {
  const pad = tight ? 'py-16' : 'py-20';
  const navy = ground === 'navy';
  const body = (
    <>
      {eyebrow && <Eyebrow onNavy={navy}>{eyebrow}</Eyebrow>}
      {headline && (
        <h2 className={cn('mt-3 max-w-prose text-[30px] font-semibold leading-[36px] tracking-tight text-balance', !navy && 'text-foreground')}>
          {headline}
        </h2>
      )}
      {lede && <p className={cn('mt-2.5 max-w-xl text-md', navy ? 'text-white/70' : 'text-muted-foreground')}>{lede}</p>}
      {children && <div className="mt-9">{children}</div>}
    </>
  );
  if (ground === 'default') {
    return (
      <section id={id} className={`${SHELL} ${pad}`}>
        {body}
      </section>
    );
  }
  return (
    <section id={id} className={GROUND[ground]}>
      {navy && <NavyAtmosphere />}
      <div className={`relative ${SHELL} ${pad}`}>{body}</div>
    </section>
  );
}

/** Card as used inside a Section grid. */
export function EvidenceCard({
  label,
  title,
  children,
  className,
}: {
  label?: string;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-card border border-border bg-card p-4 shadow-sm', className)}>
      {label && <span className="font-mono text-xs font-semibold text-primary">{label}</span>}
      {title && <h3 className="mt-3 text-[15px] font-semibold leading-tight tracking-tight text-foreground">{title}</h3>}
      {children && <div className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{children}</div>}
    </div>
  );
}

/** In-card micro-label: looser than the eyebrow because it is smaller and quieter. */
export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground', className)}>{children}</p>;
}

/**
 * The navy-ground atmosphere shared across the family: two blurred brand orbs and a
 * masked 52px grid. DiligenceIQ's orbs are sapphire and logo blue.
 */
export function NavyAtmosphere({ subtle = false }: { subtle?: boolean }) {
  return (
    <>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -left-40 -top-40 size-[36rem] rounded-full blur-3xl',
          subtle ? 'bg-sapphire/20' : 'bg-sapphire/30',
        )}
      />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-32 top-10 size-[30rem] rounded-full blur-3xl',
          subtle ? 'bg-logo-blue/10' : 'bg-logo-blue/[0.18]',
        )}
      />
      <div aria-hidden className="bg-evidence-grid pointer-events-none absolute inset-0 opacity-[0.05]" />
    </>
  );
}
