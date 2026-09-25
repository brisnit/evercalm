import type { Metadata } from 'next'
import Link from 'next/link'
import { Container, SECTION, SectionHeading } from './_home/parts'
import { ArcBehind, QuoteMark, SectionBreak, TriRule } from './_home/graphics'
import { HeroPeople } from './_home/hero-people'
import { ManagerWeekFrame, StaffPhoneFrame, StepCard } from './_home/product-frames'
import { Icon, type IconName } from './_home/icons'
import { IndustryTabs, type Industry } from './_home/industry-tabs'
import { IMAGERY } from './_home/imagery'
import { LifestylePhoto } from './_home/lifestyle-image'
import { RevealOnScroll } from './_home/reveal'

export const metadata: Metadata = {
  title: 'EverCalm — everyone walks in knowing what’s next',
  description:
    'One platform for onboarding, training, scheduling, communication, and the daily run of the floor, built for shift-based teams rather than desks.',
}

/* -------------------------------------------------------------------------
   Content
   ---------------------------------------------------------------------- */

const INDUSTRY_PILLS = [
  'Restaurants & bars',
  'Salons & spas',
  'Retail stores',
  'Fitness studios',
  'Hotels & hospitality',
  'Field & service teams',
]

const PROMISE = [
  {
    marker: '6:00a open',
    icon: 'clock' as IconName,
    tone: 'text-accent border-accent',
    title: 'What’s happening',
    body: 'Today’s schedule, who’s on, callouts, events, and every announcement that matters — on the same screen, not in three group chats.',
    quote: '“Patio opens at 4. Ramos is out — Devon covers section 3.”',
  },
  {
    marker: 'Midday',
    icon: 'checklists' as IconName,
    tone: 'text-coral-600 border-coral-400',
    title: 'What’s expected',
    body: 'Side work, pre-shift routines, opening and closing checklists, policy acknowledgements, and the training due this week — assigned by role, not by memory.',
    quote: '“Bar close: 9 items. Allergen refresher due Sunday.”',
  },
  {
    marker: '4:45p huddle',
    icon: 'check' as IconName,
    tone: 'text-success border-success',
    title: 'What’s completed',
    body: 'Verified, timestamped, and visible to both sides. Skills proven, certifications on file, checklists signed off — a real record instead of “I’m pretty sure they did it.”',
    quote: '“Opening checklist · 18 of 18 · verified 6:12a by C. Lin”',
  },
  {
    marker: 'Close',
    icon: 'arrow' as IconName,
    tone: 'text-info border-info',
    title: 'What comes next',
    body: 'Next shift, next module, next level, next certification renewal. Every person can see the path ahead of them without asking a manager for it.',
    quote: '“Wed 11a · Wine Service Level 2 verification”',
  },
]

const CAPABILITIES: { icon: IconName; chip: string; title: string; body: string }[] = [
  {
    icon: 'onboarding',
    chip: 'bg-teal-50 text-teal-700',
    title: 'Onboarding',
    body: 'Day-one to day-thirty paths with forms, policies, and uniform sizes collected before the first shift.',
  },
  {
    icon: 'training',
    chip: 'bg-coral-50 text-coral-700',
    title: 'Training & learning paths',
    body: 'Build a path once, assign by role or location, and see exactly where each person stopped.',
  },
  {
    icon: 'skills',
    chip: 'bg-info-soft text-info',
    title: 'Skills & certifications',
    body: 'Levels backed by verification, with renewal dates tracked and flagged before they lapse.',
  },
  {
    icon: 'scheduling',
    chip: 'bg-success-soft text-success',
    title: 'Scheduling',
    body: 'Drag-and-drop the week, publish to phones, and let the schedule check certifications for you.',
  },
  {
    icon: 'availability',
    chip: 'bg-warning-soft text-warning',
    title: 'Availability & time off',
    body: 'Requests, blackout dates, and approvals in one queue — visible on the schedule as you build it.',
  },
  {
    icon: 'swaps',
    chip: 'bg-teal-50 text-teal-700',
    title: 'Shift swaps & pickups',
    body: 'Staff trade among qualified coworkers only. Managers approve in one tap, or set it to auto.',
  },
  {
    icon: 'announcements',
    chip: 'bg-coral-50 text-coral-700',
    title: 'Announcements & channels',
    body: 'Post to a location, a role or a shift and see who has read it — plus two team channels and a direct line to one person.',
  },
  {
    icon: 'policies',
    chip: 'bg-info-soft text-info',
    title: 'Policies & acknowledgements',
    body: 'Handbook updates go out with a signature trail you can export when someone asks for it.',
  },
  {
    icon: 'checklists',
    chip: 'bg-success-soft text-success',
    title: 'Checklists & side work',
    body: 'Opening, closing, and station duties with photo proof where it matters.',
  },
  {
    icon: 'preshift',
    chip: 'bg-warning-soft text-warning',
    title: 'Document hub',
    body: 'The handbook, the allergen matrix, the closing sheet — uploaded once, in one place, with who each one is for.',
  },
  {
    icon: 'performance',
    chip: 'bg-teal-50 text-teal-700',
    title: 'Performance & readiness',
    body: 'See which stations are covered by trained people, and which shifts are one callout from trouble.',
  },
  {
    icon: 'locations',
    chip: 'bg-coral-50 text-coral-700',
    title: 'Multi-location',
    body: 'Roll standards out everywhere, then compare locations without emailing five managers.',
  },
]

