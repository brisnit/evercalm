import type { Metadata } from 'next'
import Link from 'next/link'
import { Container, SECTION, SectionHeading } from './_home/parts'
import { HeroVideo } from './_home/hero-video'
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
    title: 'Announcements',
    body: 'Post to a location, a role, or a shift — and see who has actually read it.',
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
    title: 'Pre-shift routines',
    body: 'The huddle note, the 86 list, the special, the focus of the night — written once, read by everyone on.',
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
      <Promise />
      <Platform />
      <Experiences />
      <Training />
      <Industries />
      <Rollout />
      <FinalCta />
    </>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Two soft corner glows on white: sage at the top left, sand at the right. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(52rem_26rem_at_-2%_-14%,#e2f0ea_0%,#f1f8f5_38%,transparent_72%),radial-gradient(48rem_28rem_at_104%_-8%,#faf2e6_0%,#fdfbf8_40%,transparent_74%)]"
      />
      {/*
        Two columns with a firm gutter between them. The hero film is laid out
        entirely inside its own column (see hero-video.tsx) - nothing in it may
        reach into the text, at any width. Guarded by a browser test that
        measures the bounds.
      */}
      <Container className="relative grid items-center gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:py-26 xl:gap-16 [&>*]:min-w-0">
        <div data-testid="hero-copy">
          <p className="border-line/70 inline-flex items-center gap-2.5 rounded-full border bg-white/80 py-1.5 pr-4 pl-1.5 text-[0.8125rem] font-medium">
            <span className="bg-accent flex h-6 w-6 items-center justify-center rounded-full">
              <Icon name="check" className="h-3.5 w-3.5 text-white" />
            </span>
            <span className="text-deep">Built for shift-based teams, not desk-based ones</span>
          </p>

          {/* Steps down only between 1024 and 1280px, where the column is too
              narrow for "Everyone walks" at full size and would break it. */}
          <h1
            data-testid="hero-headline"
            className="font-display text-deep mt-6 text-[2.75rem] leading-[1.02] font-extrabold tracking-[-0.015em] sm:text-[4.125rem] lg:text-[3.625rem] xl:text-[4.125rem]"
          >
            Everyone walks
            <br />
            in knowing
            <br />
            <span className="text-accent decoration-accent underline decoration-[0.14em] underline-offset-[0.18em]">
              What’s next.
            </span>
          </h1>

          <p
            data-testid="hero-description"
            className="text-quiet mt-7 max-w-[34rem] text-[1.0625rem] leading-[1.7]"
          >
            EverCalm is one platform for onboarding, training, scheduling, communication, and the
            daily run of the floor. Managers stop rebuilding the same spreadsheet every week. Staff
            open one app and see their shift, their tasks, and their progress.
          </p>

          <div data-testid="hero-actions" className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/contact"
              className="bg-accent hover:bg-accent-strong group inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[0.9375rem] font-semibold text-white shadow-[0_10px_24px_-12px_rgb(107_77_241/0.7)] transition-[background-color,box-shadow,transform] duration-200 hover:shadow-[0_14px_28px_-12px_rgb(107_77_241/0.8)] active:translate-y-px"
            >
              Ask about a pilot
              <Icon
                name="arrow"
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </Link>
            <Link
              href="/#platform"
              className="border-line-strong text-deep hover:border-accent/60 hover:text-accent-strong inline-flex min-h-12 items-center rounded-full border bg-white px-6 text-[0.9375rem] font-semibold transition-colors duration-200 active:translate-y-px"
            >
              See the shift board
            </Link>
          </div>

          <p
            data-testid="hero-proof"
            className="text-muted mt-6 flex flex-wrap gap-x-6 gap-y-1.5 text-[0.8125rem]"
          >
            <span>
              <strong className="text-deep font-semibold">Pilot</strong> pricing agreed with you
            </span>
            <span>
              <strong className="text-deep font-semibold">14 min</strong> to import a roster
            </span>
            <span>
              <strong className="text-deep font-semibold">No</strong> credit card
            </span>
          </p>
        </div>

        <HeroVideo />
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
    <section className={SECTION}>
      <Container>
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <SectionHeading
            eyebrow="The promise"
            title={
              <>
                Four questions, answered
                <br className="hidden sm:block" /> before anyone has to ask.
              </>
            }
            lead="Most shift-based teams lose hours a week to the same four unknowns — relayed by group text, sticky note, and whoever happens to be on. EverCalm answers all four in one place, for every person, every day."
          />
          <div data-reveal className="hidden lg:block">
            <LifestylePhoto image={IMAGERY.prepForService} sizes="272px" />
          </div>
        </div>

        <div className="mt-14">
          <div className="border-line/70 text-faint hidden grid-cols-4 border-t pt-3 font-mono text-[0.625rem] tracking-[0.14em] uppercase lg:grid">
            {PROMISE.map((item) => (
              <span key={item.marker} className="last:text-right">
                {item.marker}
              </span>
            ))}
          </div>

          <div className="relative mt-3">
            <span
              aria-hidden="true"
              className="absolute top-4 right-4 left-4 hidden h-px bg-[linear-gradient(90deg,#2a5c5a_0%,#7fb5a0_38%,#e8856c_68%,#f5e6d3_100%)] lg:block"
            />
            <ol className="relative grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {PROMISE.map((item, index) => (
                <li
                  key={item.title}
                  data-reveal
                  style={{ '--reveal-index': index } as React.CSSProperties}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white ${item.tone}`}
                  >
                    <Icon name={item.icon} className="h-4 w-4" />
                  </span>
                  <h3 className="font-display text-deep mt-4 text-lg font-extrabold">
                    {item.title}
                  </h3>
                  <p className="text-quiet mt-2.5 text-[0.9375rem] leading-[1.6]">{item.body}</p>
                  <p className="border-line-strong text-muted mt-4 border-l-2 pl-3 text-[0.8125rem] italic">
                    {item.quote}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Container>
    </section>
  )
}

function Platform() {
  return (
    <section id="platform" className={`bg-mist scroll-mt-24 ${SECTION}`}>
      <Container>
        <SectionHeading
          eyebrow="The platform"
          title={
            <>
              One system for the
              <br className="hidden sm:block" /> whole operation.
            </>
          }
          lead="People, training, schedules, and daily operations were never separate problems. EverCalm keeps them in one record, so a new hire’s certification, availability, and closing duties all belong to the same person."
        />

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((item, index) => (
            <li
              key={item.title}
              data-reveal
              style={{ '--reveal-index': index % 4 } as React.CSSProperties}
              className="border-line/60 hover:border-accent/30 rounded-2xl border bg-white p-4 transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-16px_rgb(23_18_64/0.3)] motion-reduce:hover:translate-y-0"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-[0.7rem] ${item.chip}`}
              >
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <h3 className="font-display text-deep mt-3.5 text-[0.9375rem] font-extrabold">
                {item.title}
              </h3>
              <p className="text-quiet mt-1.5 text-[0.8125rem] leading-[1.55]">{item.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

function Experiences() {
  return (
    <section id="experiences" className={`scroll-mt-24 ${SECTION}`}>
      <Container>
        <SectionHeading
          eyebrow="Two experiences"
          title={
            <>
              Depth for the people running
              <br className="hidden sm:block" /> it. Simplicity for everyone else.
            </>
          }
          lead="An operations platform fails the moment your staff stop opening it. So the manager side holds everything, and the employee side holds only what that person needs to know right now."
        />

        <div className="mt-10 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <ExperienceCard
            photo={IMAGERY.managerCheckIn}
            audience="Owners, HR & managers"
            audienceClass="bg-teal-50 text-teal-700"
            title="The console"
            lead="One place to build the week, spot the gap, and prove it happened."
            points={CONSOLE_POINTS}
            checkClass="bg-teal-100 text-teal-700"
          />
          <ExperienceCard
            photo={IMAGERY.stylistStation}
            audience="Employees"
            audienceClass="bg-info-soft text-info"
            title="The app"
            lead="Open it, and the answer is already on the screen. No hunting, no training required."
            points={APP_POINTS}
            checkClass="bg-info-soft text-info"
          />
        </div>
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
}: {
  audience: string
  audienceClass: string
  title: string
  lead: string
  points: string[][]
  checkClass: string
  photo: (typeof IMAGERY)[keyof typeof IMAGERY]
}) {
  return (
    <div data-reveal className="border-line/70 rounded-[1.15rem] border bg-white p-5 sm:p-6">
      <LifestylePhoto image={photo} sizes="(min-width: 1024px) 520px, 100vw" className="mb-5" />
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
    <section id="industries" className={`scroll-mt-24 ${SECTION}`}>
      <Container>
        <SectionHeading
          eyebrow="Industry templates"
          title={
            <>
              Start from your industry, then
              <br className="hidden sm:block" /> bend it to your business.
            </>
          }
          lead="Every template arrives with the roles, checklists, training paths, and certification types that business already uses — then every one of them is yours to rename, reorder, or delete."
        />
        <div data-reveal className="mt-10">
          <IndustryTabs industries={INDUSTRIES} />
        </div>
      </Container>
    </section>
  )
}

function Rollout() {
  return (
    <section id="rollout" className={`bg-lift scroll-mt-24 ${SECTION}`}>
      <Container>
        <SectionHeading
          eyebrow="Rollout"
          title={
            <>
              Live in three weeks,
              <br className="hidden sm:block" /> without a project manager.
            </>
          }
          lead="The order matters: get people in, then get standards in, then turn it over to the floor. Most single-location businesses finish sooner."
        />

        <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
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

function FinalCta() {
  return (
    <section className="pt-16 pb-32 sm:pt-24 sm:pb-48">
      <Container>
        <div data-reveal className="mb-6">
          <LifestylePhoto
            image={IMAGERY.closingTogether}
            sizes="(min-width: 1168px) 1128px, 100vw"
          />
        </div>
        <div
          data-reveal
          className="rounded-[1.5rem] bg-[linear-gradient(to_top_right,#1c3c3b_0%,#2a5c5a_52%,#35706d_100%)] px-6 py-14 text-center sm:px-12"
        >
          <h2 className="font-display text-[1.75rem] leading-[1.15] font-extrabold tracking-[-0.02em] text-balance text-white sm:text-[2.35rem]">
            Give every shift the same answer.
          </h2>
          <p className="mx-auto mt-4 max-w-[38rem] text-[0.9375rem] leading-[1.7] text-white/85">
            Pilot businesses are set up with our team. Import a roster, publish a week, and let your
            team see what’s happening, what’s expected, what they’ve finished, and what comes next.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/contact"
              className="text-deep inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-6 text-[0.9375rem] font-semibold hover:bg-white/90"
            >
              Ask about a pilot
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex min-h-12 items-center rounded-full border border-white/50 px-6 text-[0.9375rem] font-semibold text-white hover:bg-white/10"
            >
              Book a 20-minute walkthrough
            </Link>
          </div>
          <p className="mt-6 text-[0.8125rem] text-white/75">
            Pricing agreed with each pilot · No card taken online · Your data exports whenever you
            ask
          </p>
        </div>
      </Container>
    </section>
  )
}
