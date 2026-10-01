import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { NewAnalysisView } from './new-analysis-view';

export const metadata: Metadata = { title: 'Deep Analysis' };

export default function NewAnalysisPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewAnalysisView />
    </Suspense>
  );
}