const CONSOLE_POINTS = [
  [
    'Readiness at a glance.',
    'Who’s trained, who’s certified, who’s covered — by shift, station, and location.',
  ],
  [
    'Approvals in one queue.',
    'Time off, swaps, pickups, and completed onboarding steps, not scattered across texts.',
  ],
  [
    'Workflows you configure.',
    'Roles, stations, checklists, and approval rules bend to how your business actually runs.',
  ],
  [
    'An exportable record.',
    'Acknowledgements, certifications, and completions with dates attached.',
  ],
]

const APP_POINTS = [
  ['Today, first.', 'Shift times, station, huddle note, and the tasks tied to that shift.'],
  ['Training that fits a break.', 'Short modules on a phone, picked up where they left off.'],
  [
    'Requests without a conversation.',
    'Ask for Friday off, offer up a shift, pick one up — and get an answer in the app.',
  ],
  ['Visible progress.', 'Skills earned, levels reached, and what it takes to get to the next one.'],
]

const PATH_STEPS = [
  {
    title: 'Glassware, ice & well setup',
    detail: 'Completed Aug 14 · 8 min',
    badge: 'Passed',
    state: 'done',
  },
  {
    title: 'Pour standards & comp policy',
    detail: 'Completed Aug 21 · 12 min',
    badge: 'Passed',
    state: 'done',
  },
  {
    title: 'Allergen handling',
    detail: 'Verified on shift by C. Lin · Sep 2',
    badge: 'Verified',
    state: 'done',
  },
  {
    title: 'Wine service & by-the-glass list',
    detail: '2 of 6 modules · floor check Wed 11a',
    badge: 'In progress',
    state: 'active',
  },
  { title: 'Closing the bar solo', detail: 'Unlocks at Level 3', badge: 'Locked', state: 'locked' },
] as const

const SKILL_LEVELS = [
  { name: 'Allergen handling', detail: '4 of 4 bartenders verified', filled: 4, tone: 'bg-accent' },
  {
    name: 'Wine service',
    detail: 'Maya at L2 · floor check scheduled',
    filled: 2,
    tone: 'bg-coral-400',
  },
  { name: 'Solo close', detail: '1 of 4 · a Saturday risk', filled: 1, tone: 'bg-info' },
]

const CERTIFICATIONS = [
  {
    icon: 'badge' as IconName,
    name: 'Food handler card',
    detail: '11 of 12 staff current',
    badge: 'Current',
    tone: 'bg-success-soft text-success',
    chip: 'bg-success-soft text-success',
  },
  {
    icon: 'clock' as IconName,
    name: 'Alcohol server permit · D. Kaur',
    detail: 'Expires Oct 26 · renewal assigned',
    badge: '14 days',
    tone: 'bg-warning-soft text-warning',
    chip: 'bg-warning-soft text-warning',
  },
  {
    icon: 'shield' as IconName,
    name: 'First aid / CPR',
    detail: 'Managers only · 3 of 3',
    badge: 'Current',
    tone: 'bg-success-soft text-success',
    chip: 'bg-info-soft text-info',
  },
]

const INDUSTRIES: Industry[] = [
  {
    id: 'restaurants',
    label: 'Restaurants',
    title: 'Restaurants & bars',
    body: 'Arrives configured for FOH and BOH: stations, sections, pre-shift huddles, and the certifications a health inspector asks about. Built around service periods rather than a nine-to-five day.',
    items: [
      'Host, server, bar, line, dish roles',
      'Opening / closing / side work checklists',
      'Allergen & food handler training',
      'Pre-shift huddle with the 86 list',
      'Alcohol server permit tracking',
      'Section and station assignments',
    ],
  },
  {
    id: 'salons',
    label: 'Salons & spas',
    title: 'Salons & spas',
    body: 'Chair and room assignments, service menus, and the licence renewals a board inspection asks for. Colour and chemical training sits alongside the booking day rather than in a binder.',
    items: [
      'Stylist, colourist, therapist, front desk',
      'Station and treatment-room turnover',
      'Colour and chemical safety training',
      'Cosmetology licence renewals',
      'Client-ready opening standards',
      'Retail and product knowledge paths',
    ],
  },
  {
    id: 'retail',
    label: 'Retail',
    title: 'Retail stores',
    body: 'Floor zones, register close, and stockroom routines, with training that fits between customers. Standards roll out to every store and you can see which one actually ran them.',
    items: [
      'Sales floor, register, stockroom roles',
      'Open, close, and cash-handling routines',
      'Loss prevention acknowledgements',
      'Visual merchandising standards',
      'Seasonal hiring waves',
      'Store-by-store comparison',
    ],
  },
  {
    id: 'fitness',
    label: 'Fitness studios',
    title: 'Fitness studios',
    body: 'Class coverage, certification expiry, and floor safety in one place. A lapsed CPR card stops being something you discover on the day of a class.',
    items: [
      'Instructor, front desk, floor coach',
      'Class and cover scheduling',
      'CPR and specialty certifications',
      'Equipment and cleaning checklists',
      'New member onboarding scripts',
      'Substitute instructor pickups',
    ],
  },
  {
    id: 'hospitality',
    label: 'Hospitality',
    title: 'Hotels & hospitality',
    body: 'Departments that run around the clock, with handoffs that have to survive a shift change. Housekeeping, front desk, and maintenance work from the same record.',
    items: [
      'Front desk, housekeeping, maintenance',
      'Room turnover and inspection checklists',
      'Shift handoff notes across departments',
      'Brand standard acknowledgements',
      'Overnight and split-shift coverage',
      'Property-by-property rollout',
    ],
  },
  {
    id: 'service',
    label: 'Service teams',
    title: 'Field & service teams',
    body: 'Crews that never see an office still need the same four answers. Routes, job checklists, and safety certifications reach the phone in the van.',
    items: [
      'Crew lead, technician, apprentice',
      'Job-site checklists with photo proof',
      'Safety and equipment certifications',
      'Route and territory assignments',
      'Toolbox talks with acknowledgement',
      'Multi-crew readiness view',
    ],
  },
]

