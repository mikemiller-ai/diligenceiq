import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type * as React from 'react';
import { Toaster } from '@/components/ui/toaster';
import { THEME_SCRIPT } from '@/lib/theme-script';

export const metadata: Metadata = {
  title: { default: 'DiligenceIQ — Investment Intelligence', template: '%s · DiligenceIQ' },
  description: 'Turn SEC filings into evidence-backed investment decisions.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#0A0B13', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is stamped by THEME_SCRIPT before hydration, so React must not flag it.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies a stored Light/Dark choice before first paint (no flash). One string constant:
            the Phase 7 CSP must allow it by SHA-256 hash (lib/theme-script.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
