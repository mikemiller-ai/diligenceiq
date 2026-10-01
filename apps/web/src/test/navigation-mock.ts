import { vi } from 'vitest';

/** Mutable navigation state shared by the next/navigation mock in vitest.setup.ts. */
export const nav = {
  pathname: '/intelligence/',
  search: '',
  push: vi.fn(),
};

export function setRoute(pathname: string, search = '') {
  nav.pathname = pathname;
  nav.search = search;
}
