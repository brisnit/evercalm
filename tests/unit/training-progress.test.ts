import { describe, expect, it } from 'vitest'
import {
  courseProgress,
  daysBetween,
  dueLabel,
  dueStatus,
  learnerOverview,
  managerStatus,
  milestoneBetween,
  milestoneMessage,
  type LearnerAssignment,
  type ProgressLesson,
} from '@/modules/training/progress'

/**
 * Progress is computed, never stored. These pin the arithmetic and the words:
 * what is done, what is next, how far there is to go.
 */

const lessons: ProgressLesson[] = [
  {
    id: 'read',
    title: 'The nine major allergens',
    kind: 'reading',
    position: 0,
    estimatedMinutes: 6,
  },
  {
    id: 'order',
    title: 'Taking an allergy order',
    kind: 'reading',
    position: 1,
    estimatedMinutes: 5,
  },
  {
    id: 'check',
    title: 'Before it leaves the pass',
    kind: 'checklist',
    position: 2,
    estimatedMinutes: 4,
  },
  { id: 'quiz', title: 'Knowledge check', kind: 'quiz', position: 3, estimatedMinutes: 5 },
  {
    id: 'walk',
    title: 'Walk a manager through a ticket',
    kind: 'practical',
    position: 4,
    estimatedMinutes: 10,
  },
]

describe('course progress', () => {
  it('starts at zero with the first lesson next', () => {
    const p = courseProgress(lessons, [], 'assigned')
    expect(p).toMatchObject({
      total: 5,
      completed: 0,
      percent: 0,
      remainingMinutes: 30,
      state: 'not_started',
    })
    expect(p.next?.id).toBe('read')
    expect(p.lessons.map((l) => l.number)).toEqual([1, 2, 3, 4, 5])
  })

  it('orders by position, not by the order rows arrive', () => {
    const p = courseProgress([...lessons].reverse(), [], 'assigned')
    expect(p.lessons[0]!.id).toBe('read')
  })

  it('rounds down, so 100% means every lesson is done', () => {
    const four = lessons.slice(0, 4).map((l) => ({ lessonId: l.id, status: 'completed' }))
    expect(courseProgress(lessons, four, 'in_progress').percent).toBe(80)
    const two = courseProgress(
      lessons.slice(0, 3),
      [
        { lessonId: 'read', status: 'completed' },
        { lessonId: 'order', status: 'completed' },
      ],
      'in_progress',
    )
    expect(two.percent).toBe(66)
  })

  it('puts something sent back first, and skips what is waiting on a manager', () => {
    const p = courseProgress(
      lessons,
      [
        { lessonId: 'read', status: 'completed' },
        { lessonId: 'order', status: 'awaiting_signoff' },
        { lessonId: 'walk', status: 'returned' },
      ],
      'in_progress',
    )
    expect(p.next?.id).toBe('walk')
    expect(p.awaitingSignoff).toBe(1)
  })

  it('is waiting on sign-off when nothing else is left to do', () => {
    const records = lessons.map((l) => ({
      lessonId: l.id,
      status: l.id === 'walk' ? 'awaiting_signoff' : 'completed',
    }))
    const p = courseProgress(lessons, records, 'in_progress')
    expect(p.state).toBe('awaiting_signoff')
    expect(p.next).toBeNull()
    expect(p.remaining).toBe(1)
    expect(p.remainingMinutes).toBe(10)
  })

  it('reports completion and withdrawal', () => {
    const all = lessons.map((l) => ({ lessonId: l.id, status: 'completed' }))
    expect(courseProgress(lessons, all, 'in_progress').state).toBe('completed')
    expect(courseProgress(lessons, [], 'cancelled').state).toBe('cancelled')
  })
})

describe('due dates', () => {
  it('counts calendar days across month and year boundaries', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1)
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2)
    expect(daysBetween('2026-03-08', '2026-03-07')).toBe(-1)
  })

  it('classifies due dates', () => {
    expect(dueStatus(null, '2026-09-13', false).kind).toBe('none')
    expect(dueStatus('2026-09-13', '2026-09-13', false).kind).toBe('today')
    expect(dueStatus('2026-09-15', '2026-09-13', false)).toEqual({ kind: 'soon', days: 2 })
    expect(dueStatus('2026-09-30', '2026-09-13', false).kind).toBe('later')
    expect(dueStatus('2026-09-10', '2026-09-13', false).kind).toBe('past')
    expect(dueStatus('2026-09-10', '2026-09-13', true).kind).toBe('met')
  })

  it('states a missed date as a fact, not a judgement, to the employee', () => {
    const label = dueLabel('2026-09-10', dueStatus('2026-09-10', '2026-09-13', false))
    expect(label).toBe('Was due Sep 10, 2026')
    expect(label?.toLowerCase()).not.toContain('overdue')
    expect(dueLabel('2026-09-14', dueStatus('2026-09-14', '2026-09-13', false))).toBe(
      'Due tomorrow',
    )
  })

  it('tells managers what is overdue, and never calls finished work overdue', () => {
    expect(managerStatus('in_progress', { kind: 'past', days: -2 }).label).toBe('Overdue')
    expect(managerStatus('completed', { kind: 'met', days: -2 }).label).toBe('Completed')
    expect(managerStatus('awaiting_signoff', { kind: 'later', days: 5 }).label).toBe(
      'Waiting for sign-off',
    )
  })
})

