import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

// Editorial accent only - echoes the italic serif "Ever" in the wordmark.
// Marketing surfaces only, one phrase per page at most.
const fraunces = Fraunces({
  subsets: ['latin'],
  style: ['italic'],
  weight: ['400', '600'],
  variable: '--font-fraunces',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'EverCalm', template: '%s · EverCalm' },
  description:
    'Every person knows what is happening, what is expected, what they have completed, and what comes next.',
  robots: { index: false, follow: false }, // pre-launch
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#7C24F5',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${fraunces.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}
