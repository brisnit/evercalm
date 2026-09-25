import { cn } from '@/lib/cn'

/**
 * THE PRODUCT, AS IT NOW LOOKS.
 *
 * Round 2 rebuilt manager scheduling on the Slotted model and put the whole
 * application on a navy band with two-tone display type, coral actions and
 * mint tiles. The homepage has to show THAT product: a stakeholder should go
 * from this page into the app and feel no generation gap.
 *
 * These frames are drawn with the application's own tokens - band, canvas,
 * tile, action, sage, coral - rather than a separate set of marketing greys,
 * so when the product's palette moves, the homepage moves with it. The data
 * is Harbor & Vine's, the same fictional restaurant the demo runs on.
 *
 * They are decoration: aria-hidden, with the claim written in the copy beside
 * them, exactly as the illustration they replaced was.
 */

/* -------------------------------------------------------------------------
   Manager: the week, as Slotted builds it
   ---------------------------------------------------------------------- */

const DAYS = [
  { day: 'Mon', n: '16', filled: '8/8', state: 'ok' },
  { day: 'Tue', n: '17', filled: '8/8', state: 'ok' },
  { day: 'Wed', n: '18', filled: '8/8', state: 'warn' },
  { day: 'Thu', n: '19', filled: '8/8', state: 'ok' },
  { day: 'Fri', n: '20', filled: '8/10', state: 'open' },
] as const

const ROWS = [
  {
    role: 'Server · 4–10pm',
    cells: ['Sam W.', 'Priya S.', 'Sam W.', 'Kayla B.', 'Noa F.'],
    marks: ['ok', 'ok', 'no', 'ok', 'ok'],
  },
  {
    role: 'Host · 4–10pm',
    cells: ['Jordan V.', 'Jordan V.', 'Jordan V.', 'Theo N.', 'Theo N.'],
    marks: ['ok', 'ok', 'ok', 'ok', 'soft'],
  },
  {
    role: 'Bartender · 4–11pm',
    cells: ['—', '—', 'Camille F.', 'Camille F.', '—'],
    marks: ['open', 'open', 'ok', 'ok', 'open'],
  },
] as const

const MARK: Record<string, { glyph: string; className: string }> = {
  ok: { glyph: '✓', className: 'text-sage-300' },
  soft: { glyph: '–', className: 'text-coral-300' },
  no: { glyph: '×', className: 'text-coral-400' },
  open: { glyph: '+', className: 'text-band-quiet' },
}

/** The manager's week grid, in the application's own navy. */
export function ManagerWeekFrame({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-band overflow-hidden rounded-[1.25rem] text-white',
        'shadow-[0_46px_90px_-32px_rgb(20_32_44/0.55)] ring-1 ring-white/10',
        className,
      )}
    >
      {/* Band header, exactly as the application draws it. */}
      <div className="border-band-line flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-band-quiet text-[0.6875rem] tracking-[0.14em] uppercase">Riverside</p>
          <p className="font-display mt-0.5 text-[1.0625rem] leading-none font-extrabold">
            Week of <span className="text-band-accent">Mon, Mar 16</span>
          </p>
        </div>
        <span className="bg-action rounded-full px-3 py-1.5 text-[0.6875rem] font-semibold whitespace-nowrap">
          Publish
        </span>
      </div>

      {/* Four stat tiles, the ones the real page carries. */}
      <div className="border-band-line grid grid-cols-4 gap-px border-b bg-white/5">
        {[
          ['Slots filled', '48/50'],
          ['Approved', '5/6'],
          ['Needs you', '3'],
          ['Overrides', '1'],
        ].map(([label, value]) => (
          <div key={label} className="bg-band px-3 py-2.5">
            <p className="text-band-quiet text-[0.5625rem] tracking-wide uppercase">{label}</p>
            <p className="font-display mt-0.5 text-[0.9375rem] font-extrabold tabular-nums">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* The week grid. */}
      <div className="overflow-hidden px-4 py-4">
        <div className="grid grid-cols-[4.25rem_repeat(3,minmax(0,1fr))] gap-x-1.5 gap-y-1.5 sm:grid-cols-[5.5rem_repeat(5,minmax(0,1fr))]">
          <span />
          {DAYS.map((d, index) => (
            <span key={d.day} className={cn('text-center', index > 2 && 'hidden sm:block')}>
              <span className="text-band-quiet block text-[0.5625rem] tracking-wide uppercase">
                {d.day} {d.n}
              </span>
              <span
                className={cn(
                  'mt-0.5 block text-[0.625rem] font-semibold tabular-nums',
                  d.state === 'open'
                    ? 'text-coral-300'
                    : d.state === 'warn'
                      ? 'text-coral-400'
                      : 'text-sage-300',
                )}
              >
                {d.filled}
              </span>
            </span>
          ))}

          {ROWS.map((row) => (
            <FrameRow key={row.role} row={row} />
          ))}
        </div>
      </div>

      {/* The attention line: what the real page puts under the grid. */}
      <div className="border-band-line flex items-center gap-2 border-t px-5 py-3">
        <span aria-hidden="true" className="text-coral-400 text-sm leading-none">
          ×
        </span>
        <p className="text-band-quiet min-w-0 truncate text-[0.75rem]">
          <span className="font-semibold text-white">Sam is unavailable</span> Wed · Server · 4–10pm
        </p>
      </div>
    </div>
  )
}

