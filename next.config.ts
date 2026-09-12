import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev-only overlay that sits on top of page content; it obscures the
  // bottom-left of every screen during development and in screenshots.
  devIndicators: false,
  poweredByHeader: false,
  typedRoutes: false,
  // Keep CI honest: a type error must fail the build, never be skipped.
  // Linting is a separate, required CI step (`npm run lint`).
  typescript: { ignoreBuildErrors: false },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ])
  },
}

export default nextConfig
