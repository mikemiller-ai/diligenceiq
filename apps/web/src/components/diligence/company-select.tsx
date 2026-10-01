'use client';

import { ChevronsUpDown, X } from 'lucide-react';
import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { TickerBadge } from './badges';

export interface CompanyOption {
  ticker: string;
  company: string;
  filings: number;
}

/** Multi-select for companies; empty selection means all companies. */
export function CompanySelect({
  id,
  options,
  value,
  onChange,
  max = 10,
}: {
  id: string;
  options: CompanyOption[];
  value: string[];
  onChange: (tickers: string[]) => void;
  max?: number;
}) {
  const [query, setQuery] = React.useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.ticker.toLowerCase().includes(q) || o.company.toLowerCase().includes(q))
    : options;
  const toggle = (ticker: string) =>
    onChange(value.includes(ticker) ? value.filter((t) => t !== ticker) : value.length >= max ? value : [...value, ticker]);

  return (
    <div className="flex flex-col gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-card px-3 text-left text-base text-foreground"
          >
            <span className={cn(value.length === 0 && 'text-foreground/80')}>
              {value.length === 0 ? 'All companies' : `${value.length} selected`}
            </span>
            <ChevronsUpDown aria-hidden className="size-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
          <div className="border-b border-border p-2">
            <Input
              aria-label="Search companies"
              placeholder="Search by name or ticker"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto p-1" aria-label="Companies">
            {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No companies match.</li>}
            {filtered.map((o) => {
              const checked = value.includes(o.ticker);
              const disabled = !checked && value.length >= max;
              const cid = `${id}-${o.ticker}`;
              return (
                <li key={o.ticker}>
                  <label
                    htmlFor={cid}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-secondary',
                      disabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Checkbox id={cid} checked={checked} disabled={disabled} onCheckedChange={() => toggle(o.ticker)} />
                    <span className="w-12 font-mono text-xs font-semibold text-foreground/80">{o.ticker}</span>
                    <span className="flex-1 truncate text-foreground">{o.company}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{o.filings}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>Up to {max} companies</span>
            {value.length > 0 && (
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected companies">
          {value.map((t) => (
            <li key={t} className="inline-flex items-center gap-0.5">
              <TickerBadge ticker={t} />
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => toggle(t)}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

