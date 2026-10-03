import type * as React from 'react';
import { cn } from '@/lib/utils';

const field =
  'w-full rounded-md border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'min-h-24 resize-y py-2', className)} {...props} />;
}

/** A native select; its chevron is the `select-chevron` utility (globals.css), drawn in a theme token. */
export function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        field,
        'h-9 appearance-none select-chevron pr-8',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}

export function FieldHint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...props} />;
}
