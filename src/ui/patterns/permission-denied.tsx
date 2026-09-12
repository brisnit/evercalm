import Link from 'next/link'
import { Card } from '@/ui/primitives'

/**
 * Permission denied.
 *
 * States plainly what is missing and who can grant it, rather than a blank
 * 403. It never reveals whether the underlying record exists - cross-tenant
 * access surfaces as "not found" elsewhere, and this page is only reached
 * when the actor is legitimately inside the tenant but lacks a capability.
 */
export function PermissionDenied({
  capabilityLabel,
  description,
}: {
  capabilityLabel?: string
  description?: string
}) {
  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <h1 className="font-display text-ink text-xl font-extrabold">
        You do not have access to this
      </h1>
      <p className="text-muted mt-3 text-sm">
        {description ??
          (capabilityLabel
            ? `This page needs the “${capabilityLabel}” permission.`
            : 'This page needs a permission your roles do not include.')}
      </p>
      <p className="text-muted mt-2 text-sm">
        An owner can grant it from the organization&rsquo;s roles and permissions settings.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/app"
          className="text-sm font-medium text-violet-700 underline underline-offset-4 hover:text-violet-800"
        >
          Back to overview
        </Link>
        <Link
          href="/my"
          className="text-muted hover:text-ink text-sm font-medium underline underline-offset-4"
        >
          Go to my work
        </Link>
      </div>
    </Card>
  )
}
