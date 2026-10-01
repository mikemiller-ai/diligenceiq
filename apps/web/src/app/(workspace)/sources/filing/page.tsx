import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { FilingView } from './filing-view';

export const metadata: Metadata = { title: 'Filing' };

export default function FilingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FilingView />
    </Suspense>
  );
}
