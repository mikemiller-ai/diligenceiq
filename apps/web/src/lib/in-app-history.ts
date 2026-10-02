'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

/*
 * Whether this tab has shown another page of the app before the current one, so "Go back" returns
 * somewhere in the product (architecture §9.1, missing source document). `history.length` cannot
 * tell: a link opened in a new tab, or a browser that started on another site, has history that
 * leaves the app. The shell records each page (path) it renders; a full reload starts over.
 */

let firstPath: string | null = null;
let lastPath: string | null = null;
let distinctPaths = 0;

/**
 * Records a page view (the shell calls this through `useRecordPageViews`; tests call it directly).
 * A repeat of the same path (a re-run effect, a query change) is not a new page.
 */
export function recordPageView(pathname: string): void {
  if (pathname === lastPath) return;
  firstPath ??= pathname;
  lastPath = pathname;
  distinctPaths++;
}

/** True when an earlier, different page of the app was shown in this document. */
export function hasInAppHistory(pathname: string): boolean {
  return distinctPaths > 1 || (firstPath !== null && firstPath !== pathname);
}

/** Test-only reset. */
export function resetPageViews(): void {
  firstPath = null;
  lastPath = null;
  distinctPaths = 0;
}

/** Records every path the shell renders. */
export function useRecordPageViews(): void {
  const pathname = usePathname();
  React.useEffect(() => recordPageView(pathname), [pathname]);
}
