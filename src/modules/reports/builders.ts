import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import {
  announcementCategories,
  announcementRecipients,
  announcementRevisions,
  announcements,
  employmentCredentials,
  employments,
  handoffs,
  invitations,
  jobRoles,
  locations,
  notifications,
  openShiftClaims,
  opsRuns,
  opsTaskItems,
  opsTasks,
  shiftSwapRequests,
  shifts,
  stations,
  timeOffRequests,
} from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { ForbiddenError } from '@/lib/errors'
import { addCalendarDays, formatCalendarDate } from '@/lib/dates'
import { listProgress } from '@/modules/onboarding/service'
import { scopedAssignments, signoffQueue } from '@/modules/training/assignments'
import { formatShift, localDateOf, weekStartOf } from '@/modules/scheduling/time'
import { handoffCategoryLabel } from '@/modules/operations/rules'
import type { ReportFilters, ReportKey } from './filters'
import { REPORT_META, type Headline, type Report, type ReportRow, type ReportTable } from './model'
import { peopleInScope, resolveScope, roleFilter, type ReportScope } from './scope'

/*
 * THE FIVE REPORTS.
 *
 * Each builds on the modules that own the data - onboarding progress,
 * training assignments, the published schedule, shift work, announcement
 * receipts - rather than re-deriving their rules, and every figure is scoped
 * by resolveScope() before a row is read.
 */

const DAY = 86_400_000
const NIL = '00000000-0000-0000-0000-000000000000'
const ids = (list: readonly string[]) => (list.length ? [...list] : [NIL])

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ForbiddenError) return fallback
    throw error
  }
}

const tone = (n: number, level: 'attention' | 'urgent' = 'attention') => (n > 0 ? level : 'neutral')
const date = (iso: string | null) => (iso ? formatCalendarDate(iso) : null)

export interface BuildOptions {
  now?: Date
  /** Further limit to these locations (the export scope). */
  restrictTo?: readonly string[] | null
}

export async function buildReport(
  tx: Tx,
  actor: Actor,
  key: ReportKey,
  filters: ReportFilters,
  options: BuildOptions = {},
): Promise<{ report: Report; scope: ReportScope }> {
  const now = options.now ?? new Date()
  const scope = await resolveScope(tx, actor, key, filters, options.restrictTo ?? null)
  const builder = { people, training, schedule, operations, communications }[key]
  const built = await builder(tx, actor, scope, filters, now)
  if (scope.partial) {
    built.notes.unshift(
      `Covers ${scope.locations.map((l) => l.name).join(', ') || 'no locations'}: the locations you can report on${filters.locationId ? ' that match your filter' : ''}.`,
    )
  }
  return { report: { key, ...REPORT_META[key], ...built }, scope }
}

type Built = Pick<Report, 'headlines' | 'tables' | 'notes'>

// ---------------------------------------------------------------------------
// People and compliance
// ---------------------------------------------------------------------------

const ONBOARDING_STATE: Record<string, string> = {
  blocked: 'Blocked',
  overdue: 'Overdue',
  in_progress: 'In progress',
  not_started: 'Not started',
  completed: 'Completed',
}

