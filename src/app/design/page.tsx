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
  { token: 'ink / navy-800', hex: '#1E2D3D', note: '14.02:1 - AAA, primary text' },
  { token: 'teal-600', hex: '#2A5C5A', note: '7.56:1 - AAA, primary action and links' },
  { token: 'teal-700', hex: '#234B49', note: '9.66:1 - AAA, small accent text' },
  { token: 'teal-300', hex: '#7FB5B0', note: '7.18:1 on charcoal' },
  { token: 'sage-400', hex: '#7FB5A0', note: '2.33:1 - fills, borders and icons only' },
  { token: 'sage-700 / success', hex: '#2E6B54', note: '6.27:1 - AA, sage text' },
  { token: 'sand-200', hex: '#F5E6D3', note: '1.23:1 - a surface colour, never text' },
  { token: 'coral-400', hex: '#E8856C', note: '2.62:1 - fills, borders and icons only' },
  { token: 'coral-700 / warning', hex: '#A34128', note: '6.28:1 - AA, coral text' },
  { token: 'muted', hex: '#4E5A68', note: '7.03:1 - AAA' },
  { token: 'faint', hex: '#67727F', note: '4.89:1 - AA' },
  { token: 'danger', hex: '#A8172B', note: '7.44:1 - AA, crimson, never coral' },
  { token: 'info', hex: '#26557A', note: '7.89:1 - AA' },
]

export default function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-5 py-12">
      <h1 className="font-display text-ink text-3xl font-extrabold tracking-tight">
        Design system
      </h1>
      <p className="text-muted mt-2 max-w-xl">
        Every colour below was measured against WCAG 2.2 AA. Soft Sage, Warm Sand and Coral Pop fail
        for normal text on white, so they are fill, border and icon colours; their darker variants
        carry text.
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
          <Badge tone="accent">Accent</Badge>
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
