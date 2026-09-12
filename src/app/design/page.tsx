import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/ui/primitives'
import { Field, Input } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'

export const metadata: Metadata = { title: 'Design system' }

/**
 * Internal design reference.
 *
 * Renders every primitive in every state, including error and disabled, so
 * drift is visible rather than theoretical. Not available in production.
 */

const SWATCHES: { token: string; hex: string; note: string }[] = [
  { token: 'ink', hex: '#040404', note: '20.50:1 - AAA' },
  { token: 'violet-600', hex: '#7C24F5', note: '6.13:1 - AA, primary action' },
  { token: 'violet-700', hex: '#6B17DB', note: '7.58:1 - AAA, hover' },
  { token: 'violet-300', hex: '#A56BFF', note: '4.88:1 on charcoal' },
  { token: 'pink-500', hex: '#EA33A9', note: '3.79:1 - fills and display only' },
  { token: 'pink-700', hex: '#B8177F', note: '6.06:1 - AA, pink text' },
  { token: 'muted', hex: '#5A5766', note: '7.02:1 - AAA' },
  { token: 'success', hex: '#146C43', note: '6.45:1 - AA' },
  { token: 'warning', hex: '#8C5200', note: '6.32:1 - AA' },
  { token: 'danger', hex: '#C02626', note: '5.92:1 - AA' },
  { token: 'info', hex: '#1D4FD8', note: '6.64:1 - AA' },
]

export default function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-5 py-12">
      <h1 className="font-display text-ink text-3xl font-extrabold tracking-tight">
        Design system
      </h1>
      <p className="text-muted mt-2 max-w-xl">
        Every colour below was measured against WCAG 2.2 AA. Brand pink fails for normal text on
        white, so it is a fill and display colour only.
      </p>

      <section className="mt-10">
        <h2 className="font-display text-ink text-xl font-extrabold">Colour</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {SWATCHES.map((s) => (
            <li
              key={s.token}
              className="rounded-control border-line flex items-center gap-3 border px-3 py-2.5"
            >
              <span
                aria-hidden="true"
                className="border-line-strong size-8 shrink-0 rounded-md border"
                style={{ background: s.hex }}
              />
              <span className="min-w-0">
                <span className="text-ink block text-sm font-medium">{s.token}</span>
                <span className="text-muted block text-xs">
                  {s.hex} · {s.note}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-ink text-xl font-extrabold">Type</h2>
        <div className="rounded-card border-line mt-4 flex flex-col gap-3 border p-5">
          <p className="font-display text-ink text-3xl font-extrabold tracking-tight">
            Plus Jakarta Sans ExtraBold — display
          </p>
          <p className="font-editorial text-ink text-2xl italic">
            Fraunces Italic — editorial accent
          </p>
          <p className="text-ink text-base">Inter — product interface and body copy</p>
          <p className="text-muted text-sm" data-tabular>
            Tabular numerals: 10:45 · 12:00 · 1,204 · 98.6%
          </p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-ink text-xl font-extrabold">Buttons</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-ink text-xl font-extrabold">Badges</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="violet">Violet</Badge>
          <Badge tone="success">Verified</Badge>
          <Badge tone="warning">Due soon</Badge>
          <Badge tone="danger">Overdue</Badge>
          <Badge tone="info">Published</Badge>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-ink text-xl font-extrabold">Fields</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="demo-ok" label="Name" hint="As it appears on the schedule" required>
            {(p) => <Input {...p} defaultValue="Riverside" />}
          </Field>
          <Field id="demo-error" label="Email" error="Enter a valid email address" required>
            {(p) => <Input {...p} defaultValue="not-an-email" />}
          </Field>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-ink text-xl font-extrabold">States</h2>
        <div className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader title="Card header" description="With a description" />
            <div className="p-5">
              <LoadingState label="Loading example" />
            </div>
          </Card>
          <EmptyState
            title="Nothing here yet"
            description="Empty states say what would appear and what to do next."
          />
          <ErrorState description="We could not load this. Try again, or contact your manager if it keeps happening." />
          <PermissionDenied capabilityLabel="View audit history" />
        </div>
      </section>
    </main>
  )
}