async function people(
  tx: Tx,
  actor: Actor,
  scope: ReportScope,
  filters: ReportFilters,
  now: Date,
): Promise<Built> {
  const org = actor.organizationId
  const staff = await peopleInScope(tx, org, scope, filters)
  const personIds = [...staff.keys()]
  const rangeEnd = new Date(`${addCalendarDays(filters.to, 1)}T00:00:00Z`)

  const progress = (await safely(() => listProgress(tx, actor), [])).filter(
    (p) =>
      staff.has(p.employmentId) &&
      (p.completedAt === null || localDateOf(p.completedAt, 'UTC') >= filters.from),
  )
  const onboardingRows: ReportRow[] = progress
    .filter(
      (p) =>
        p.completedAt === null ||
        (localDateOf(p.completedAt, 'UTC') >= filters.from &&
          localDateOf(p.completedAt, 'UTC') <= filters.to),
    )
    .map((p) => {
      const blocked = p.steps.find((s) => s.status === 'blocked')
      return {
        cells: {
          person: p.employeeName,
          locations: staff.get(p.employmentId)?.locationNames.join(', ') ?? '',
          checklist: p.templateName,
          started: date(p.startedOn),
          due: date(p.dueOn),
          state: ONBOARDING_STATE[p.state] ?? p.state,
          steps: `${p.requiredDone} of ${p.requiredTotal}`,
          waitingOn: blocked
            ? `${blocked.title}: ${blocked.blockedReason ?? 'blocked'}`
            : (p.nextAction ?? ''),
        },
        href: `/app/people/${p.employmentId}`,
      }
    })

  const [credentialRows, ackRows, changeRows, inviteRows] = await Promise.all([
    tx
      .select({
        employmentId: employmentCredentials.employmentId,
        name: employmentCredentials.name,
        expiresOn: employmentCredentials.expiresOn,
      })
      .from(employmentCredentials)
      .where(
        and(
          eq(employmentCredentials.organizationId, org),
          inArray(employmentCredentials.employmentId, ids(personIds)),
          isNotNull(employmentCredentials.expiresOn),
          lte(employmentCredentials.expiresOn, addCalendarDays(filters.to, 45)),
        ),
      )
      .orderBy(asc(employmentCredentials.expiresOn)),
    tx
      .select({
        employmentId: announcementRecipients.employmentId,
        announcementId: announcements.id,
        title: announcementRevisions.title,
        dueAt: announcements.acknowledgementDueAt,
      })
      .from(announcementRecipients)
      .innerJoin(
        announcements,
        and(
          eq(announcements.organizationId, announcementRecipients.organizationId),
          eq(announcements.id, announcementRecipients.announcementId),
        ),
      )
      .innerJoin(
        announcementRevisions,
        and(
          eq(announcementRevisions.organizationId, announcements.organizationId),
          eq(announcementRevisions.id, announcements.currentRevisionId),
        ),
      )
      .where(
        and(
          eq(announcementRecipients.organizationId, org),
          inArray(announcementRecipients.employmentId, ids(personIds)),
          eq(announcements.status, 'published'),
          eq(announcements.requiresAcknowledgement, true),
          isNull(announcementRecipients.acknowledgedAt),
          lte(announcements.acknowledgementDueAt, now),
        ),
      )
      .orderBy(asc(announcements.acknowledgementDueAt)),
    tx
      .select({
        id: employments.id,
        name: employments.displayName,
        hiredOn: employments.hiredOn,
        separatedOn: employments.separatedOn,
      })
      .from(employments)
      .where(
        and(
          eq(employments.organizationId, org),
          inArray(employments.id, ids(personIds)),
          sql`((${employments.hiredOn} between ${filters.from} and ${filters.to}) or (${employments.separatedOn} between ${filters.from} and ${filters.to}))`,
        ),
      ),
    tx
      .select({
        name: invitations.displayName,
        createdAt: invitations.createdAt,
        expiresAt: invitations.expiresAt,
        homeLocationId: invitations.homeLocationId,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, org),
          eq(invitations.status, 'pending'),
          lte(invitations.createdAt, new Date(now.getTime() - 7 * DAY)),
        ),
      ),
  ])

  const today = localDateOf(now, scope.locations[0]?.timeZone ?? 'UTC')
  const credentialTable: ReportRow[] = credentialRows
    .filter((c) => staff.has(c.employmentId))
    .map((c) => ({
      cells: {
        person: staff.get(c.employmentId)!.name,
        locations: staff.get(c.employmentId)!.locationNames.join(', '),
        credential: c.name,
        expires: date(c.expiresOn),
        state: c.expiresOn! < today ? 'Expired' : 'Expiring within 45 days',
      },
      href: `/app/people/${c.employmentId}`,
    }))
  const ackTable: ReportRow[] = ackRows.map((a) => ({
    cells: {
      person: staff.get(a.employmentId)?.name ?? '',
      announcement: a.title,
      due: a.dueAt ? formatCalendarDate(a.dueAt.toISOString().slice(0, 10)) : null,
      daysOverdue: a.dueAt ? Math.max(0, Math.floor((now.getTime() - a.dueAt.getTime()) / DAY)) : 0,
    },
    href: `/app/comms/${a.announcementId}`,
  }))
  const changeTable: ReportRow[] = changeRows.flatMap((c) => [
    ...(c.hiredOn && c.hiredOn >= filters.from && c.hiredOn <= filters.to
      ? [
          {
            cells: { person: c.name, change: 'Joined', on: date(c.hiredOn) },
            href: `/app/people/${c.id}`,
          },
        ]
      : []),
    ...(c.separatedOn && c.separatedOn >= filters.from && c.separatedOn <= filters.to
      ? [
          {
            cells: { person: c.name, change: 'Left', on: date(c.separatedOn) },
            href: `/app/people/${c.id}`,
          },
        ]
      : []),
  ])
  const inScopeInvite = (homeLocationId: string | null) =>
    homeLocationId
      ? scope.locationIds.includes(homeLocationId)
      : !scope.partial && !filters.locationId
  const inviteTable: ReportRow[] =
    filters.departmentId || filters.jobRoleId
      ? []
      : inviteRows
          .filter((i) => inScopeInvite(i.homeLocationId))
          .map((i) => ({
            cells: {
              person: i.name,
              invited: formatCalendarDate(i.createdAt.toISOString().slice(0, 10)),
              expires: formatCalendarDate(i.expiresAt.toISOString().slice(0, 10)),
            },
            href: '/app/people/invitations',
          }))
  void rangeEnd

  const blocked = progress.filter((p) => p.state === 'blocked').length
  const overdue = progress.filter((p) => p.state === 'overdue').length
  const expired = credentialTable.filter((r) => r.cells.state === 'Expired').length
  const completed = progress.filter(
    (p) => p.completedAt && localDateOf(p.completedAt, 'UTC') <= filters.to,
  ).length

  const headlines: Headline[] = [
    {
      label: 'Onboarding blocked',
      value: blocked,
      detail: 'waiting on someone',
      tone: tone(blocked, 'urgent'),
      tableId: 'onboarding',
    },
    {
      label: 'Onboarding overdue',
      value: overdue,
      detail: 'past their due date',
      tone: tone(overdue),
      tableId: 'onboarding',
    },
    {
      label: 'Credentials expired',
      value: expired,
      detail: `${credentialTable.length - expired} more expiring soon`,
      tone: tone(expired, 'urgent'),
      tableId: 'credentials',
    },
    {
      label: 'Confirmations overdue',
      value: ackTable.length,
      detail: 'messages people have not confirmed',
      tone: tone(ackTable.length),
      tableId: 'acknowledgements',
    },
    {
      label: 'Onboarding completed',
      value: completed,
      detail: 'in this period',
      tone: completed > 0 ? 'good' : 'neutral',
      tableId: 'onboarding',
    },
  ]

  const tables: ReportTable[] = [
    {
      id: 'onboarding',
      title: 'Onboarding',
      description: 'Everyone onboarding, stuck work first.',
      columns: [
        { key: 'person', header: 'Person' },
        { key: 'locations', header: 'Locations' },
        { key: 'checklist', header: 'Checklist' },
        { key: 'started', header: 'Started' },
        { key: 'due', header: 'Due' },
        { key: 'state', header: 'State' },
        { key: 'steps', header: 'Required steps done' },
        { key: 'waitingOn', header: 'Waiting on or next' },
      ],
      rows: onboardingRows,
      empty: 'Nobody in this view is onboarding.',
    },
    {
      id: 'credentials',
      title: 'Credentials',
      description:
        'Expired, or expiring within 45 days of the end of the period. Credential numbers are never included.',
      columns: [
        { key: 'person', header: 'Person' },
        { key: 'locations', header: 'Locations' },
        { key: 'credential', header: 'Credential' },
        { key: 'expires', header: 'Expires' },
        { key: 'state', header: 'State' },
      ],
      rows: credentialTable,
      empty: 'No credentials are expired or expiring.',
    },
    {
      id: 'acknowledgements',
      title: 'Overdue confirmations',
      description: 'Messages people were asked to confirm, past the due date.',
      columns: [
        { key: 'person', header: 'Person' },
        { key: 'announcement', header: 'Message' },
        { key: 'due', header: 'Due' },
        { key: 'daysOverdue', header: 'Days overdue', numeric: true },
      ],
      rows: ackTable,
      empty: 'Everyone has confirmed what was due.',
    },
    {
      id: 'changes',
      title: 'Joined and left',
      description:
        'Employment start and end dates in the period. Reasons for leaving are not included.',
      columns: [
        { key: 'person', header: 'Person' },
        { key: 'change', header: 'Change' },
        { key: 'on', header: 'Date' },
      ],
      rows: changeTable,
      empty: 'Nobody joined or left in this period.',
    },
    {
      id: 'invitations',
      title: 'Invitations not accepted',
      description: 'Sent more than a week ago and still waiting.',
      columns: [
        { key: 'person', header: 'Name' },
        { key: 'invited', header: 'Invited' },
        { key: 'expires', header: 'Expires' },
      ],
      rows: inviteTable,
      empty:
        filters.departmentId || filters.jobRoleId
          ? 'Invitations are not filtered by department or role.'
          : 'No old invitations are waiting.',
    },
  ]
  return { headlines, tables, notes: [] }
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

