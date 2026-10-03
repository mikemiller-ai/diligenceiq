import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    // `relative`: an absolutely positioned child (an sr-only header) is clipped by the scroll box, never widening the page.
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-secondary', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border transition-colors hover:bg-background', className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('h-9 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 align-middle text-foreground/80', className)} {...props} />;
}

export type SortDirection = 'asc' | 'desc';

/** Sortable column header: a real button inside the th, with aria-sort on the th. */
export function SortableTH({
  label,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onSort: () => void;
  className?: string;
}) {
  const Icon = !active ? ChevronsUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TH aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
      <button
        type="button"
        onClick={onSort}
        className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 uppercase tracking-wide hover:text-foreground"
      >
        {label}
        <Icon aria-hidden className={cn('size-3', !active && 'opacity-50')} />
      </button>
    </TH>
  );
}