const ROLLOUT = [
  {
    week: 'Week 1',
    line: 'bg-accent',
    title: 'Import the roster',
    body: 'Upload your staff list or sync it from payroll. Roles, locations, and existing certifications land as records — not as a spreadsheet you keep re-opening.',
  },
  {
    week: 'Week 2',
    line: 'bg-coral-400',
    title: 'Load your standards',
    body: 'Pick your industry template and edit it into your business: your checklists, your handbook, your training path, your approval rules.',
  },
  {
    week: 'Week 3',
    line: 'bg-info',
    title: 'Publish to the floor',
    body: 'Staff download the app, see their schedule and first tasks, and the group text quietly stops being the system of record.',
  },
]

/* -------------------------------------------------------------------------
   Page
   ---------------------------------------------------------------------- */

export default function HomePage() {
  return (
    <>
      <RevealOnScroll />
      <Hero />
      <IndustryStrip />
      <SectionBreak from="cream" />
      <Promise />
      <ShiftBoard />
      <SectionBreak from="navy" peak={62} />
      <Experiences />
      <Platform />
      <Training />
      <Industries />
      <Rollout />
      <FinalCta />
    </>
  )
}

function Hero() {
  return (
    <section className="bg-lift relative overflow-hidden">
      <Container className="relative pt-9 pb-16 sm:pt-11 sm:pb-20">
        <div data-testid="hero-copy" className="mx-auto max-w-[58rem] text-center">
          <p className="border-line/70 text-deep inline-flex items-center gap-2.5 rounded-full border bg-white/80 py-1.5 pr-4 pl-1.5 text-[0.8125rem] font-medium backdrop-blur-sm">
            <span className="bg-accent flex h-6 w-6 items-center justify-center rounded-full">
              <Icon name="check" className="h-3.5 w-3.5 text-white" />
            </span>
            Built for shift-based teams, not desk-based ones
          </p>

          {/*
            Round 2: "The bold text arrangement with the two-tone lettering is
            eye catching." Two tones and two voices - the claim in heavy sans,
            the promise in italic serif - at a size that carries the page.
          */}
          <h1
            data-testid="hero-headline"
            className="font-display text-deep mt-5 text-[2.625rem] leading-[1.0] font-extrabold tracking-[-0.025em] text-balance sm:text-[4.25rem] sm:leading-[0.98] sm:text-wrap lg:text-[5.25rem]"
          >
            Everyone walks in{' '}
            {/* The break is the designed one; on a phone the line finds its
                own shape rather than stranding a word. */}
            <br className="hidden sm:block" />
            {/* One unit, so the italic promise never orphans its last word. */}
            <span className="sm:whitespace-nowrap">
              knowing <span className="text-accent font-serif italic">what’s next.</span>
            </span>
          </h1>

          <p
            data-testid="hero-description"
            className="text-quiet mx-auto mt-4 max-w-[34rem] text-[1.0625rem] leading-[1.65]"
          >
            One platform for onboarding, training, scheduling, communication and the daily run of
            the floor. Managers stop rebuilding the same spreadsheet every week. Staff open one app
            and see their shift, their tasks and their progress.
          </p>

          <div
            data-testid="hero-actions"
            className="mt-6 flex flex-wrap items-center justify-center gap-3"
          >
            <Link
              href="/contact"
              className="bg-accent hover:bg-accent-strong group ease-calm inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[0.9375rem] font-semibold text-white shadow-[0_16px_32px_-16px_rgb(42_92_90/0.9)] transition-[background-color,box-shadow,translate] duration-[320ms] hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-16px_rgb(42_92_90/0.95)] active:translate-y-0 motion-reduce:hover:translate-y-0"
            >
              Ask about a pilot
              <Icon
                name="arrow"
                className="ease-calm h-4 w-4 transition-transform duration-[320ms] group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </Link>
            <Link
              href="/#shift-board"
              className="border-line-strong text-deep hover:border-accent/60 hover:text-accent-strong ease-calm inline-flex min-h-12 items-center rounded-full border bg-white px-7 text-[0.9375rem] font-semibold transition-[color,border-color,translate,box-shadow] duration-[320ms] hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-18px_rgb(20_32_44/0.4)] motion-reduce:hover:translate-y-0"
            >
              See the shift board
            </Link>
          </div>
        </div>

        {/* People first, product over the top of them. */}
        <div className="mt-8 sm:mt-9">
          <HeroPeople />
        </div>

        <p
          data-testid="hero-proof"
          className="text-muted mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[0.8125rem] sm:mt-14"
        >
          <span>
            <strong className="text-deep font-semibold">14 min</strong> to import a roster
          </span>
          <span aria-hidden="true" className="text-line-strong hidden sm:inline">
            ·
          </span>
          <span>
            <strong className="text-deep font-semibold">3 weeks</strong> to live, no project manager
          </span>
          <span aria-hidden="true" className="text-line-strong hidden sm:inline">
            ·
          </span>
          <span>
            <strong className="text-deep font-semibold">No</strong> credit card
          </span>
        </p>
      </Container>
    </section>
  )
}