async function training(
  tx: Tx,
  actor: Actor,
  scope: ReportScope,
  filters: ReportFilters,
  now: Date,
): Promise<Built> {
  const staff = await peopleInScope(tx, actor.organizationId, scope, filters)
  const inRangeDate = (d: Date | null) =>
    d !== null &&
    d.toISOString().slice(0, 10) >= filters.from &&
    d.toISOString().slice(0, 10) <= filters.to
  const rows = (
    await safely(
      () => scopedAssignments(tx, actor, { locationId: filters.locationId ?? undefined }, now),
      [],
    )
  ).filter(
    (r) => staff.has(r.employmentId) && (r.completedAt === null || inRangeDate(r.completedAt)),
  )
  const signoffs = (await safely(() => signoffQueue(tx, actor, now), [])).filter((s) =>
    staff.has(s.employmentId),
  )

  const attention = rows.filter((r) => r.status.key === 'overdue' || r.outOfAttempts.length > 0)
  const completed = rows.filter((r) => r.completedAt !== null)
  const requiredOpen = rows.filter((r) => r.required && r.completedAt === null)

  const assignmentRow = (r: (typeof rows)[number]): ReportRow => ({
    cells: {
      person: r.personName,
      locations: r.locationNames.join(', '),
      course: r.courseTitle,
      version: r.versionNumber,
      status: r.outOfAttempts.length ? `${r.status.label} · out of attempts` : r.status.label,
      progress: `${r.percent}%`,
      due: date(r.dueOn),
      bestScore: r.bestScore === null ? null : `${r.bestScore}%`,
      completed: r.completedAt
        ? formatCalendarDate(r.completedAt.toISOString().slice(0, 10))
        : null,
    },
    href: `/app/training/courses/${r.courseId}/people`,
  })

  const byCourse = new Map<
    string,
    { title: string; scores: number[]; out: number; assigned: number; done: number }
  >()
  for (const r of rows) {
    const entry = byCourse.get(r.courseId) ?? {
      title: r.courseTitle,
      scores: [],
      out: 0,
      assigned: 0,
      done: 0,
    }
    entry.assigned += 1
    if (r.completedAt) entry.done += 1
    if (r.bestScore !== null) entry.scores.push(r.bestScore)
    if (r.outOfAttempts.length) entry.out += 1
    byCourse.set(r.courseId, entry)
  }

  const columns = [
    { key: 'person', header: 'Person' },
    { key: 'locations', header: 'Locations' },
    { key: 'course', header: 'Course' },
    { key: 'version', header: 'Version', numeric: true },
    { key: 'status', header: 'Status' },
    { key: 'progress', header: 'Progress' },
    { key: 'due', header: 'Due' },
    { key: 'bestScore', header: 'Best knowledge-check score' },
    { key: 'completed', header: 'Completed' },
  ]
  const overdue = rows.filter((r) => r.status.key === 'overdue').length
  const outOfAttempts = rows.filter((r) => r.outOfAttempts.length > 0).length
  const slowSignoffs = signoffs.filter((s) => s.waitingDays >= 3).length

  return {
    headlines: [
      {
        label: 'Overdue',
        value: overdue,
        detail: 'past their due date',
        tone: tone(overdue, 'urgent'),
        tableId: 'attention',
      },
      {
        label: 'Waiting for sign-off',
        value: signoffs.length,
        detail: `${slowSignoffs} waiting 3 days or more`,
        tone: tone(slowSignoffs),
        tableId: 'signoffs',
      },
      {
        label: 'Out of attempts',
        value: outOfAttempts,
        detail: 'need a manager to allow another',
        tone: tone(outOfAttempts),
        tableId: 'attention',
      },
      {
        label: 'Required, not finished',
        value: requiredOpen.length,
        detail: 'assigned as required',
        tone: 'neutral',
        tableId: 'assignments',
      },
      {
        label: 'Completed',
        value: completed.length,
        detail: 'in this period',
        tone: completed.length ? 'good' : 'neutral',
        tableId: 'assignments',
      },
    ],
    tables: [
      {
        id: 'attention',
        title: 'Needs attention',
        description: 'Overdue, or out of knowledge-check attempts.',
        columns,
        rows: attention.map(assignmentRow),
        empty: 'Nothing is overdue or stuck.',
      },
      {
        id: 'signoffs',
        title: 'Practical sign-offs waiting',
        description: 'Oldest first. You see the ones you are able to sign off.',
        columns: [
          { key: 'person', header: 'Person' },
          { key: 'course', header: 'Course' },
          { key: 'practical', header: 'Practical' },
          { key: 'waiting', header: 'Days waiting', numeric: true },
        ],
        rows: signoffs.map((s) => ({
          cells: {
            person: s.personName,
            course: s.courseTitle,
            practical: s.lessonTitle,
            waiting: s.waitingDays,
          },
          href: '/app/training/sign-offs',
        })),
        empty: 'No practicals are waiting for you.',
      },
      {
        id: 'courses',
        title: 'Knowledge checks by course',
        description: 'Best scores of the people who have attempted them.',
        columns: [
          { key: 'course', header: 'Course' },
          { key: 'assigned', header: 'Assigned', numeric: true },
          { key: 'completed', header: 'Completed', numeric: true },
          { key: 'averageBest', header: 'Average best score' },
          { key: 'outOfAttempts', header: 'Out of attempts', numeric: true },
        ],
        rows: [...byCourse.entries()].map(([courseId, c]) => ({
          cells: {
            course: c.title,
            assigned: c.assigned,
            completed: c.done,
            averageBest: c.scores.length
              ? `${Math.round(c.scores.reduce((a, b) => a + b, 0) / c.scores.length)}%`
              : null,
            outOfAttempts: c.out,
          },
          href: `/app/training/courses/${courseId}/people`,
        })),
        empty: 'No training in this view.',
      },
      {
        id: 'assignments',
        title: 'All training',
        description: 'Open assignments, and those completed in the period.',
        columns,
        rows: rows.map(assignmentRow),
        empty: 'No training in this view.',
        shownLimit: 100,
      },
    ],
    notes: [],
  }
}

