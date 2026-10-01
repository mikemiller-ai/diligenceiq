import { ScanSearch } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Product tile: the brand gradient with a glyph, as every sibling product does. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid size-8 shrink-0 place-items-center rounded-lg bg-brand-gradient text-white shadow-[0_4px_14px_-4px_rgb(43_72_202/0.6)]', className)}
    >
      <ScanSearch className="size-[18px]" strokeWidth={2.1} />
    </span>
  );
}

export function Wordmark({ inverted = false, className }: { inverted?: boolean; className?: string }) {
  return (
    <span className={cn('text-[15px] font-semibold tracking-tight', inverted ? 'text-white' : 'text-foreground', className)}>
      Diligence<span className={inverted ? 'text-on-navy-accent' : 'text-primary'}>IQ</span>
    </span>
  );
}