function IndustryStrip() {
  return (
    <section className="border-line/60 bg-lift border-y">
      <Container className="flex flex-wrap items-center justify-center gap-3 py-4.5">
        <span className="text-faint font-mono text-[0.625rem] tracking-[0.16em] uppercase">
          Configured for
        </span>
        {INDUSTRY_PILLS.map((pill) => (
          <span
            key={pill}
            className="border-line/70 text-deep rounded-full border bg-white px-4 py-2 text-[0.8125rem] font-medium"
          >
            {pill}
          </span>
        ))}
      </Container>
    </section>
  )
}

function Promise() {
  return (
    <section className={`${SECTION} relative overflow-hidden bg-white`}>
      <Container className="relative">
        {/*
          Round 2 liked "the white background with the small design elements".
          This section leads almost entirely with type: an oversized numeral
          per question, and the photograph carried on an arc rather than
          dropped into a grid cell.
        */}
        <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          <div>
            <p className="text-coral-700 font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
              A shift, start to close
            </p>
            <h2
              id="promise"
              className="font-display text-deep mt-5 text-[2.5rem] leading-[0.98] font-extrabold tracking-[-0.025em] text-balance sm:text-[3.75rem]"
            >
              Four questions,
              <br />
              answered{' '}
              <span className="text-accent font-serif italic">before anyone has to ask.</span>
            </h2>
            <TriRule className="mt-7" />
            <p className="text-quiet mt-7 max-w-[34rem] text-[1.0625rem] leading-[1.65]">
              Most shift-based teams lose hours a week to the same four unknowns — relayed by group
              text, sticky note, and whoever happens to be on. EverCalm answers all four in one
              place, for every person, every day.
            </p>
          </div>

          <div data-reveal className="relative hidden lg:block">
            <ArcBehind className="-top-7 -left-7 rotate-180" tone="coral" />
            <div className="relative">
              <LifestylePhoto
                image={IMAGERY.managerCheckIn}
                sizes="380px"
                className="shadow-[0_34px_60px_-30px_rgb(20_32_44/0.5)]"
              />
            </div>
          </div>
        </div>

        <ol className="mt-16 grid gap-5 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {PROMISE.map((item, index) => (
            <li
              key={item.title}
              data-reveal
              style={{ '--reveal-index': index } as React.CSSProperties}
              className="group border-line/70 ease-calm relative overflow-hidden rounded-[1.15rem] border bg-white p-6 transition-[translate,box-shadow,border-color] duration-[550ms] hover:-translate-y-1 hover:border-transparent hover:shadow-[0_34px_60px_-28px_rgb(20_32_44/0.4)] motion-reduce:hover:translate-y-0"
            >
              <p className="text-faint relative font-mono text-[0.625rem] tracking-[0.14em] uppercase">
                {item.marker}
              </p>
              <p
                aria-hidden="true"
                className={`font-display relative mt-3 text-[2.75rem] leading-none font-extrabold tabular-nums ${item.tone.split(' ')[0]}`}
              >
                0{index + 1}
              </p>
              <h3 className="font-display text-deep relative mt-3 text-lg font-extrabold">
                {item.title}
              </h3>
              <p className="text-quiet relative mt-2.5 text-[0.9375rem] leading-[1.6]">
                {item.body}
              </p>
              {/*
                The example line is the contextual detail the brief asked for
                on hover, and it stays readable without one - it only changes
                weight, never appears from nothing.
              */}
              <p className="border-line-strong text-muted group-hover:border-coral-400 group-hover:text-quiet ease-calm relative mt-4 border-l-2 pl-3 text-[0.8125rem] italic transition-colors duration-[550ms]">
                {item.quote}
              </p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  )
}

