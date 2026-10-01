import { cn } from '@/lib/utils';

export function Progress({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-sm bg-secondary', className)}
    >
      <div className="h-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${v}%` }} />
    </div>
  );
}
