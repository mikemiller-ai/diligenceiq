'use client';

import { ChevronsLeft, ChevronsRight, Network, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { BrandMark, Wordmark } from './brand';
import { NAV_ITEMS, isActive } from './nav';
import { ResetWorkspaceDialog } from './reset-dialog';

const railItem =
  'relative flex h-9 items-center gap-3 rounded-md px-3 text-[13.5px] font-medium transition-colors duration-150';

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/';
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = isActive(item, pathname);
        const link = (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              railItem,
              active ? 'bg-white/[0.08] text-white' : 'text-rail-ink/80 hover:bg-white/[0.05] hover:text-white',
              collapsed && 'justify-center px-0',
            )}
          >
            {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-sm bg-brand-gradient" />}
            <item.icon aria-hidden className={cn('size-4 shrink-0', active && 'text-on-navy-accent')} />
            <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
          </Link>
        );
        return (
          <li key={item.href}>
            {collapsed ? (
              <Tooltip content={item.label} side="right">
                {link}
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** Called when a link is followed (the mobile drawer closes itself). */
  onNavigate?: () => void;
}) {
  const footerItem = cn(
    'flex h-8 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] text-rail-muted hover:bg-white/[0.05] hover:text-white',
    collapsed && 'justify-center px-0',
  );
  return (
    <div className="relative flex h-full flex-col overflow-hidden border-r border-navy-edge bg-rail text-rail-ink">
      {/* A faint sapphire glow at the top of the rail: the Evidence navy, quietly. */}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full bg-sapphire/25 blur-3xl" />

      <div className={cn('relative flex h-16 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md" aria-label="DiligenceIQ home">
          <BrandMark />
          {!collapsed && <Wordmark inverted />}
        </Link>
      </div>

      <nav aria-label="Primary" className={cn('relative flex-1 px-3', collapsed && 'px-2')}>
        {!collapsed && (
          <p className="mb-1.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-rail-muted">Investment intelligence</p>
        )}
        <SidebarNav collapsed={collapsed} {...(onNavigate ? { onNavigate } : {})} />
      </nav>

      <div className={cn('relative flex flex-col gap-0.5 border-t border-white/[0.07] p-3', collapsed && 'items-center px-2')}>
        <Link href="/architecture/" onClick={onNavigate} className={footerItem}>
          <Network aria-hidden className="size-4 shrink-0" />
          <span className={cn(collapsed && 'sr-only')}>Architecture &amp; value</span>
        </Link>
        <ResetWorkspaceDialog>
          <button type="button" className={footerItem}>
            <RotateCcw aria-hidden className="size-4 shrink-0" />
            <span className={cn('truncate', collapsed && 'sr-only')}>Reset workspace</span>
          </button>
        </ResetWorkspaceDialog>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          className={cn(footerItem, 'mt-1')}
        >
          {collapsed ? <ChevronsRight aria-hidden className="size-4" /> : <ChevronsLeft aria-hidden className="size-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );
}
