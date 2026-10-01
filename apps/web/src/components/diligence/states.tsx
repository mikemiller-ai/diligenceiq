'use client';

import { AlertTriangle, Check, Copy, Info, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center rounded-card border border-dashed border-border bg-card px-6 py-10 text-center', className)}>
      {Icon && (
        <span className="mb-3 grid size-10 place-items-center rounded-lg bg-accent text-primary">
          <Icon aria-hidden className="size-5" />
        </span>
      )}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function RequestId({ id }: { id: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      Request ID
      <code className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 ring-1 ring-inset ring-border">{id}</code>
      <button
        type="button"
        aria-label="Copy request ID"
        className="rounded-sm p-0.5 hover:bg-secondary hover:text-foreground"
        onClick={() => {
          void navigator.clipboard?.writeText(id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check aria-hidden className="size-3.5 text-ok" /> : <Copy aria-hidden className="size-3.5" />}
      </button>
    </span>
  );
}

/** Plain-language error with a request ID and a recovery action. Never a stack trace. */
export function ErrorPanel({
  title,
  message,
  requestId,
  code,
  action,
  className,
}: {
  title: string;
  message: React.ReactNode;
  requestId?: string;
  code?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('rounded-card border border-destructive/25 bg-card px-5 py-4 shadow-sm', className)}>
      <div className="flex gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
          <AlertTriangle aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-destructive">{title}</p>
          <div className="mt-1 text-sm text-foreground/80">{message}</div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {requestId && <RequestId id={requestId} />}
            {code && <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">{code}</span>}
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NoticeBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-sm text-foreground/80', className)}>
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <div>{children}</div>
    </div>
  );
}

export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick}>
      Try again
    </Button>
  );
}
