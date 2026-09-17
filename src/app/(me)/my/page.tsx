import type { Metadata } from 'next'
import { formatCalendarDate } from '@/lib/dates'
import Link from 'next/link'
import { EmployeeHeader } from './_components/employee-shell'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getEmployment, listCredentials } from '@/modules/people/service'
import { getProgressForEmployment } from '@/modules/onboarding/service'
import { inboxDigest } from '@/modules/comms/inbox'
import { nextShift } from '@/modules/scheduling/employee'
import { myTraining, type MyTraining } from '@/modules/training/learner'
import { myShiftWorkSummary, type ShiftWorkSummary } from '@/modules/operations/work'
import { handoffsForMe } from '@/modules/operations/handoffs'
import { HandoffCard } from '@/ui/patterns/handoff-card'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { cn } from '@/lib/cn'
import { ToolCard } from '@/ui/patterns/tool-card'
import type { ToolIconName } from '@/ui/patterns/tool-icon'
import { Badge, ButtonLink, Card, CardHeader } from '@/ui/primitives'

export const metadata: Metadata = { title: 'My work' }
export const dynamic = 'force-dynamic'

/**
 * Employee home - mobile-first, and a separate information architecture from
 * /app rather than a narrowed version of it.
 *
 * A launcher: anything that must not wait (a message to confirm, an urgent
 * notice, a credential running out) in full view, then one card for each
 * place a person goes - their shift, schedule, next onboarding step, training
 * and messages - each with a single line. Detail is one tap away.
 */
