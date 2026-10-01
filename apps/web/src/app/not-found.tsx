import Link from 'next/link';
import { BrandMark, Wordmark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <BrandMark />
          <Wordmark />
        </div>
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">This page isn’t part of the workspace</h1>
        <p className="mt-2 text-base text-foreground/80">The link may be out of date. Pick a company in Company Intelligence, or start from the home page.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild>
            <Link href="/intelligence/">Open Company Intelligence</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
