import Link from 'next/link'
import { Logo } from '@/ui/primitives'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-raise flex min-h-screen flex-col">
      <header className="px-5 py-5">
        <Link href="/" aria-label="EverCalm home">
          <Logo size="h-11" eager />
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-5 pt-6 pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
