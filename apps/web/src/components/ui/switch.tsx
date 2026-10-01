'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-sm border border-input bg-secondary p-0.5 transition-colors duration-150 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 rounded-[3px] bg-card shadow-sm ring-1 ring-border-strong transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:ring-primary" />
    </SwitchPrimitive.Root>
  );
}