// ---------------------------------------------------------------------------
// Schedule and coverage
// ---------------------------------------------------------------------------

const TIME_OFF_STATUS: Record<string, string> = {
  pending: 'Waiting for a decision',
  approved: 'Approved',
  denied: 'Declined',
  cancelled: 'Withdrawn',
}
const SWAP_STATUS: Record<string, string> = {
  pending_recipient: 'Waiting for colleague',
  pending_manager: 'Waiting for manager',
  approved: 'Approved',
  declined: 'Declined by colleague',
  denied: 'Denied',
  cancelled: 'Withdrawn',
  expired: 'Expired',
}

async function schedule(
  tx: Tx,
  actor: Actor,
  scope: ReportScope,
  filters: ReportFilters,
  now: Date,
): Promise<Built> {
  const org = actor.organizationId
  const staff = await peopleInScope(tx, org, scope, filters)
  const personIds = [...staff.keys()]
  const roles = roleFilter(scope, filters)
  const tz = new Map(scope.locations.map((l) => [l.id, l]))
  const localDay = sql`(${shifts.publishedStartsAt} at time zone ${locations.timezone})::date`

  const shiftRows = await tx
    .select({
      id: shifts.id,
      locationId: shifts.locationId,
      startsAt: shifts.publishedStartsAt,
      endsAt: shifts.publishedEndsAt,
      breakMinutes: shifts.publishedBreakMinutes,
      assignee: shifts.publishedAssigneeEmploymentId,
      isOpen: shifts.publishedIsOpen,
      status: shifts.publishedStatus,
      roleName: jobRoles.name,
      stationName: stations.name,
    })
    .from(shifts)
    .innerJoin(
      locations,
      and(eq(locations.organizationId, shifts.organizationId), eq(locations.id, shifts.locationId)),
    )
    .leftJoin(
      jobRoles,
      and(
        eq(jobRoles.organizationId, shifts.organizationId),
        eq(jobRoles.id, shifts.publishedJobRoleId),
      ),
    )
    .leftJoin(
      stations,
      and(
        eq(stations.organizationId, shifts.organizationId),
        eq(stations.id, shifts.publishedStationId),
      ),
    )
    .where(
      and(
        eq(shifts.organizationId, org),
        inArray(shifts.locationId, ids(scope.locationIds)),
        isNotNull(shifts.publishedAt),
        sql`${localDay} between ${filters.from}::date and ${filters.to}::date`,
        roles === null ? undefined : inArray(shifts.publishedJobRoleId, ids(roles)),
      ),
    )
    .orderBy(asc(shifts.publishedStartsAt))

  const active = shiftRows.filter((s) => s.status === 'active')
  const coverage = scope.locations.map((l) => {
    const mine = active.filter((s) => s.locationId === l.id)
    const minutes = mine.reduce(
      (sum, s) =>
        sum +
        Math.max(0, (s.endsAt!.getTime() - s.startsAt!.getTime()) / 60_000 - (s.breakMinutes ?? 0)),
      0,
    )
    return {
      cells: {
        location: l.name,
        shifts: mine.length,
        assigned: mine.filter((s) => s.assignee).length,
        open: mine.filter((s) => !s.assignee && s.isOpen).length,
        unfilled: mine.filter((s) => !s.assignee && !s.isOpen).length,
        cancelled: shiftRows.filter((s) => s.locationId === l.id && s.status === 'cancelled')
          .length,
        hours: Math.round(minutes / 6) / 10,
      },
      href: `/app/schedule?location=${l.id}`,
    }
  })
  const gaps = active.filter((s) => !s.assignee && s.startsAt!.getTime() > now.getTime())
  const shiftLabel = (s: { startsAt: Date | null; endsAt: Date | null; locationId: string }) => {
    const label = formatShift(s.startsAt!, s.endsAt!, tz.get(s.locationId)!.timeZone)
    return `${label.day}, ${label.time}${label.endsNextDay ? ' (next day)' : ''}`
  }

  const periodStart = new Date(`${filters.from}T00:00:00Z`)
  const periodEnd = new Date(`${addCalendarDays(filters.to, 1)}T00:00:00Z`)
  const [timeOff, swaps, claims, conflicts] = await Promise.all([
    tx
      .select()
      .from(timeOffRequests)
      .where(
        and(
          eq(timeOffRequests.organizationId, org),
          inArray(timeOffRequests.employmentId, ids(personIds)),
          gte(timeOffRequests.createdAt, periodStart),
          lte(timeOffRequests.createdAt, periodEnd),
        ),
      )
      .orderBy(asc(timeOffRequests.startsOn)),
    tx
      .select({
        status: shiftSwapRequests.status,
        kind: shiftSwapRequests.kind,
        createdAt: shiftSwapRequests.createdAt,
        requester: shiftSwapRequests.requesterEmploymentId,
      })
      .from(shiftSwapRequests)
      .innerJoin(
        shifts,
        and(
          eq(shifts.organizationId, shiftSwapRequests.organizationId),
          eq(shifts.id, shiftSwapRequests.shiftId),
        ),
      )
      .where(
        and(
          eq(shiftSwapRequests.organizationId, org),
          inArray(shifts.locationId, ids(scope.locationIds)),
          gte(shiftSwapRequests.createdAt, periodStart),
          lte(shiftSwapRequests.createdAt, periodEnd),
        ),
      ),
    tx
      .select({
        status: openShiftClaims.status,
        createdAt: openShiftClaims.createdAt,
        employmentId: openShiftClaims.employmentId,
      })
      .from(openShiftClaims)
      .innerJoin(
        shifts,
        and(
          eq(shifts.organizationId, openShiftClaims.organizationId),
          eq(shifts.id, openShiftClaims.shiftId),
        ),
      )
      .where(
        and(
          eq(openShiftClaims.organizationId, org),
          inArray(shifts.locationId, ids(scope.locationIds)),
          gte(openShiftClaims.createdAt, periodStart),
          lte(openShiftClaims.createdAt, periodEnd),
        ),
      ),
    tx
      .select({
        shiftId: shifts.id,
        locationId: shifts.locationId,
        startsAt: shifts.publishedStartsAt,
        endsAt: shifts.publishedEndsAt,
        employmentId: shifts.publishedAssigneeEmploymentId,
        startsOn: timeOffRequests.startsOn,
        endsOn: timeOffRequests.endsOn,
      })
      .from(shifts)
      .innerJoin(
        locations,
        and(
          eq(locations.organizationId, shifts.organizationId),
          eq(locations.id, shifts.locationId),
        ),
      )
      .innerJoin(
        timeOffRequests,
        and(
          eq(timeOffRequests.organizationId, shifts.organizationId),
          eq(timeOffRequests.employmentId, shifts.publishedAssigneeEmploymentId),
          eq(timeOffRequests.status, 'approved'),
          sql`${localDay} between ${timeOffRequests.startsOn} and ${timeOffRequests.endsOn}`,
        ),
      )
      .where(
        and(
          eq(shifts.organizationId, org),
          inArray(shifts.locationId, ids(scope.locationIds)),
          eq(shifts.publishedStatus, 'active'),
          inArray(shifts.publishedAssigneeEmploymentId, ids(personIds)),
          sql`${localDay} between ${filters.from}::date and ${filters.to}::date`,
        ),
      ),
  ])
  const swapsInScope = swaps.filter((s) => staff.has(s.requester))
  const claimsInScope = claims.filter((c) => staff.has(c.employmentId))

  const weeks = new Map<string, { timeOff: number; swaps: number; claims: number }>()
  const week = (d: Date) => weekStartOf(d.toISOString().slice(0, 10))
  const bump = (d: Date, k: 'timeOff' | 'swaps' | 'claims') => {
    const w = weeks.get(week(d)) ?? { timeOff: 0, swaps: 0, claims: 0 }
    w[k] += 1
    weeks.set(week(d), w)
  }
  timeOff.forEach((t) => bump(t.createdAt, 'timeOff'))
  swapsInScope.forEach((s) => bump(s.createdAt, 'swaps'))
  claimsInScope.forEach((c) => bump(c.createdAt, 'claims'))

  const pendingTimeOff = timeOff.filter((t) => t.status === 'pending')
  const pendingSwaps = swapsInScope.filter((s) => s.status === 'pending_manager').length
  return {
    headlines: [
      {
        label: 'Shifts without anyone',
        value: gaps.length,
        detail: 'upcoming, open or unfilled',
        tone: tone(gaps.length, 'urgent'),
        tableId: 'gaps',
      },
      {
        label: 'Clashes with time off',
        value: conflicts.length,
        detail: 'assigned during approved time off',
        tone: tone(conflicts.length, 'urgent'),
        tableId: 'conflicts',
      },
      {
        label: 'Time off to decide',
        value: pendingTimeOff.length,
        detail: `${timeOff.length} requested in the period`,
        tone: tone(pendingTimeOff.length),
        tableId: 'timeoff',
      },
      {
        label: 'Swaps to decide',
        value: pendingSwaps,
        detail: `${swapsInScope.length} requested in the period`,
        tone: tone(pendingSwaps),
        tableId: 'trend',
      },
    ],
    tables: [
      {
        id: 'gaps',
        title: 'Shifts without anyone',
        description: 'Upcoming published shifts that are open to claim or have nobody on them.',
        columns: [
          { key: 'location', header: 'Location' },
          { key: 'shift', header: 'Shift' },
          { key: 'role', header: 'Role' },
          { key: 'station', header: 'Station' },
          { key: 'state', header: 'State' },
        ],
        rows: gaps.map((s) => ({
          cells: {
            location: tz.get(s.locationId)!.name,
            shift: shiftLabel(s),
            role: s.roleName,
            station: s.stationName,
            state: s.isOpen ? 'Open to claim' : 'Unfilled',
          },
          href: `/app/schedule/shifts/${s.id}`,
        })),
        empty: 'Every upcoming shift in this view has someone on it.',
      },
      {
        id: 'conflicts',
        title: 'Shifts during approved time off',
        description: 'Somebody is on the published schedule on a day their time off was approved.',
        columns: [
          { key: 'person', header: 'Person' },
          { key: 'location', header: 'Location' },
          { key: 'shift', header: 'Shift' },
          { key: 'timeOff', header: 'Approved time off' },
        ],
        rows: conflicts.map((c) => ({
          cells: {
            person: staff.get(c.employmentId!)?.name ?? '',
            location: tz.get(c.locationId)!.name,
            shift: shiftLabel(c),
            timeOff:
              c.startsOn === c.endsOn
                ? date(c.startsOn)
                : `${date(c.startsOn)} – ${date(c.endsOn)}`,
          },
          href: `/app/schedule/shifts/${c.shiftId}`,
        })),
        empty: 'Nobody is scheduled during their approved time off.',
      },
      {
        id: 'coverage',
        title: 'Coverage by location',
        description: 'Published shifts in the period.',
        columns: [
          { key: 'location', header: 'Location' },
          { key: 'shifts', header: 'Shifts', numeric: true },
          { key: 'assigned', header: 'Assigned', numeric: true },
          { key: 'open', header: 'Open', numeric: true },
          { key: 'unfilled', header: 'Unfilled', numeric: true },
          { key: 'cancelled', header: 'Cancelled', numeric: true },
          { key: 'hours', header: 'Paid hours', numeric: true },
        ],
        rows: coverage,
        empty: 'No locations in this view.',
      },
      {
        id: 'timeoff',
        title: 'Time off requested',
        description: 'Requests made in the period. Reasons are not included.',
        columns: [
          { key: 'person', header: 'Person' },
          { key: 'dates', header: 'Dates' },
          { key: 'status', header: 'Status' },
          { key: 'requested', header: 'Requested' },
        ],
        rows: timeOff.map((t) => ({
          cells: {
            person: staff.get(t.employmentId)?.name ?? '',
            dates:
              t.startsOn === t.endsOn
                ? date(t.startsOn)
                : `${date(t.startsOn)} – ${date(t.endsOn)}`,
            status: TIME_OFF_STATUS[t.status] ?? t.status,
            requested: formatCalendarDate(t.createdAt.toISOString().slice(0, 10)),
          },
          href: '/app/schedule/requests',
        })),
        empty: 'No time off was requested in this period.',
      },
      {
        id: 'trend',
        title: 'Requests by week',
        description: `Time off, swaps and open-shift claims made each week. Swaps: ${
          Object.entries(
            swapsInScope.reduce<Record<string, number>>(
              (acc, s) => ({
                ...acc,
                [SWAP_STATUS[s.status] ?? s.status]:
                  (acc[SWAP_STATUS[s.status] ?? s.status] ?? 0) + 1,
              }),
              {},
            ),
          )
            .map(([k, v]) => `${v} ${k.toLowerCase()}`)
            .join(', ') || 'none'
        }.`,
        columns: [
          { key: 'week', header: 'Week of' },
          { key: 'timeOff', header: 'Time off', numeric: true },
          { key: 'swaps', header: 'Swaps', numeric: true },
          { key: 'claims', header: 'Claims', numeric: true },
        ],
        rows: [...weeks.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([w, c]) => ({
            cells: { week: date(w), timeOff: c.timeOff, swaps: c.swaps, claims: c.claims },
          })),
        empty: 'No requests in this period.',
      },
    ],
    notes: [],
  }
}