describe('moments of accomplishment', () => {
  it('marks the first lesson, halfway and the finish', () => {
    expect(milestoneBetween({ completed: 0, total: 5 }, { completed: 1, total: 5 })).toBe(
      'first_lesson',
    )
    expect(milestoneBetween({ completed: 2, total: 5 }, { completed: 3, total: 5 })).toBe('halfway')
    expect(milestoneBetween({ completed: 3, total: 5 }, { completed: 4, total: 5 })).toBe('lesson')
    expect(milestoneBetween({ completed: 4, total: 5 }, { completed: 5, total: 5 })).toBe(
      'course_complete',
    )
    expect(milestoneBetween({ completed: 1, total: 4 }, { completed: 2, total: 4 })).toBe('halfway')
  })

  it('says nothing when nothing new was completed', () => {
    expect(milestoneBetween({ completed: 2, total: 5 }, { completed: 2, total: 5 })).toBeNull()
  })

  it('speaks plainly and never compares the person with anyone', () => {
    const words = [
      milestoneMessage('first_lesson', {
        completed: 1,
        total: 5,
        courseTitle: 'Allergen awareness',
        nextTitle: 'Taking an allergy order',
      }),
      milestoneMessage('halfway', {
        completed: 3,
        total: 5,
        courseTitle: 'Allergen awareness',
        nextTitle: null,
      }),
      milestoneMessage('course_complete', {
        completed: 5,
        total: 5,
        courseTitle: 'Allergen awareness',
        nextTitle: null,
      }),
    ]
    expect(words[0]).toBe('Good start: 1 of 5 lessons done. Next: Taking an allergy order.')
    expect(words[2]).toBe('You finished Allergen awareness. Every lesson is done.')
    for (const w of words) {
      expect(w).not.toMatch(/rank|top|behind|others|leader|badge|points|!/i)
    }
  })
})

describe('everything a person has been assigned', () => {
  const make = (
    id: string,
    over: Partial<LearnerAssignment> & {
      records?: { lessonId: string; status: string }[]
      status?: string
    },
  ) => ({
    id,
    courseTitle: id,
    dueOn: over.dueOn ?? null,
    assignedAt: over.assignedAt ?? new Date('2026-09-01T00:00:00Z'),
    completedAt: over.completedAt ?? null,
    progress: courseProgress(lessons, over.records ?? [], over.status ?? 'assigned'),
  })

  it('puts past due first, then soonest due, then started work, and sign-off-only work last', () => {
    const waiting = make('waiting', {
      dueOn: '2026-09-01',
      status: 'in_progress',
      records: lessons.map((l) => ({
        lessonId: l.id,
        status: l.id === 'walk' ? 'awaiting_signoff' : 'completed',
      })),
    })
    const overview = learnerOverview(
      [
        make('later', { dueOn: '2026-10-01' }),
        make('none-started', {
          records: [{ lessonId: 'read', status: 'completed' }],
          status: 'in_progress',
        }),
        make('none-new', {}),
        make('past', { dueOn: '2026-09-10' }),
        make('soon', { dueOn: '2026-09-15' }),
        waiting,
        make('done', {
          status: 'completed',
          completedAt: new Date('2026-09-12T00:00:00Z'),
          records: lessons.map((l) => ({ lessonId: l.id, status: 'completed' })),
        }),
      ],
      '2026-09-13',
    )
    expect(overview.active.map((a) => a.id)).toEqual([
      'past',
      'soon',
      'later',
      'none-started',
      'none-new',
      'waiting',
    ])
    expect(overview.upNext?.id).toBe('past')
    expect(overview.completed.map((a) => a.id)).toEqual(['done'])
    // A missed date is still a missed date while a manager's sign-off is outstanding.
    expect(overview.pastDue).toBe(2)
    expect(overview.waitingOnSignoff).toBe(1)
    expect(overview.lessonsRemaining).toBe(5 + 5 + 4 + 5 + 5 + 1)
  })

  it('has nothing up next when only a manager can move things forward', () => {
    const overview = learnerOverview(
      [
        make('waiting', {
          status: 'in_progress',
          records: lessons.map((l) => ({
            lessonId: l.id,
            status: l.id === 'walk' ? 'awaiting_signoff' : 'completed',
          })),
        }),
      ],
      '2026-09-13',
    )
    expect(overview.upNext).toBeNull()
    expect(overview.active).toHaveLength(1)
  })
})
