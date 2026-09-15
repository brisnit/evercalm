/**
 * The hero illustration: a manager's console with an employee's phone in
 * front of it.
 *
 * Built in markup rather than shipped as an image so it stays sharp, reflows
 * on a phone, and cannot drift out of date as a screenshot would. It is
 * decoration around the real claim in the headline, so the whole thing is
 * hidden from assistive technology and summarised once in a caption.
 */
export function HeroMock() {
  return (
    <div data-testid="hero-mock" className="relative">
      <p className="sr-only">
        An illustration of the EverCalm console showing today&rsquo;s coverage, certifications due,
        and onboarding counts, with an employee&rsquo;s phone showing their own checklist for the
        shift.
      </p>

      {/*
        The phone's overhang is RESERVED inside this column - left padding for
        the part that hangs past the console's edge, bottom padding for the
        part that hangs below it - so the phone can overlap the console but
        never leave the column and reach the text beside it.
      */}
      <div aria-hidden="true" className="relative sm:pb-10 sm:pl-14 lg:pl-12 xl:pl-14">
        <Console />
        <Phone />
      </div>
    </div>
  )
}

function Console() {
  return (
    <div
      data-testid="hero-console"
      className="border-line/70 rounded-[1.15rem] border bg-white shadow-[0_24px_60px_-24px_rgb(23_18_64/0.28)]"
    >
      <div className="border-line/70 flex items-center gap-2.5 border-b px-4 py-3">
        <span className="flex gap-1.5">
          <Dot />
          <Dot />
          <Dot />
        </span>
        <span className="text-faint font-mono text-[0.625rem] tracking-[0.16em] uppercase">
          EverCalm · Riverside Ave
        </span>
        <span className="text-success ml-auto flex items-center gap-1.5 font-mono text-[0.625rem] tracking-[0.14em] uppercase">
          <span className="relative flex h-1.5 w-1.5">
            <span className="bg-success/50 absolute inset-0 rounded-full motion-safe:animate-ping" />
            <span className="bg-success relative h-1.5 w-1.5 rounded-full" />
          </span>
          Live
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-deep text-lg font-extrabold">Today · Saturday</p>
            <p className="text-muted mt-0.5 text-[0.8125rem]">
              Dinner service · 12 scheduled · 3 sections
            </p>
          </div>
          <span className="bg-mist text-accent-strong rounded-full px-3 py-1.5 text-xs font-semibold">
            4:45p huddle
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <Stat label="Coverage" value="100%" tone="text-success" />
          <Stat label="Certs due" value="2" tone="text-warning" />
          <Stat label="Onboarding" value="3" tone="text-deep" />
        </div>

        <ul className="mt-3 flex flex-col gap-2">
          <Row
            title="Shift swap · Maya → Devon"
            detail="Sat 4p–close, Bar"
            badge="Approve"
            badgeClass="bg-warning-soft text-warning"
          />
          <Row
            title="Allergen Handling refresher"
            detail="7 of 9 complete · due Sunday"
            badge="In progress"
            badgeClass="bg-pink-50 text-pink-700"
          />
          <Row
            title="Jordan T. · Day 3 onboarding"
            detail="Uniform policy signed · POS next"
            badge="On track"
            badgeClass="bg-info-soft text-info"
          />
          <Row
            title="Opening checklist · AM"
            detail="18 of 18 · verified 6:12a"
            badge="Done"
            badgeClass="bg-success-soft text-success"
          />
        </ul>
      </div>
    </div>
  )
}

function Dot() {
  return <span className="bg-line-strong h-2 w-2 rounded-full" />
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="border-line/70 bg-lift rounded-xl border px-3 py-2.5">
      <p className="text-faint font-mono text-[0.5625rem] tracking-[0.14em] uppercase">{label}</p>
      <p className={`font-display mt-1 text-xl font-extrabold ${tone}`}>{value}</p>
    </div>
  )
}

function Row({
  title,
  detail,
  badge,
  badgeClass,
}: {
  title: string
  detail: string
  badge: string
  badgeClass: string
}) {
  return (
    <li className="border-line/70 flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="text-deep block truncate text-[0.8125rem] font-semibold">{title}</span>
        <span className="text-muted block truncate text-xs">{detail}</span>
      </span>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${badgeClass}`}
      >
        {badge}
      </span>
    </li>
  )
}

/**
 * From 640px up the phone is pinned to the bottom-left corner of the reserved
 * space around the console, overlapping the console but staying in the
 * column. On a phone it stacks under the console instead - centred, kept
 * phone-sized, and tucked over the console's lower edge so the two still read
 * as one composition.
 */
function Phone() {
  return (
    <div
      data-testid="hero-phone"
      className="relative mx-auto -mt-12 w-full max-w-[16.5rem] sm:absolute sm:bottom-0 sm:left-0 sm:mx-0 sm:mt-0 sm:w-[15.5rem] sm:max-w-none"
    >
      {/* The float lives on an inner box, so the measured phone never moves. */}
      <div className="border-line/70 rounded-[1.6rem] border bg-white p-3 shadow-[0_24px_50px_-20px_rgb(23_18_64/0.35)] motion-safe:animate-[ec-float_7s_ease-in-out_infinite]">
        <span className="bg-line mx-auto mb-3 block h-1 w-9 rounded-full" />
        <p className="font-display text-deep text-base font-extrabold">Hey, Maya</p>
        <p className="text-muted text-xs">Today · 4:00p – close · Bar</p>

        <ul className="mt-3 flex flex-col gap-1.5">
          <PhoneTask label="Clock in & read the huddle" done />
          <PhoneTask label="Bar set: garnish, ice, wells" />
          <PhoneTask label="Allergen refresher · 3 left" />
        </ul>

        <div className="border-accent/25 bg-lift mt-3 rounded-xl border px-3 py-2.5">
          <p className="text-accent-strong font-mono text-[0.5625rem] tracking-[0.16em] uppercase">
            Next
          </p>
          <p className="text-deep mt-1 text-[0.8125rem] font-semibold">Wine Service L2 check</p>
          <p className="text-muted text-[0.6875rem]">Wed 11a with C. Lin</p>
        </div>
      </div>
    </div>
  )
}

function PhoneTask({ label, done = false }: { label: string; done?: boolean }) {
  return (
    <li className="border-line/70 flex items-center gap-2 rounded-lg border px-2.5 py-2">
      <span
        className={
          done
            ? 'bg-success flex h-4 w-4 shrink-0 items-center justify-center rounded-full'
            : 'border-line-strong h-4 w-4 shrink-0 rounded-full border'
        }
      >
        {done ? (
          <svg
            viewBox="0 0 12 12"
            className="h-2.5 w-2.5 motion-safe:animate-[ec-tick_0.6s_ease-out_0.8s_both]"
            fill="none"
          >
            <path d="M2.5 6.2 5 8.6l4.5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : null}
      </span>
      <span
        className={done ? 'text-muted text-[0.6875rem] line-through' : 'text-deep text-[0.6875rem]'}
      >
        {label}
      </span>
    </li>
  )
}
