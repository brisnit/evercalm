import Link from 'next/link'
import { Logo } from '@/ui/primitives'
import { buttonClasses } from '@/ui/primitives/button'

export default function NotFound() {
  return (
    <main
      id="main"
      className="bg-canvas flex min-h-screen flex-col items-center justify-center px-5 py-12"
    >
      <Link href="/" aria-label="EverCalm home">
        <Logo size="h-10" eager />
      </Link>
      <div className="rounded-card border-line mt-8 w-full max-w-md border bg-white p-8 text-center">
        <h1 className="font-display text-ink text-xl font-extrabold">We couldn’t find that page</h1>
        <p className="text-muted mt-3 text-sm">
          The address may be mistyped, or the page may have moved.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/signin" className={buttonClasses('primary')}>
            Sign in
          </Link>
          <Link href="/" className={buttonClasses('secondary')}>
            EverCalm home
          </Link>
        </div>
      </div>
    </main>
  )
}
