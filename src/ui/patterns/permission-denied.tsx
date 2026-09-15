import Link from 'next/link'
import { Card, TextLink } from '@/ui/primitives'

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
        An owner can give you access from your profile under People, in the Access tab.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <TextLink href="/app" className="text-sm">
          Back to overview
        </TextLink>
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
