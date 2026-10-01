import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { IntelligenceView } from './intelligence-view';

export const metadata: Metadata = { title: 'Company Intelligence' };

export default function IntelligencePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IntelligenceView />
    </Suspense>
  );
}
