'use client';

import { X } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetTitle = SheetPrimitive.Title;
export const SheetDescription = SheetPrimitive.Description;

/** Side drawer (Radix Dialog): traps focus, closes on Esc, restores focus on close. */
export function SheetContent({
  side = 'right',
  className,
  children,
  hideClose = false,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: 'left' | 'right'; hideClose?: boolean }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-navy/30" />
      <SheetPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-50 flex w-full flex-col bg-card shadow-sm',
          side === 'right' ? 'right-0 border-l border-border sm:max-w-[480px]' : 'left-0 border-r border-border sm:max-w-[280px]',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