// ---------------------------------------------------------------------------
// Shift operations
// ---------------------------------------------------------------------------

async function operations(
  tx: Tx,
  actor: Actor,
  scope: ReportScope,
  filters: ReportFilters,
  now: Date,
): Promise<Built> {
  const org = actor.organizationId
  const staff = await peopleInScope(tx, org, scope, filters)
  const locationName = new Map(scope.locations.map((l) => [l.id, l.name]))
  const peopleFilter = filters.departmentId || filters.jobRoleId

  const items = await tx
    .select({
      id: opsTaskItems.id,
      status: opsTaskItems.status,
      dueAt: opsTaskItems.dueAt,
      reason: opsTaskItems.reason,
      assigned: opsTaskItems.assignedEmploymentId,
      completedBy: opsTaskItems.completedByEmploymentId,
      completedAt: opsTaskItems.completedAt,
      verifiedAt: opsTaskItems.verifiedAt,
      title: opsTasks.title,
      required: opsTasks.required,
      requiresVerification: opsTasks.requiresVerification,
      runName: opsRuns.name,
      locationId: opsRuns.locationId,
      businessDate: opsRuns.businessDate,
    })
    .from(opsTaskItems)
    .innerJoin(
      opsRuns,
      and(
        eq(opsRuns.organizationId, opsTaskItems.organizationId),
        eq(opsRuns.id, opsTaskItems.runId),
      ),
    )
    .innerJoin(
      opsTasks,
      and(
        eq(opsTasks.organizationId, opsTaskItems.organizationId),
        eq(opsTasks.id, opsTaskItems.taskId),
      ),
    )
    .where(
      and(
        eq(opsTaskItems.organizationId, org),
        eq(opsRuns.status, 'active'),
        inArray(opsRuns.locationId, ids(scope.locationIds)),
        gte(opsRuns.businessDate, filters.from),
        lte(opsRuns.businessDate, filters.to),
      ),
    )
    .orderBy(desc(opsRuns.businessDate), asc(opsTaskItems.dueAt))
  const visible = items.filter(
    (i) => !peopleFilter || (i.assigned !== null && staff.has(i.assigned)),
  )
  const name = (id: string | null) => (id ? (staff.get(id)?.name ?? '') : 'Unassigned')
  const board = (i: { locationId: string; businessDate: string }) =>
    `/app/operations?location=${i.locationId}&date=${i.businessDate}`

  const skippedRequired = visible.filter((i) => i.status === 'skipped' && i.required)
  const blocked = visible.filter((i) => i.status === 'blocked')
  const overdue = visible.filter((i) => i.status === 'pending' && i.dueAt.getTime() < now.getTime())
  const waiting = visible.filter((i) => i.status === 'awaiting_verification')
  const verified = visible.filter((i) => i.verifiedAt && i.completedAt)
  const delays = verified.map((i) => (i.verifiedAt!.getTime() - i.completedAt!.getTime()) / 60_000)
  const slow = verified.filter(
    (i) => i.verifiedAt!.getTime() - i.completedAt!.getTime() > 2 * 3_600_000,
  )

  const handoffRows = await tx
    .select({
      id: handoffs.id,
      locationId: handoffs.locationId,
      category: handoffs.category,
      priority: handoffs.priority,
      title: handoffs.title,
      createdAt: handoffs.createdAt,
      author: handoffs.authorEmploymentId,
    })
    .from(handoffs)
    .where(
      and(
        eq(handoffs.organizationId, org),
        inArray(handoffs.locationId, ids(scope.locationIds)),
        eq(handoffs.status, 'open'),
        lte(handoffs.createdAt, new Date(now.getTime() - DAY)),
      ),
    )
    .orderBy(asc(handoffs.createdAt))
  const industry =
    (
      await tx.execute<{ industry: string }>(
        sql`select industry from organizations where id = ${org}`,
      )
    ).rows[0]?.industry ?? ''

  const byTemplate = new Map<
    string,
    { total: number; done: number; skipped: number; blocked: number }
  >()
  for (const i of visible) {
    const t = byTemplate.get(i.runName) ?? { total: 0, done: 0, skipped: 0, blocked: 0 }
    t.total += 1
    if (i.status === 'done') t.done += 1
    if (i.status === 'skipped') t.skipped += 1
    if (i.status === 'blocked') t.blocked += 1
    byTemplate.set(i.runName, t)
  }
  const median = delays.length
    ? [...delays].sort((a, b) => a - b)[Math.floor(delays.length / 2)]!
    : null

  const taskColumns = [
    { key: 'day', header: 'Day' },
    { key: 'location', header: 'Location' },
    { key: 'work', header: 'Template' },
    { key: 'task', header: 'Task' },
    { key: 'person', header: 'Person' },
  ]
  return {
    headlines: [
      {
        label: 'Required work skipped',
        value: skippedRequired.length,
        detail: 'with the reason given',
        tone: tone(skippedRequired.length, 'urgent'),
        tableId: 'skipped',
      },
      {
        label: 'Blocked',
        value: blocked.length,
        detail: `${overdue.length} more overdue`,
        tone: tone(blocked.length, 'urgent'),
        tableId: 'blocked',
      },
      {
        label: 'Waiting to verify',
        value: waiting.length,
        detail: median === null ? 'no verifications yet' : `typical wait ${Math.round(median)} min`,
        tone: tone(waiting.length),
        tableId: 'waiting',
      },
      {
        label: 'Handoffs not followed up',
        value: handoffRows.length,
        detail: 'open for more than a day',
        tone: tone(handoffRows.length),
        tableId: 'handoffs',
      },
    ],
    tables: [
      {
        id: 'skipped',
        title: 'Required work skipped',
        description: 'Required tasks somebody skipped, and why.',
        columns: [...taskColumns, { key: 'reason', header: 'Reason' }],
        rows: skippedRequired.map((i) => ({
          cells: {
            day: date(i.businessDate),
            location: locationName.get(i.locationId) ?? '',
            work: i.runName,
            task: i.title,
            person: name(i.completedBy),
            reason: i.reason,
          },
          href: board(i),
        })),
        empty: 'No required work was skipped.',
      },
      {
        id: 'blocked',
        title: 'Blocked and overdue',
        description: 'Work that stopped, or is past due and not done.',
        columns: [
          ...taskColumns,
          { key: 'state', header: 'State' },
          { key: 'reason', header: 'Reason' },
        ],
        rows: [...blocked, ...overdue].map((i) => ({
          cells: {
            day: date(i.businessDate),
            location: locationName.get(i.locationId) ?? '',
            work: i.runName,
            task: i.title,
            person: name(i.assigned),
            state: i.status === 'blocked' ? 'Blocked' : 'Overdue',
            reason: i.reason,
          },
          href: board(i),
        })),
        empty: 'Nothing is blocked or overdue.',
      },
      {
        id: 'waiting',
        title: 'Waiting for verification',
        description: 'Done by an employee, not yet checked by a manager.',
        columns: [...taskColumns, { key: 'waiting', header: 'Hours waiting', numeric: true }],
        rows: waiting.map((i) => ({
          cells: {
            day: date(i.businessDate),
            location: locationName.get(i.locationId) ?? '',
            work: i.runName,
            task: i.title,
            person: name(i.completedBy),
            waiting: i.completedAt
              ? Math.round((now.getTime() - i.completedAt.getTime()) / 360_000) / 10
              : null,
          },
          href: board(i),
        })),
        empty: 'Nothing is waiting for verification.',
      },
      {
        id: 'slow',
        title: 'Slow verifications',
        description: 'Verified more than two hours after the work was done.',
        columns: [...taskColumns, { key: 'hours', header: 'Hours to verify', numeric: true }],
        rows: slow.map((i) => ({
          cells: {
            day: date(i.businessDate),
            location: locationName.get(i.locationId) ?? '',
            work: i.runName,
            task: i.title,
            person: name(i.completedBy),
            hours: Math.round((i.verifiedAt!.getTime() - i.completedAt!.getTime()) / 360_000) / 10,
          },
          href: board(i),
        })),
        empty: 'Every verification was within two hours.',
      },
      {
        id: 'templates',
        title: 'Completion by template',
        description: 'Every task in the period.',
        columns: [
          { key: 'work', header: 'Template' },
          { key: 'total', header: 'Tasks', numeric: true },
          { key: 'done', header: 'Done', numeric: true },
          { key: 'skipped', header: 'Skipped', numeric: true },
          { key: 'blocked', header: 'Blocked', numeric: true },
          { key: 'rate', header: 'Done' },
        ],
        rows: [...byTemplate.entries()].map(([work, t]) => ({
          cells: {
            work,
            total: t.total,
            done: t.done,
            skipped: t.skipped,
            blocked: t.blocked,
            rate: `${t.total ? Math.round((t.done * 100) / t.total) : 0}%`,
          },
        })),
        empty: 'No shift work in this period.',
      },
      {
        id: 'handoffs',
        title: 'Handoffs not followed up',
        description: 'Still open more than a day after they were left.',
        columns: [
          { key: 'location', header: 'Location' },
          { key: 'category', header: 'About' },
          { key: 'title', header: 'Handoff' },
          { key: 'priority', header: 'Priority' },
          { key: 'opened', header: 'Left' },
          { key: 'days', header: 'Days open', numeric: true },
        ],
        rows: handoffRows.map((h) => ({
          cells: {
            location: locationName.get(h.locationId) ?? '',
            category: handoffCategoryLabel(h.category as never, industry),
            title: h.title,
            priority: h.priority === 'urgent' ? 'Priority' : 'Normal',
            opened: formatCalendarDate(h.createdAt.toISOString().slice(0, 10)),
            days: Math.floor((now.getTime() - h.createdAt.getTime()) / DAY),
          },
          href: `/app/operations/handoffs?location=${h.locationId}`,
        })),
        empty: 'Every handoff older than a day has been resolved.',
      },
    ],
    notes: peopleFilter
      ? [
          'Department and role filters apply to who the work is assigned to. Handoffs are not filtered by them.',
        ]
      : [],
  }
}

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

