import type { Metadata } from 'next'
import { Card } from '@/ui/primitives'

export const metadata: Metadata = { title: 'Security' }

/**
 * Only claims that are true of the code as it stands today. Anything not yet
 * built is listed as not yet built.
 */
const IN_PLACE = [
  {
    title: 'Tenant isolation in three independent layers',
    body: 'PostgreSQL Row-Level Security on every tenant table, a database role that cannot bypass it, and composite foreign keys that make a cross-tenant reference structurally impossible.',
  },
  {
    title: 'Authorization enforced on the server',
    body: 'Granular capabilities with organization and location scope. Hiding a control in the interface is a courtesy; the server check is the gate.',
  },
  {
    title: 'Append-only audit history',
    body: 'Sensitive actions are recorded in the same transaction as the action itself. The application role can read and append, but cannot update or delete.',
  },
  {
    title: 'Least-privilege database roles',
    body: 'The runtime role is not a superuser and cannot bypass Row-Level Security. Schema changes run as a separate privileged role that never serves a request.',
  },
  {
    title: 'No silent support access',
    body: 'There is no impersonation feature. When one is built it will require a written reason, a time limit, a visible banner, and a full audit trail.',
  },
]

const NOT_YET = [
  'Third-party penetration test',
  'SOC 2 or ISO 27001 certification',
  'Customer-managed encryption keys',
  'Single sign-on and SCIM provisioning',
]

export default function SecurityPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-16">
      <h1 className="font-display text-ink text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
        Security at EverCalm
      </h1>
      <p className="text-muted mt-4 text-lg">
        EverCalm holds employee records, so we would rather describe exactly what is in place than
        make broad assurances.
      </p>

      <h2 className="font-display text-ink mt-12 text-xl font-extrabold">In place today</h2>
      <ul className="mt-5 flex flex-col gap-3">
        {IN_PLACE.map((item) => (
          <li key={item.title}>
            <Card className="p-5">
              <h3 className="font-display text-ink text-base font-bold">{item.title}</h3>
              <p className="text-muted mt-1.5 text-sm">{item.body}</p>
            </Card>
          </li>
        ))}
      </ul>

      <h2 className="font-display text-ink mt-12 text-xl font-extrabold">Not yet in place</h2>
      <p className="text-muted mt-2 text-sm">
        We list these plainly rather than leaving them ambiguous.
      </p>
      <ul className="text-muted mt-4 flex list-disc flex-col gap-1.5 pl-5 text-sm">
        {NOT_YET.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <p className="border-line text-muted mt-12 border-t pt-6 text-sm">
        EverCalm organises HR workflows. It does not provide legal advice, and no workflow here
        should be taken as a guarantee of compliance with any jurisdiction&rsquo;s employment law.
      </p>
    </div>
  )
}
