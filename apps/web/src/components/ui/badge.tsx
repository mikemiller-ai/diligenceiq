import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Status follows the Evidence rule: a status colour is a fill with ink text on it,
 * never the colour of a word. The dot carries the hue; the label stays ink.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-foreground/80 ring-1 ring-inset ring-border [&>[data-dot]]:bg-muted-foreground',
        accent: 'bg-accent text-primary [&>[data-dot]]:bg-primary',
        success: 'bg-ok/15 text-foreground [&>[data-dot]]:bg-ok',
        warning: 'bg-risk-med/20 text-foreground [&>[data-dot]]:bg-risk-med',
        danger: 'bg-destructive/10 text-foreground [&>[data-dot]]:bg-destructive',
        info: 'bg-accent text-foreground [&>[data-dot]]:bg-primary',
        outline: 'bg-card text-foreground/80 ring-1 ring-inset ring-border',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Status dot: takes its hue from the badge tone. */
export function StatusDot({ className }: { className?: string }) {
  return <span aria-hidden data-dot className={cn('inline-block size-1.5 rounded-full bg-current', className)} />;
}
