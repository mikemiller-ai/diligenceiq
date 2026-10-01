import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type * as React from 'react';
import { Toaster } from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: { default: 'DiligenceIQ — Investment Intelligence', template: '%s · DiligenceIQ' },
  description: 'Turn SEC filings into evidence-backed investment decisions.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#0A0B13', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
