import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from './page';

export function PageSkeleton() {
  return (
    <PageContainer aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-7 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-[520px] max-w-full" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-6 h-64" />
    </PageContainer>
  );
}
