import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, Button, Card } from '@/ui/primitives'

export const metadata: Metadata = { title: 'Pricing' }

/**
 * Pricing is stated honestly as not-yet-set. Inventing tiers before the
 * product is priced would be a button that suggests something that does not
 * exist.
 */
export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-16">
      <Badge tone="violet">Pilot programme</Badge>
      <h1 className="font-display text-ink mt-4 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
        Pricing is set with our pilot partners
      </h1>
      <p className="text-muted mt-4 text-lg">
        EverCalm is in active development with a small number of independent operators. Rather than
        publish tiers we have not tested, we agree pricing directly with each pilot and hold it for
        the first year.
      </p>

      <Card className="mt-8 p-6">
        <h2 className="font-display text-ink text-lg font-bold">What a pilot includes</h2>
        <ul className="text-muted mt-4 flex flex-col gap-2.5 text-sm">
          <li>Workspace setup with your locations, roles, and stations</li>
          <li>Your policies, pre-shift rituals, and side work configured with you</li>
          <li>Direct access to the team building it</li>
          <li>Your data exported in full whenever you ask, including if you leave</li>
        </ul>
        <div className="mt-7">
          <Link href="/contact">
            <Button>Ask about a pilot</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}
