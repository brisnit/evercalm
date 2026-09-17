import type { Metadata } from 'next'
import { Card } from '@/ui/primitives'

export const metadata: Metadata = { title: 'Contact' }

/**
 * No form here yet. A form that silently discards submissions is worse than
 * an honest mailto - and a working form needs the email provider, which is
 * intentionally in development-safe mode until a sending domain is approved.
 */
export default function ContactPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <h1 className="font-display text-ink text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
        Talk to us
      </h1>
      <p className="text-muted mt-4 text-lg">
        We are onboarding pilot operators by hand, so the fastest route is a direct conversation.
      </p>

      <Card className="mt-8 p-6">
        <h2 className="font-display text-ink text-base font-bold">Email</h2>
        <p className="text-muted mt-2 text-sm">
          Tell us what kind of business you run, how many locations, and roughly how many people are
          on the schedule.
        </p>
        <p className="mt-4">
          <a
            href="mailto:hello@evercalm.example"
            className="font-medium text-teal-700 underline underline-offset-4 hover:text-teal-800"
          >
            hello@evercalm.example
          </a>
        </p>
        <p className="text-faint mt-4 text-xs">
          A contact form and scheduled demos arrive once our sending domain is verified.
        </p>
      </Card>
    </div>
  )
}
