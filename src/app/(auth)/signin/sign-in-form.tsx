'use client'

import { useState } from 'react'
import { signIn } from '@/lib/auth-client'
import { signInErrorMessage } from '@/lib/auth-messages'
import { Button, Card, Field, Input } from '@/ui/primitives'

/**
 * Sign-in form.
 *
 * The failure message is deliberately identical for an unknown email and a
 * wrong password: distinguishing them turns the form into an account
 * enumeration oracle.
 */
export function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await signIn.email({ email, password })
      if (result.error) {
        setError(signInErrorMessage(result.error.status))
        return
      }
      // A full page load, so nothing a previous person saw on this device is
      // kept in the browser's page cache.
      window.location.assign('/app')
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            data-testid="signin-error"
            className="rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-2.5 text-sm font-medium"
          >
            {error}
          </p>
        ) : null}

        <Field id="email" label="Email" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>

        <Field id="password" label="Password" required>
          {(props) => (
            <Input
              {...props}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>

        <Button type="submit" loading={submitting} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </Card>
  )
}