/**
 * THE SHIFT BOARD.
 *
 * Round 2, on the desktop-plus-phone composition: "This layout for the app
 * display is really nice, but not at the top of the page, maybe mid-page."
 * So it is here, and it shows the scheduling work that round 2 just built:
 * the manager's week on the left, the employee's today floating in front of
 * it, and the four steps underneath.
 */
function ShiftBoard() {
  return (
    <section id="shift-board" className="bg-band relative scroll-mt-20 overflow-hidden">
      <Container className={`relative ${SECTION}`}>
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-14">
          <div>
            <p className="text-band-accent font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
              The shift board
            </p>
            <h2 className="font-display mt-5 text-[2.5rem] leading-[0.98] font-extrabold tracking-[-0.025em] text-balance text-white sm:text-[3.5rem]">
              Tell it how the business runs{' '}
              <span className="text-band-accent font-serif italic">once.</span>
            </h2>
            <p className="text-band-quiet mt-7 max-w-[32rem] text-[1.0625rem] leading-[1.7]">
              EverCalm lays out the week from your template, proposes a person for every slot, and
              shows its working. The manager reviews one day at a time and publishes. Nobody
              rebuilds a spreadsheet.
            </p>

            <dl className="mt-10 grid max-w-[28rem] grid-cols-3 gap-6">
              {[
                ['48 / 50', 'slots filled by autofill'],
                ['0', 'people over 40 hours'],
                ['1 tap', 'to publish the week'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="font-display text-[1.375rem] leading-none font-extrabold text-white tabular-nums">
                    {value}
                  </dt>
                  <dd className="text-band-quiet mt-2 text-[0.8125rem] leading-snug">{label}</dd>
                </div>
              ))}
            </dl>

            <Link
              href="/contact"
              className="bg-action hover:bg-action-hover group ease-calm mt-10 inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[0.9375rem] font-semibold text-white shadow-[0_18px_34px_-16px_rgb(194_79_49/0.9)] transition-[background-color,translate,box-shadow] duration-[320ms] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
            >
              See it on your week
              <Icon
                name="arrow"
                className="ease-calm h-4 w-4 transition-transform duration-[320ms] group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </Link>
          </div>

          {/* The product, layered: the week behind, today's shift in front. */}
          <div data-reveal className="relative">
            <ManagerWeekFrame />
            <StaffPhoneFrame className="absolute -right-3 -bottom-16 hidden sm:block lg:-right-16 lg:-bottom-20" />
          </div>
        </div>

        {/* On a phone the staff screen sits under the week rather than over it. */}
        <div className="mt-10 flex justify-center sm:hidden">
          <StaffPhoneFrame />
        </div>

        <ol className="mt-24 grid gap-4 sm:mt-28 sm:grid-cols-2 lg:grid-cols-4">
          <StepCard
            index="01"
            title="Template"
            body="Describe the week once — open days, the shifts each one needs, and your break rules."
            detail="About five minutes, once"
          />
          <StepCard
            index="02"
            title="Autofill"
            body="Every slot gets a proposal, and a plain-English account of how it decided."
            detail="46 preferred · 2 not preferred"
          />
          <StepCard
            index="03"
            title="Review"
            body="One card per day. Approve it, flag it for later, or open the day and change a pick."
            detail="Swipe, or use the buttons"
          />
          <StepCard
            index="04"
            title="Publish"
            body="Everyone gets their shifts and their break times. Only the people affected are told."
            detail="One tap"
          />
        </ol>
      </Container>
    </section>
  )
}

