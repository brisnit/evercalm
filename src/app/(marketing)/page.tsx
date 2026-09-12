import Link from 'next/link'
import { Button, Card } from '@/ui/primitives'

const OUTCOMES = [
  {
    title: 'Everyone knows what is happening',
    body: 'Announcements reach the right locations and roles, and you can see who has read and acknowledged them.',
  },
  {
    title: 'Everyone knows what is expected',
    body: 'Pre-shift rituals, station side work, and role standards are configured per business, not hard-coded.',
  },
  {
    title: 'Everyone knows what they have completed',
    body: 'Training, practical sign-offs, and checklist history live in one record instead of four systems.',
  },
  {
    title: 'Everyone knows what comes next',
    body: 'The next shift, the training that is due, and the work waiting at the start of it.',
  },
]

export default function HomePage() {
  return (
    <>
      <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">
        <p className="text-xs font-semibold tracking-[0.11em] text-violet-700 uppercase">
          Employee operations for shift-based business
        </p>
        <h1 className="font-display text-ink mt-4 max-w-3xl text-4xl font-extrabold tracking-tight text-balance sm:text-6xl">
          Run the shift, not the spreadsheet
        </h1>
        <p className="text-muted mt-5 max-w-xl text-lg">
          EverCalm connects onboarding, training, scheduling, and daily operations so{' '}
          <span className="font-editorial text-ink italic">every person knows what comes next</span>
          .
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/contact">
            <Button size="lg">Book a demo</Button>
          </Link>
          <Link href="/pricing">
            <Button size="lg" variant="secondary">
              See pricing
            </Button>
          </Link>
        </div>
      </section>

      <section className="border-line bg-raise border-t">
        <div className="mx-auto w-full max-w-6xl px-5 py-16">
          <h2 className="font-display text-ink text-2xl font-extrabold tracking-tight sm:text-3xl">
            One connected record, four plain outcomes
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {OUTCOMES.map((o) => (
              <li key={o.title}>
                <Card className="h-full p-5">
                  <h3 className="font-display text-ink text-base font-bold">{o.title}</h3>
                  <p className="text-muted mt-2 text-sm">{o.body}</p>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <div className="rounded-panel bg-charcoal px-6 py-10 sm:px-10">
          <h2 className="font-display max-w-2xl text-2xl font-extrabold tracking-tight text-balance text-white sm:text-3xl">
            Built for restaurants first, designed for every shift-based business
          </h2>
          <p className="mt-3 max-w-xl text-sm text-white/70">
            Industry templates give a salon, a studio, or a retail floor its own vocabulary. Nothing
            in the platform assumes a dining room.
          </p>
          <div className="mt-7">
            <Link href="/contact">
              <Button size="lg">Talk to us about a pilot</Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
