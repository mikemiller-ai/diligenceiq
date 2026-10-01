import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { CompareView } from './compare-view';

export const metadata: Metadata = { title: 'Compare' };

export default function ComparePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CompareView />
    </Suspense>
  );
}
