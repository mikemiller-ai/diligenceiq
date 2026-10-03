'use client';

import { Toaster as Sonner } from 'sonner';

export { toast } from 'sonner';

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border border-border bg-card text-foreground shadow-sm text-sm font-sans',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
        },
      }}
    />
  );
}
