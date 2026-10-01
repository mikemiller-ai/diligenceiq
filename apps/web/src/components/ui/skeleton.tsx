import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-sm bg-[linear-gradient(90deg,var(--secondary)_25%,var(--border)_50%,var(--secondary)_75%)] bg-[length:200%_100%] [animation:diq-shimmer_1.6s_ease-in-out_infinite]',
        className,
      )}
      {...props}
    />
  );
}
