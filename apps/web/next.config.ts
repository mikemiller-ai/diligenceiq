import type { NextConfig } from 'next';

// Static export for Amplify Hosting (DD-02). Detail views use query parameters,
// and `/api/<*>` is proxied to the HTTP API by an Amplify rewrite, so the app
// never needs a Next.js server.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@diligenceiq/core'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
