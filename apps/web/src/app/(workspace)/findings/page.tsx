import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { FindingsView } from './findings-view';

export const metadata: Metadata = { title: 'Findings' };

export default function FindingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FindingsView />
    </Suspense>
  );
}
