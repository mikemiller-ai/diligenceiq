import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { AnalysisView } from './analysis-view';

export const metadata: Metadata = { title: 'Diligence Brief' };

export default function AnalysisPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AnalysisView />
    </Suspense>
  );
}
