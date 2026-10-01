'use client';

import { ToggleGroup } from 'radix-ui';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Single-select segmented control (Radix ToggleGroup); never deselects to empty. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      className={cn('inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className="inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[0_0_0_1px_var(--border)]"
        >
          {o.label}
          {o.count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
