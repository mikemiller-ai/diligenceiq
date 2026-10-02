'use client';

import { Menu, MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EvidenceProvider } from '@/components/diligence/evidence';
import { cn } from '@/lib/utils';
import { WorkspaceProvider } from '@/lib/workspace-store';
import { BrandMark, Wordmark } from './brand';
import { Sidebar } from './sidebar';
import { WorkspaceBanner } from './workspace-banner';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <WorkspaceProvider>
        <EvidenceProvider>
          <ShellLayout>{children}</ShellLayout>
        </EvidenceProvider>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}

function ShellLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-card px-3 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <aside
        aria-label="Workspace navigation"
        className={cn(
          'no-print fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 ease-out md:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] border-none bg-rail p-0 text-rail-ink" hideClose>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Primary workspace navigation</SheetDescription>
          <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200 ease-out', collapsed ? 'md:pl-16' : 'md:pl-60')}>
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur-md md:px-8">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </Button>
          <Link href="/" className="flex items-center gap-2 md:hidden" aria-label="DiligenceIQ home">
            <BrandMark className="size-7" />
            <Wordmark />
          </Link>
          <p className="hidden font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:block">
            Know what changed · Know what matters · Know what to investigate next
          </p>
          <div className="ml-auto flex items-center gap-3">
            {/* Global primary action (SPEC §5.2): an empty Deep Analysis from any page. */}
            <Button asChild size="sm" variant="brand" className="shadow-none max-sm:size-8 max-sm:px-0">
              <Link href="/analysis/new/" aria-label="Ask a question">
                <MessageSquareText />
                <span className="max-sm:sr-only">Ask a question</span>
              </Link>
            </Button>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <WorkspaceBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
