import { Bookmark, Building2, Columns3, FileSearch, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path prefixes that mark this item active. */
  match: string[];
}

/**
 * Primary navigation (SPEC §5.2, DD-15), in order. Thesis and Watchlist (P1) join after
 * Phase 8b builds them; until then they are omitted, with no stubs.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/intelligence/', label: 'Company Intelligence', icon: Building2, match: ['/intelligence'] },
  { href: '/compare/', label: 'Compare', icon: Columns3, match: ['/compare'] },
  { href: '/analysis/new/', label: 'Deep Analysis', icon: FileSearch, match: ['/analysis'] },
  { href: '/findings/', label: 'Findings', icon: Bookmark, match: ['/findings'] },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