function FrameRow({ row }: { row: (typeof ROWS)[number] }) {
  return (
    <>
      <span className="text-band-quiet self-center truncate text-[0.625rem] tracking-wide uppercase">
        {row.role}
      </span>
      {row.cells.map((name, index) => {
        const mark = MARK[row.marks[index]!]!
        const empty = name === '—'
        return (
          <span
            key={`${row.role}-${index}`}
            className={cn(
              'flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1.5 text-[0.625rem]',
              index > 2 && 'hidden sm:flex',
              empty
                ? 'border-band-line border border-dashed'
                : 'border border-white/10 bg-white/[0.07]',
            )}
          >
            <span className={cn('shrink-0 leading-none', mark.className)}>{mark.glyph}</span>
            <span className={cn('truncate', empty ? 'text-band-quiet italic' : 'text-white')}>
              {empty ? 'Open' : name}
            </span>
          </span>
        )
      })}
    </>
  )
}

/* -------------------------------------------------------------------------
   Employee: today, on a phone
   ---------------------------------------------------------------------- */

/** The staff app's today screen, in the phone the reference floats in front. */
export function StaffPhoneFrame({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'w-[12rem] overflow-hidden rounded-[1.6rem] bg-white p-1.5',
        'shadow-[0_40px_70px_-22px_rgb(20_32_44/0.5)] ring-1 ring-black/5',
        className,
      )}
    >
      <div className="overflow-hidden rounded-[1.4rem]">
        {/* The staff band, two-tone title and all. */}
        <div className="bg-band px-4 pt-4 pb-5 text-white">
          <p className="text-band-quiet text-[0.5625rem] tracking-[0.14em] uppercase">
            Harbor &amp; Vine
          </p>
          <p className="font-display mt-1.5 text-[1.25rem] leading-none font-extrabold">
            Hello, <span className="text-band-accent">Sam</span>
          </p>
        </div>

        <div className="bg-canvas -mt-2 rounded-t-[1rem] px-3 pt-3 pb-4">
          <div className="rounded-xl border border-black/5 bg-white p-3 shadow-sm">
            <p className="text-faint text-[0.5625rem] tracking-[0.12em] uppercase">
              Next shift · today
            </p>
            <p className="text-deep mt-1 text-[0.8125rem] font-semibold">Server · 4:00–10:30 pm</p>
            <p className="text-quiet mt-1 text-[0.6875rem]">Meal break 7:00 pm · 30 min</p>
            <span className="bg-sage-100 text-sage-700 mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.5625rem] font-semibold">
              ✓ Available
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              ['Your week', '4 shifts · 26 h'],
              ['Training', '1 due Sunday'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-black/5 bg-white p-2.5">
                <span className="bg-tile mb-1.5 flex size-5 items-center justify-center rounded-md">
                  <span className="block size-1.5 rounded-full bg-teal-600" />
                </span>
                <p className="text-deep text-[0.625rem] font-semibold">{label}</p>
                <p className="text-muted text-[0.5625rem]">{value}</p>
              </div>
            ))}
          </div>

          <div className="border-coral-200 bg-coral-50 mt-2 rounded-xl border p-2.5">
            <p className="text-coral-700 text-[0.625rem] font-semibold">Wed, 8am–4pm</p>
            <p className="text-quiet mt-0.5 text-[0.5625rem] leading-snug">
              You said you are unavailable. Marcus scheduled you anyway.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------
   The four steps of a week
   ---------------------------------------------------------------------- */

/** A small card for the template → autofill → review → publish sequence. */
export function StepCard({
  index,
  title,
  body,
  detail,
}: {
  index: string
  title: string
  body: string
  detail: string
}) {
  return (
    <li className="group border-line/70 relative overflow-hidden rounded-[1.15rem] border bg-white p-5 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-[0_28px_50px_-24px_rgb(20_32_44/0.35)] motion-reduce:hover:translate-y-0">
      <span
        aria-hidden="true"
        className="bg-sage-50 group-hover:bg-coral-50 absolute -top-8 -right-8 size-24 rounded-full transition-colors duration-300"
      />
      <p className="font-display text-accent relative text-[1.75rem] leading-none font-extrabold tabular-nums">
        {index}
      </p>
      <h3 className="text-deep relative mt-3 text-[1.0625rem] font-bold">{title}</h3>
      <p className="text-quiet relative mt-2 text-[0.875rem] leading-[1.6]">{body}</p>
      <p className="text-muted relative mt-3 font-mono text-[0.6875rem] tracking-wide">{detail}</p>
    </li>
  )
}