async function communications(
  tx: Tx,
  actor: Actor,
  scope: ReportScope,
  filters: ReportFilters,
  now: Date,
): Promise<Built> {
  const org = actor.organizationId
  const roles = roleFilter(scope, filters)
  const periodStart = new Date(`${filters.from}T00:00:00Z`)
  const periodEnd = new Date(`${addCalendarDays(filters.to, 1)}T00:00:00Z`)
  const recipientWhere = and(
    eq(announcementRecipients.organizationId, org),
    inArray(announcementRecipients.locationIdAtPublish, ids(scope.locationIds)),
    filters.departmentId
      ? eq(announcementRecipients.departmentIdAtPublish, filters.departmentId)
      : undefined,
    roles && filters.jobRoleId
      ? inArray(announcementRecipients.jobRoleIdAtPublish, ids(roles))
      : undefined,
  )

  const rows = await tx
    .select({
      id: announcements.id,
      title: announcementRevisions.title,
      category: announcementCategories.name,
      priority: announcements.priority,
      publishedAt: announcements.publishedAt,
      requiresAck: announcements.requiresAcknowledgement,
      dueAt: announcements.acknowledgementDueAt,
      targeted: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${announcementRecipients.deliveryStatus} = 'failed')::int`,
      viewed: sql<number>`count(${announcementRecipients.firstViewedAt})::int`,
      acknowledged: sql<number>`count(${announcementRecipients.acknowledgedAt})::int`,
    })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      and(
        eq(announcements.organizationId, announcementRecipients.organizationId),
        eq(announcements.id, announcementRecipients.announcementId),
      ),
    )
    .innerJoin(
      announcementRevisions,
      and(
        eq(announcementRevisions.organizationId, announcements.organizationId),
        eq(announcementRevisions.id, announcements.currentRevisionId),
      ),
    )
    .innerJoin(
      announcementCategories,
      and(
        eq(announcementCategories.organizationId, announcements.organizationId),
        eq(announcementCategories.id, announcements.categoryId),
      ),
    )
    .where(
      and(
        recipientWhere,
        ne(announcements.status, 'draft'),
        gte(announcements.publishedAt, periodStart),
        lte(announcements.publishedAt, periodEnd),
      ),
    )
    .groupBy(announcements.id, announcementRevisions.title, announcementCategories.name)
    .orderBy(desc(announcements.publishedAt))

  const people = await peopleInScope(tx, org, scope, filters)
  const failures = await tx
    .select({
      channel: notifications.channel,
      reason: sql<string>`coalesce(${notifications.failureReason}, 'Unknown')`,
      n: sql<number>`count(*)::int`,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, org),
        eq(notifications.status, 'failed'),
        inArray(notifications.employmentId, ids([...people.keys()])),
        gt(notifications.failedAt, periodStart),
        lte(notifications.failedAt, periodEnd),
      ),
    )
    .groupBy(notifications.channel, sql`coalesce(${notifications.failureReason}, 'Unknown')`)

  const outstandingOf = (r: (typeof rows)[number]) =>
    r.requiresAck ? r.targeted - r.acknowledged : 0
  const overdueOf = (r: (typeof rows)[number]) =>
    r.requiresAck && r.dueAt && r.dueAt.getTime() < now.getTime() ? outstandingOf(r) : 0
  const unread = rows.reduce((s, r) => s + (r.targeted - r.viewed), 0)
  const overdue = rows.reduce((s, r) => s + overdueOf(r), 0)
  const failed = rows.reduce((s, r) => s + r.failed, 0) + failures.reduce((s, f) => s + f.n, 0)
  const CHANNELS: Record<string, string> = {
    email: 'Email',
    in_app: 'In EverCalm',
    sms: 'Text message',
    push: 'Push',
  }

  return {
    headlines: [
      {
        label: 'Messages sent',
        value: rows.length,
        detail: `to ${rows.reduce((s, r) => s + r.targeted, 0)} recipients`,
        tone: 'neutral',
        tableId: 'messages',
      },
      {
        label: 'Not yet read',
        value: unread,
        detail: 'recipients who have not opened them',
        tone: tone(unread),
        tableId: 'messages',
      },
      {
        label: 'Confirmations overdue',
        value: overdue,
        detail: `${rows.reduce((s, r) => s + outstandingOf(r), 0)} still outstanding`,
        tone: tone(overdue, 'urgent'),
        tableId: 'messages',
      },
      {
        label: 'Could not deliver',
        value: failed,
        detail: 'messages and notifications',
        tone: tone(failed, 'urgent'),
        tableId: 'failures',
      },
    ],
    tables: [
      {
        id: 'messages',
        title: 'Messages',
        description: 'Published in the period, counted for the people in this view.',
        columns: [
          { key: 'message', header: 'Message' },
          { key: 'category', header: 'Category' },
          { key: 'published', header: 'Published' },
          { key: 'recipients', header: 'Recipients', numeric: true },
          { key: 'read', header: 'Read', numeric: true },
          { key: 'confirmed', header: 'Confirmed', numeric: true },
          { key: 'outstanding', header: 'Not confirmed', numeric: true },
          { key: 'overdue', header: 'Overdue', numeric: true },
          { key: 'failed', header: 'Undelivered', numeric: true },
        ],
        rows: rows.map((r) => ({
          cells: {
            message: r.title,
            category: r.category,
            published: r.publishedAt
              ? formatCalendarDate(r.publishedAt.toISOString().slice(0, 10))
              : null,
            recipients: r.targeted,
            read: r.viewed,
            confirmed: r.requiresAck ? r.acknowledged : null,
            outstanding: r.requiresAck ? outstandingOf(r) : null,
            overdue: r.requiresAck ? overdueOf(r) : null,
            failed: r.failed,
          },
          href: `/app/comms/${r.id}`,
        })),
        empty: 'Nothing was published to this view in the period.',
      },
      {
        id: 'failures',
        title: 'Why notifications failed',
        description: 'Notifications to people in this view that could not be delivered.',
        columns: [
          { key: 'channel', header: 'Channel' },
          { key: 'reason', header: 'Reason' },
          { key: 'count', header: 'Count', numeric: true },
        ],
        rows: failures.map((f) => ({
          cells: { channel: CHANNELS[f.channel] ?? f.channel, reason: f.reason, count: f.n },
          href: '/app/settings/status',
        })),
        empty: 'Every notification was delivered.',
      },
    ],
    notes: [
      'Recipients are counted at the location, department and role they had when the message was published.',
    ],
  }
}