export default async function MyWorkPage() {
  const { actor } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => ({
    me: await getEmployment(tx, actor, actor.employmentId),
    onboarding: await getProgressForEmployment(tx, actor, actor.employmentId),
    credentials: await listCredentials(tx, actor, actor.employmentId),
    inbox: await inboxDigest(tx, actor, actor.employmentId),
    nextShift: await nextShift(tx, actor),
    training: await myTraining(tx, actor),
    shiftWork: await myShiftWorkSummary(tx, actor),
    handedToMe: await handoffsForMe(tx, actor),
  }))

  // When onboarding's next step IS a course, there is one next action, not two:
  // the onboarding card links straight to the lesson and the training card
  // does not repeat it.
  const onboardingStep = data.onboarding?.steps.find(
    (s) => s.status === 'pending' && s.title === data.onboarding?.nextAction,
  )
  const onboardingLesson =
    onboardingStep?.training?.assignmentId && onboardingStep.training.nextLessonId
      ? {
          assignmentId: onboardingStep.training.assignmentId,
          href: `/my/training/${onboardingStep.training.assignmentId}/lessons/${onboardingStep.training.nextLessonId}`,
          courseTitle: onboardingStep.training.courseTitle,
        }
      : null

  // Something blocked elsewhere in onboarding must not read as "stop" when the
  // next action is one the person can do now. The whole run is still blocked
  // for their manager's board; here it is counted, and the next action leads.
  const waitingItems = data.onboarding?.steps.filter((s) => s.status === 'blocked').length ?? 0
  const nextIsActionable =
    !!data.onboarding?.nextAction &&
    !/^(Blocked|Waiting for sign-off|Waiting on EverCalm):/.test(data.onboarding.nextAction)
  const carryOn = data.onboarding?.state === 'blocked' && nextIsActionable && waitingItems > 0

  const hasAdminAccess = actor.grants.some((g) => g.capabilities.size > 0)
  const firstName = actor.displayName.split(' ')[0] ?? actor.displayName
  const inboxDemands = data.inbox.acknowledgementsDue > 0 || data.inbox.urgentUnread > 0
  const attentionCredentials = data.credentials.filter(
    (c) => c.expiryState === 'expired' || c.expiryState === 'expiring_soon',
  )

  const cards = homeCards({
    shiftWork: data.shiftWork,
    nextShift: data.nextShift,
    onboarding: data.onboarding
      ? {
          nextAction: data.onboarding.nextAction,
          state: data.onboarding.state,
          requiredDone: data.onboarding.requiredDone,
          requiredTotal: data.onboarding.requiredTotal,
          carryOn,
        }
      : null,
    onboardingLesson,
    training: data.training,
    inbox: data.inbox,
  })

  return (
    <div className="flex min-h-screen flex-col">
      <EmployeeHeader
        back={null}
        extra={
          hasAdminAccess ? (
            <Link href="/app" className="text-muted text-sm underline-offset-4 hover:underline">
              Administration
            </Link>
          ) : null
        }
      />

      <main
        id="main"
        className="mx-auto w-full max-w-xl flex-1 px-4 py-6 sm:px-5 sm:py-7 md:max-w-3xl"
      >
        <h1 className="font-display text-ink text-[1.625rem] leading-tight font-extrabold tracking-tight">
          Hello, {firstName}
        </h1>
        <p className="text-muted mt-1 text-sm">{data.me.jobTitle ?? 'Team member'}</p>

        <div className="mt-5 flex flex-col gap-4">
          {/*
            What must not wait stays in full view above the launcher: a message
            to confirm, an urgent or safety notice, a credential running out.
          */}
          {inboxDemands ? <InboxCallout digest={data.inbox} /> : null}

          {data.handedToMe.length > 0 ? (
            <NoticeProvider>
              <section
                aria-labelledby="handed-to-you"
                data-testid="handed-to-you"
                className="rounded-card flex flex-col gap-3 border border-teal-300 bg-white p-4 sm:p-5"
              >
                <div>
                  <p className="text-coral-700 text-sm font-semibold">Handed to you</p>
                  <h2 id="handed-to-you" className="font-display text-ink text-lg font-extrabold">
                    {data.handedToMe.length === 1
                      ? '1 task left for you'
                      : `${data.handedToMe.length} tasks left for you`}
                  </h2>
                </div>
                {data.handedToMe.map((handoff) => (
                  <HandoffCard key={handoff.id} handoff={handoff} />
                ))}
              </section>
            </NoticeProvider>
          ) : null}

          {attentionCredentials.length > 0 ? (
            <Card>
              <CardHeader title="Your credentials need attention" />
              <ul className="divide-line divide-y">
                {attentionCredentials.map((credential) => (
                  <li
                    key={credential.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <span className="min-w-0">
                      <span className="text-ink block truncate text-sm font-medium">
                        {credential.name}
                      </span>
                      <span className="text-muted block text-xs">
                        {credential.issuingAuthority ?? 'No issuing authority'}
                      </span>
                    </span>
                    <Badge tone={credential.expiryState === 'expired' ? 'danger' : 'warning'}>
                      {credential.expiryState === 'expired'
                        ? `Expired ${formatCalendarDate(credential.expiresOn!)}`
                        : `${credential.daysUntilExpiry} days`}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <nav aria-label="Your tools">
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {cards.map((card, index) => (
                <li
                  key={card.key}
                  className={cn(
                    'min-w-0',
                    index === 0 && cards.length % 2 === 1 && 'col-span-2 md:col-span-3',
                  )}
                >
                  <ToolCard
                    size={index === 0 && cards.length % 2 === 1 ? 'sm' : 'md'}
                    href={card.href}
                    label={card.label}
                    icon={card.icon}
                    status={card.status}
                    tone={card.tone}
                    heading="h2"
                    className="h-full"
                    testId={card.testId}
                  />
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </main>
    </div>
  )
}

interface HomeCard {
  key: string
  label: string
  href: string
  icon: ToolIconName
  status: string
  tone: 'calm' | 'attention'
  testId: string
}

/**
 * The five places an employee goes from Home, each with one line. Detail -
 * progress bars, task lists, message previews - lives one tap away. A course
 * that onboarding is already pointing at is not offered again under training.
 */
function homeCards({
  shiftWork,
  nextShift: next,
  onboarding,
  onboardingLesson,
  training,
  inbox,
}: {
  shiftWork: ShiftWorkSummary | null
  nextShift: { id: string; day: string; time: string; endsNextDay: boolean } | null
  onboarding: {
    nextAction: string | null
    state: string
    requiredDone: number
    requiredTotal: number
    carryOn: boolean
  } | null
  onboardingLesson: { assignmentId: string; href: string; courseTitle: string } | null
  training: MyTraining
  inbox: { unreadCount: number; acknowledgementsDue: number }
}): HomeCard[] {
  const cards: HomeCard[] = []

  if (shiftWork && shiftWork.phase === 'during') {
    const left = shiftWork.progress.open
    cards.push({
      key: 'shift',
      label: 'On now',
      href: `/my/shift?shift=${shiftWork.shiftId}`,
      icon: 'clock',
      status:
        shiftWork.needsAttention > 0
          ? `${shiftWork.time} · ${shiftWork.needsAttention} ${shiftWork.needsAttention === 1 ? 'task needs' : 'tasks need'} you`
          : left > 0
            ? `${shiftWork.time} · ${left} to do`
            : `${shiftWork.time} · all done`,
      tone: shiftWork.needsAttention > 0 ? 'attention' : 'calm',
      testId: 'shift-work-card',
    })
  } else {
    const upcoming = shiftWork ?? next
    cards.push({
      key: 'shift',
      label: 'My shift',
      href: shiftWork ? `/my/shift?shift=${shiftWork.shiftId}` : '/my/shift',
      icon: 'clock',
      status: upcoming
        ? `${upcoming.day} · ${upcoming.time}${upcoming.endsNextDay ? ' (next day)' : ''}`
        : 'No shift coming up',
      tone: 'calm',
      testId: shiftWork ? 'shift-work-card' : 'my-shift-card',
    })
  }

  cards.push({
    key: 'schedule',
    label: 'Your schedule',
    href: '/my/schedule',
    icon: 'calendar',
    status: next ? 'Shifts, time off and availability' : 'Nothing published for you yet',
    tone: 'calm',
    testId: 'schedule-card',
  })

  if (onboarding) {
    const done = !onboarding.nextAction
    cards.push({
      key: 'next',
      label: done ? 'Onboarding' : 'Do this next',
      href: '/my/onboarding',
      icon: 'next',
      status: done
        ? 'All caught up'
        : `${onboarding.nextAction}${onboarding.state === 'overdue' ? ' · overdue' : ''}`,
      tone: !done && onboarding.state === 'overdue' ? 'attention' : 'calm',
      testId: 'onboarding-card',
    })
  }

  cards.push({
    key: 'training',
    label: 'Your training',
    href: '/my/training',
    icon: 'book',
    status: trainingLine(training, onboardingLesson?.assignmentId ?? null),
    tone: training.overview.active.some((a) => a.due.kind === 'past') ? 'attention' : 'calm',
    testId: 'training-card',
  })

  cards.push({
    key: 'messages',
    label: 'Messages',
    href: '/my/inbox',
    icon: 'inbox',
    status: inboxDescription(inbox),
    tone: inbox.acknowledgementsDue > 0 || inbox.unreadCount > 0 ? 'attention' : 'calm',
    testId: 'messages-card',
  })

  return cards
}

function trainingLine(training: MyTraining, onboardingAssignmentId: string | null): string {
  const { overview } = training
  const active = overview.active.filter((a) => a.id !== onboardingAssignmentId)
  if (active.length === 0) {
    if (onboardingAssignmentId) return 'Your next course is in onboarding'
    return overview.completed.length > 0 ? 'All caught up' : 'Nothing assigned yet'
  }
  return `${active.length} ${active.length === 1 ? 'course' : 'courses'} to finish`
}

/** The Messages card's line, in plain words. */
function inboxDescription(digest: { unreadCount: number; acknowledgementsDue: number }): string {
  if (digest.acknowledgementsDue > 0) {
    return `${digest.acknowledgementsDue} ${
      digest.acknowledgementsDue === 1 ? 'message needs' : 'messages need'
    } your confirmation`
  }
  if (digest.unreadCount > 0) {
    return `${digest.unreadCount} unread ${digest.unreadCount === 1 ? 'message' : 'messages'}`
  }
  return 'Everything is read'
}

/**
 * The demanding version, shown above onboarding.
 *
 * Deliberately not a modal and not animated: it is a card that states what is
 * outstanding and links straight to it. An urgent notice earns attention by
 * being first and staying first, not by interrupting.
 */
function InboxCallout({
  digest,
}: {
  digest: {
    acknowledgementsDue: number
    overdueAcknowledgements: number
    urgentUnread: number
    headline: {
      announcementId: string
      title: string
      priority: string
      categoryName: string
    } | null
  }
}) {
  const heading =
    digest.acknowledgementsDue > 0
      ? `${digest.acknowledgementsDue} ${
          digest.acknowledgementsDue === 1 ? 'message needs' : 'messages need'
        } your confirmation`
      : `${digest.urgentUnread} urgent ${digest.urgentUnread === 1 ? 'message' : 'messages'} to read`

  return (
    <Card className="border-teal-300 p-5">
      <p className="text-coral-700 text-sm font-semibold">Needs you</p>
      <h2 className="font-display text-ink mt-1 text-lg font-extrabold">{heading}</h2>
      {digest.overdueAcknowledgements > 0 ? (
        <p className="text-warning mt-1.5 text-sm font-semibold">
          {digest.overdueAcknowledgements} past the due date.
        </p>
      ) : null}

      {digest.headline ? (
        <p className="text-muted mt-2 text-sm">
          Starting with &ldquo;{digest.headline.title}&rdquo;.
        </p>
      ) : null}

      <div className="mt-4">
        <ButtonLink
          href={digest.headline ? `/my/inbox/${digest.headline.announcementId}` : '/my/inbox'}
        >
          {digest.acknowledgementsDue > 0 ? 'Read and confirm' : 'Read it'}
        </ButtonLink>
      </div>
    </Card>
  )
}
