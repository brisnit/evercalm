import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'
import { SignInForm } from './sign-in-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage() {
  if (await getSessionUser()) redirect('/app')
  return (
    <>
      <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight">Sign in</h1>
      <p className="text-muted mt-1.5 text-sm">Welcome back.</p>
      <div className="mt-6">
        <SignInForm />
      </div>
    </>
  )
}