function Platform() {
  return (
    <section id="platform" className={`bg-lift relative scroll-mt-24 overflow-hidden ${SECTION}`}>
      <Container className="relative">
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div>
            <p className="text-coral-700 font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
              The platform
            </p>
            <h2 className="font-display text-deep mt-5 text-[2.5rem] leading-[0.98] font-extrabold tracking-[-0.025em] text-balance sm:text-[3.5rem]">
              One system for the{' '}
              <span className="text-accent font-serif italic">whole operation.</span>
            </h2>
          </div>
          <p className="text-quiet text-[1.0625rem] leading-[1.65] lg:pb-2">
            People, training, schedules and daily operations were never separate problems. EverCalm
            keeps them in one record, across every location, so a new hire’s certification,
            availability and closing duties all belong to the same person.
          </p>
        </div>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((item, index) => (
            <li
              key={item.title}
              data-reveal
              style={{ '--reveal-index': index % 4 } as React.CSSProperties}
              className="group border-line/60 ease-calm rounded-2xl border bg-white p-5 transition-[box-shadow,border-color,translate] duration-[550ms] hover:-translate-y-1 hover:border-transparent hover:shadow-[0_30px_54px_-26px_rgb(20_32_44/0.4)] motion-reduce:hover:translate-y-0"
            >
              <span
                className={`ease-calm flex h-10 w-10 items-center justify-center rounded-[0.8rem] transition-transform duration-[550ms] group-hover:scale-105 motion-reduce:group-hover:scale-100 ${item.chip}`}
              >
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <h3 className="font-display text-deep mt-4 text-[0.9375rem] font-extrabold">
                {item.title}
              </h3>
              <p className="text-quiet mt-2 text-[0.8125rem] leading-[1.55]">{item.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

function Experiences() {
  return (
    <section
      id="experiences"
      className={`relative scroll-mt-24 overflow-hidden bg-white ${SECTION}`}
    >
      <Container className="relative">
        <div className="max-w-[46rem]">
          <p className="text-coral-700 font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
            Two experiences
          </p>
          <h2 className="font-display text-deep mt-5 text-[2.5rem] leading-[0.98] font-extrabold tracking-[-0.025em] text-balance sm:text-[3.5rem]">
            Depth for the people running it.{' '}
            <span className="text-accent font-serif italic">Simplicity for everyone else.</span>
          </h2>
          <p className="text-quiet mt-7 text-[1.0625rem] leading-[1.65]">
            An operations platform fails the moment your staff stop opening it. So the manager side
            holds everything, and the employee side holds only what that person needs to know right
            now.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <ExperienceCard
            photo={IMAGERY.managerCheckIn}
            audience="Owners, HR & managers"
            audienceClass="bg-teal-50 text-teal-700"
            arc="coral"
            title="The console"
            lead="One place to build the week, spot the gap, and prove it happened."
            points={CONSOLE_POINTS}
            checkClass="bg-teal-100 text-teal-700"
          />
          <ExperienceCard
            photo={IMAGERY.stylistStation}
            audience="Employees"
            audienceClass="bg-info-soft text-info"
            arc="mint"
            title="The app"
            lead="Open it, and the answer is already on the screen. No hunting, no training required."
            points={APP_POINTS}
            checkClass="bg-info-soft text-info"
          />
        </div>

        {/*
          Round 2 liked the pull-quote with its oversized marks. It is a real
          line from the demo's own huddle note, so the page and the product
          say the same thing.
        */}
        <figure className="bg-lift relative mt-6 overflow-hidden rounded-[1.15rem] px-8 py-12 text-center sm:px-16 sm:py-16">
          <QuoteMark className="text-coral-400/90 top-6 left-6 h-7 w-9 sm:top-8 sm:left-10 sm:h-9 sm:w-12" />
          <QuoteMark className="text-coral-400/90 right-6 bottom-6 h-7 w-9 rotate-180 sm:right-10 sm:bottom-8 sm:h-9 sm:w-12" />
          <figcaption className="text-muted font-mono text-[0.625rem] tracking-[0.14em] uppercase">
            Tonight’s huddle note · Riverside Ave · 4:45p
          </figcaption>
          <blockquote className="font-display text-deep mx-auto mt-5 max-w-[40rem] text-[1.375rem] leading-[1.3] font-extrabold text-balance sm:text-[1.875rem]">
            “Patio opens at 4. Ramos is out — Devon covers section 3. Allergen refresher due
            Sunday.”
          </blockquote>
          <p className="text-muted mt-5 text-[0.8125rem]">
            Read by 12 of 14 before the shift started
          </p>
        </figure>
      </Container>
    </section>
  )
}

function ExperienceCard({
  photo,
  audience,
  audienceClass,
  title,
  lead,
  points,
  checkClass,
  arc,
}: {
  audience: string
  audienceClass: string
  title: string
  lead: string
  points: string[][]
  checkClass: string
  arc: 'coral' | 'mint'
  photo: (typeof IMAGERY)[keyof typeof IMAGERY]
}) {
  return (
    <div
      data-reveal
      className="group border-line/70 ease-calm relative rounded-[1.15rem] border bg-white p-5 transition-[translate,box-shadow,border-color] duration-[550ms] hover:-translate-y-1 hover:border-transparent hover:shadow-[0_38px_66px_-30px_rgb(20_32_44/0.42)] motion-reduce:hover:translate-y-0 sm:p-6"
    >
      <div className="relative mb-5">
        <ArcBehind
          tone={arc}
          className="ease-calm -top-5 -left-5 size-[9rem] rotate-180 transition-transform duration-[800ms] group-hover:-translate-x-1 group-hover:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
        />
        <LifestylePhoto
          image={photo}
          sizes="(min-width: 1024px) 520px, 100vw"
          className="relative shadow-[0_24px_44px_-26px_rgb(20_32_44/0.45)]"
        />
      </div>
      <span
        className={`inline-block rounded-full px-3 py-1.5 font-mono text-[0.625rem] tracking-[0.14em] uppercase ${audienceClass}`}
      >
        {audience}
      </span>
      <h3 className="font-display text-deep mt-4 text-2xl font-extrabold tracking-tight">
        {title}
      </h3>
      <p className="text-quiet mt-2.5 text-[0.9375rem] leading-[1.65]">{lead}</p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {points.map(([label, body]) => (
          <li key={label} className="flex gap-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${checkClass}`}
            >
              <Icon name="check" className="h-3 w-3" />
            </span>
            <p className="text-quiet text-[0.9375rem] leading-[1.6]">
              <strong className="text-deep font-semibold">{label}</strong> {body}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Training() {
  return (
    <section id="training" className={`bg-mist scroll-mt-24 ${SECTION}`}>
      <Container>
        <SectionHeading
          eyebrow="Training"
          title={
            <>
              Levels and badges —
              <br className="hidden sm:block" /> earned by proving it, not
              <br className="hidden sm:block" /> by clicking through it.
            </>
          }
          lead="Gamification only works when the reward means something. In EverCalm a level moves when knowledge is verified and a manager signs off on the floor, so a Level 3 bartender is one you can actually put on a Saturday."
        />

        <div
          data-reveal
          className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0"
        >
          <div className="border-line/70 rounded-[1.15rem] border bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-deep text-xl font-extrabold">Bar Fundamentals</h3>
                <p className="text-muted mt-1 text-[0.8125rem]">
                  Learning path · Maya R. · 3 of 5 complete
                </p>
              </div>
              <span className="bg-info-soft text-info rounded-full px-3 py-1.5 text-xs font-semibold">
                Level 2
              </span>
            </div>

            <ul className="mt-5 flex flex-col">
              {PATH_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="border-line/60 flex items-center gap-3.5 border-b py-3.5 last:border-b-0 last:pb-0"
                >
                  <StepMark state={step.state} index={index} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        step.state === 'locked'
                          ? 'text-muted block text-[0.9375rem] font-semibold'
                          : 'text-deep block text-[0.9375rem] font-semibold'
                      }
                    >
                      {step.title}
                    </span>
                    <span className="text-muted block text-[0.8125rem]">{step.detail}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-[0.6875rem] font-semibold ${
                      step.state === 'done'
                        ? 'bg-success-soft text-success'
                        : step.state === 'active'
                          ? 'bg-coral-50 text-coral-700'
                          : 'bg-sunk text-muted'
                    }`}
                  >
                    {step.badge}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-5">
            <div className="border-line/70 rounded-[1.15rem] border bg-white p-5 sm:p-6">
              <h3 className="font-display text-deep text-xl font-extrabold">Skill levels</h3>
              <p className="text-muted mt-1 text-[0.8125rem]">Bar team · Riverside Ave</p>
              <ul className="mt-5 flex flex-col">
                {SKILL_LEVELS.map((skill) => (
                  <li
                    key={skill.name}
                    className="border-line/60 flex items-center justify-between gap-4 border-b py-3.5 last:border-b-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="text-deep block text-[0.9375rem] font-semibold">
                        {skill.name}
                      </span>
                      <span className="text-muted block text-[0.8125rem]">{skill.detail}</span>
                    </span>
                    <span className="flex shrink-0 gap-1" aria-hidden="true">
                      {[0, 1, 2, 3].map((pip) => (
                        <span
                          key={pip}
                          className={`h-1.5 w-4 rounded-full ${
                            pip < skill.filled ? skill.tone : 'bg-mist'
                          }`}
                        />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-line/70 rounded-[1.15rem] border bg-white p-5 sm:p-6">
              <h3 className="font-display text-deep text-xl font-extrabold">Certifications</h3>
              <p className="text-muted mt-1 text-[0.8125rem]">Flagged 45 days before expiry</p>
              <ul className="mt-5 flex flex-col gap-3">
                {CERTIFICATIONS.map((cert) => (
                  <li key={cert.name} className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cert.chip}`}
                    >
                      <Icon name={cert.icon} className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-deep block truncate text-[0.9375rem] font-semibold">
                        {cert.name}
                      </span>
                      <span className="text-muted block truncate text-[0.8125rem]">
                        {cert.detail}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-[0.6875rem] font-semibold ${cert.tone}`}
                    >
                      {cert.badge}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <p className="border-accent/20 bg-lift text-quiet mt-6 flex gap-3 rounded-2xl border px-5 py-4 text-[0.9375rem] leading-[1.6]">
          <Icon name="info" className="text-accent-strong mt-0.5 h-5 w-5 shrink-0" />
          <span>
            <strong className="text-deep font-semibold">No meaningless points.</strong> Badges map
            to skills, skills map to stations, and stations map to the schedule. When someone levels
            up, the shifts they can be trusted with change too — and the schedule knows it.
          </span>
        </p>
      </Container>
    </section>
  )
}

function StepMark({ state, index }: { state: string; index: number }) {
  if (state === 'done') {
    return (
      <span className="bg-success flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
        <Icon name="check" className="h-3.5 w-3.5 text-white" />
      </span>
    )
  }
  const label = String(index + 1).padStart(2, '0')
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[0.5625rem] ${
        state === 'active' ? 'border-accent text-accent' : 'border-line-strong text-faint'
      }`}
    >
      {label}
    </span>
  )
}

function Industries() {
  return (
    <section
      id="industries"
      className={`relative scroll-mt-24 overflow-hidden bg-white ${SECTION}`}
    >
      <Container className="relative">
        <div className="max-w-[46rem]">
          <p className="text-coral-700 font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
            Industry templates
          </p>
          <h2 className="font-display text-deep mt-5 text-[2.5rem] leading-[0.98] font-extrabold tracking-[-0.025em] text-balance sm:text-[3.5rem]">
            Start from your industry, then{' '}
            <span className="text-accent font-serif italic">bend it to your business.</span>
          </h2>
          <p className="text-quiet mt-7 text-[1.0625rem] leading-[1.65]">
            Every template arrives with the roles, checklists, training paths and certification
            types that business already uses — then every one of them is yours to rename, reorder or
            delete.
          </p>
        </div>
        <div data-reveal className="mt-12">
          <IndustryTabs industries={INDUSTRIES} />
        </div>
      </Container>
    </section>
  )
}

function Rollout() {
  return (
    <section id="rollout" className={`bg-lift relative scroll-mt-24 overflow-hidden ${SECTION}`}>
      <Container className="relative">
        <div className="max-w-[46rem]">
          <p className="text-coral-700 font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
            Rollout
          </p>
          <h2 className="font-display text-deep mt-5 text-[2.5rem] leading-[0.98] font-extrabold tracking-[-0.025em] text-balance sm:text-[3.5rem]">
            Live in three weeks,{' '}
            <span className="text-accent font-serif italic">without a project manager.</span>
          </h2>
          <p className="text-quiet mt-7 text-[1.0625rem] leading-[1.65]">
            The order matters: get people in, then get standards in, then turn it over to the floor.
            Most single-location businesses finish sooner.
          </p>
        </div>

        <ol className="mt-14 grid gap-8 md:grid-cols-3 md:gap-6">
          {ROLLOUT.map((step, index) => (
            <li
              key={step.week}
              data-reveal
              style={{ '--reveal-index': index } as React.CSSProperties}
            >
              <span className={`block h-[3px] w-full rounded-full ${step.line}`} />
              <p className="text-faint mt-4 font-mono text-[0.625rem] tracking-[0.16em] uppercase">
                {step.week}
              </p>
              <h3 className="font-display text-deep mt-2 text-lg font-extrabold">{step.title}</h3>
              <p className="text-quiet mt-2.5 text-[0.9375rem] leading-[1.6]">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  )
}

/**
 * THE CLOSING TOUT.
 *
 * The one place on the page that keeps the graphic language round 2 asked for:
 * a deep green field with oversized circles in rust, peach and navy, and the
 * words carried on a cream card floating over the middle of it. Everywhere
 * else the backgrounds are plain, so this reads as the page arriving
 * somewhere rather than as more decoration.
 */
function FinalCta() {
  return (
    <>
      {/* The page arrives at the tout through a shape, not an edge. */}
      <SectionBreak from="cream" peak={44} />
      <section className="relative overflow-hidden bg-teal-800">
        {/* The field. Oversized and cropped, so each shape is a fragment. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <span className="bg-coral-600 absolute -top-[14rem] -left-[16rem] size-[40rem] rounded-full" />
          <span className="bg-coral-200 absolute -top-[11rem] left-[52%] size-[22rem] rounded-full" />
          <span className="absolute -right-[14rem] -bottom-[18rem] size-[34rem] rounded-full bg-[#2f4a6b]" />
        </div>

        <Container className="relative py-16 sm:py-24">
          <div
            data-reveal
            className="bg-lift mx-auto max-w-[62rem] rounded-[2rem] px-6 py-14 text-center shadow-[0_46px_90px_-40px_rgb(0_0_0/0.55)] sm:rounded-[2.5rem] sm:px-16 sm:py-20"
          >
            <h2 className="font-display text-deep text-[2.25rem] leading-[0.98] font-extrabold tracking-[-0.025em] text-balance sm:text-[3.25rem]">
              Give every shift
              <br className="hidden sm:block" /> the{' '}
              <span className="text-accent font-serif italic">same answer.</span>
            </h2>
            <p className="text-quiet mx-auto mt-6 max-w-[34rem] text-[1rem] leading-[1.65]">
              Pilot businesses are set up with our team. Import a roster, publish a week, and let
              your team see what’s happening, what’s expected, what they’ve finished and what comes
              next.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href="/contact"
                className="bg-accent hover:bg-accent-strong group ease-calm inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[0.9375rem] font-semibold text-white shadow-[0_16px_32px_-16px_rgb(42_92_90/0.9)] transition-[background-color,translate,box-shadow] duration-[320ms] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
              >
                Ask about a pilot
                <Icon
                  name="arrow"
                  className="ease-calm h-4 w-4 transition-transform duration-[320ms] group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
              <Link
                href="/contact"
                className="border-line-strong text-deep hover:border-accent/60 hover:text-accent-strong ease-calm inline-flex min-h-12 items-center rounded-full border bg-white px-7 text-[0.9375rem] font-semibold transition-[color,border-color,translate,box-shadow] duration-[320ms] hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-18px_rgb(20_32_44/0.4)] motion-reduce:hover:translate-y-0"
              >
                Book a 20-minute walkthrough
              </Link>
            </div>
            <p className="text-muted mt-10 text-[0.8125rem]">
              Pricing agreed with each pilot · No card taken online · Your data exports whenever you
              ask
            </p>
          </div>
        </Container>
      </section>
    </>
  )
}
