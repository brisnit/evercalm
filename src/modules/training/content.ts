import { newId } from '@/lib/ids'
import { normalizeBody, normalizeTitle } from '@/modules/comms/content'

/*
 * LESSON CONTENT.
 *
 * Pure: no database, so every rule here - what a publishable lesson is, how a
 * quiz is scored, what a learner is allowed to see - is unit-tested directly.
 *
 * Four kinds of lesson, chosen for work that happens on a floor rather than at
 * a desk:
 *
 *   reading     something to read and understand
 *   checklist   steps to confirm one by one ("Before you mix")
 *   quiz        a knowledge check, scored on the SERVER against the version
 *               the person was assigned; the correct answers never reach the
 *               browser until they have passed
 *   practical   something to demonstrate to a manager, who signs it off
 *
 * Structured content lives in the lesson's `content` jsonb. Anything read back
 * from the database goes through `parseLessonContent`, which never throws: a
 * malformed row degrades to an empty lesson that cannot be published, rather
 * than a crashed page.
 *
 * Deliberately NOT here: video, images and uploaded documents. They need file
 * storage, which arrives with evidence uploads in shift operations.
 */

export const LESSON_KINDS = ['reading', 'checklist', 'quiz', 'practical'] as const
export type LessonKind = (typeof LESSON_KINDS)[number]

export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  reading: 'Reading',
  checklist: 'Checklist',
  quiz: 'Knowledge check',
  practical: 'Practical sign-off',
}

export const QUESTION_KINDS = ['single', 'multiple', 'true_false'] as const
export type QuestionKind = (typeof QUESTION_KINDS)[number]

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  single: 'One correct answer',
  multiple: 'Choose all that apply',
  true_false: 'True or false',
}

export const LIMITS = {
  title: 120,
  item: 240,
  items: 20,
  questions: 25,
  options: 6,
  prompt: 400,
  explanation: 600,
  minutes: 240,
} as const

export const DEFAULT_PASS_PERCENT = 80

export interface ContentItem {
  id: string
  text: string
}

export interface QuizQuestion {
  id: string
  kind: QuestionKind
  prompt: string
  options: ContentItem[]
  correctOptionIds: string[]
  /** Shown once the person has passed. */
  explanation: string
}

export interface QuizSettings {
  passPercent: number
  /** Null means unlimited attempts. */
  maxAttempts: number | null
}

export type LessonContent =
  | { kind: 'reading' }
  | { kind: 'checklist'; items: ContentItem[] }
  | ({ kind: 'quiz'; questions: QuizQuestion[] } & QuizSettings)
  | { kind: 'practical'; criteria: ContentItem[] }

export function isLessonKind(value: string): value is LessonKind {
  return (LESSON_KINDS as readonly string[]).includes(value)
}

export function isQuestionKind(value: string): value is QuestionKind {
  return (QUESTION_KINDS as readonly string[]).includes(value)
}

export function emptyContent(kind: LessonKind): LessonContent {
  switch (kind) {
    case 'reading':
      return { kind }
    case 'checklist':
      return { kind, items: [] }
    case 'quiz':
      return { kind, questions: [], passPercent: DEFAULT_PASS_PERCENT, maxAttempts: null }
    case 'practical':
      return { kind, criteria: [] }
  }
}

// ---------------------------------------------------------------------------
// Reading from storage
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseItems(value: unknown): ContentItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => asRecord(raw))
    .map((raw) => ({ id: asString(raw.id), text: asString(raw.text) }))
    .filter((item) => item.id.length > 0 && item.text.trim().length > 0)
}

function parseQuestion(value: unknown): QuizQuestion | null {
  const raw = asRecord(value)
  const id = asString(raw.id)
  const kind = asString(raw.kind)
  if (!id || !isQuestionKind(kind)) return null
  const options = parseItems(raw.options)
  const optionIds = new Set(options.map((o) => o.id))
  const correct = Array.isArray(raw.correctOptionIds)
    ? raw.correctOptionIds.filter((v): v is string => typeof v === 'string' && optionIds.has(v))
    : []
  return {
    id,
    kind,
    prompt: asString(raw.prompt),
    options,
    correctOptionIds: [...new Set(correct)],
    explanation: asString(raw.explanation),
  }
}

function clampPercent(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN
  return n >= 1 && n <= 100 ? n : DEFAULT_PASS_PERCENT
}

function parseMaxAttempts(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= 1 && value <= 10 ? value : null
}

/** Read stored content for a lesson of `kind`. Never throws. */
export function parseLessonContent(kind: string, stored: unknown): LessonContent {
  const raw = asRecord(stored)
  switch (kind) {
    case 'checklist':
      return { kind, items: parseItems(raw.items) }
    case 'quiz':
      return {
        kind,
        questions: Array.isArray(raw.questions)
          ? raw.questions.map(parseQuestion).filter((q): q is QuizQuestion => q !== null)
          : [],
        passPercent: clampPercent(raw.passPercent),
        maxAttempts: parseMaxAttempts(raw.maxAttempts),
      }
    case 'practical':
      return { kind, criteria: parseItems(raw.criteria) }
    default:
      return { kind: 'reading' }
  }
}

/** The jsonb to store. The kind lives in its own column, not in here. */
export function serializeContent(content: LessonContent): Record<string, unknown> {
  const { kind: _kind, ...rest } = content
  return rest
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * One item per line. An unchanged line keeps its id, so a person part-way
 * through a checklist in a DRAFT preview does not see ticks move - and so a
 * later version can tell which items were edited.
 */
export function linesToItems(text: string, existing: readonly ContentItem[] = []): ContentItem[] {
  const byText = new Map<string, string>()
  for (const item of existing) if (!byText.has(item.text)) byText.set(item.text, item.id)
  const seen = new Set<string>()
  const out: ContentItem[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const clean = normalizeTitle(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')).slice(0, LIMITS.item)
    if (!clean) continue
    const id = byText.get(clean)
    const itemId = id && !seen.has(id) ? id : newId()
    seen.add(itemId)
    out.push({ id: itemId, text: clean })
    if (out.length === LIMITS.items) break
  }
  return out
}

export function itemsToLines(items: readonly ContentItem[]): string {
  return items.map((item) => item.text).join('\n')
}

export interface QuestionInput {
  kind: string
  prompt: string
  /** Option texts in order. Blank entries are ignored. */
  options: string[]
  /** Indexes into `options` that are correct. */
  correct: number[]
  explanation: string
}

export type QuestionResult =
  { ok: true; question: QuizQuestion } | { ok: false; fieldErrors: Record<string, string[]> }

/**
 * Validate and build a question. Option ids are kept for options whose text
 * did not change, so editing a typo does not invalidate anything.
 */
export function buildQuestion(input: QuestionInput, existing?: QuizQuestion): QuestionResult {
  const errors: Record<string, string[]> = {}
  const kind = isQuestionKind(input.kind) ? input.kind : null
  if (!kind) errors.kind = ['Choose a question type.']

  const prompt = normalizeTitle(input.prompt).slice(0, LIMITS.prompt)
  if (!prompt) errors.prompt = ['Write the question.']

  const texts =
    kind === 'true_false'
      ? ['True', 'False']
      : input.options.map((o) => normalizeTitle(o).slice(0, LIMITS.item))

  const kept: { text: string; index: number }[] = []
  texts.forEach((text, index) => {
    if (text) kept.push({ text, index })
  })
  const sliced = kept.slice(0, LIMITS.options)

  if (kind && kind !== 'true_false' && sliced.length < 2) {
    errors.options = ['Give at least two answers to choose from.']
  }
  const distinct = new Set(sliced.map((o) => o.text.toLowerCase()))
  if (distinct.size !== sliced.length) {
    errors.options = ['Each answer must be different.']
  }

  const correctIndexes = new Set(input.correct.filter((i) => sliced.some((o) => o.index === i)))
  if (kind === 'multiple') {
    if (correctIndexes.size === 0) errors.correct = ['Mark at least one correct answer.']
  } else if (kind && correctIndexes.size !== 1) {
    errors.correct = ['Mark exactly one correct answer.']
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors }

  const previous = new Map((existing?.options ?? []).map((o) => [o.text, o.id]))
  const options = sliced.map((o) => ({ id: previous.get(o.text) ?? newId(), text: o.text }))
  const correctOptionIds = sliced
    .map((o, position) => (correctIndexes.has(o.index) ? options[position]!.id : null))
    .filter((id): id is string => id !== null)

  return {
    ok: true,
    question: {
      id: existing?.id ?? newId(),
      kind: kind!,
      prompt,
      options,
      correctOptionIds,
      explanation: normalizeBody(input.explanation).slice(0, LIMITS.explanation),
    },
  }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface LessonForReview {
  title: string
  kind: string
  body: string
  content: LessonContent
}

/** Why this lesson cannot be published yet, in words an author can act on. */
export function lessonProblems(lesson: LessonForReview): string[] {
  const out: string[] = []
  const content = lesson.content
  if (!lesson.title.trim()) out.push('It needs a title.')

  switch (content.kind) {
    case 'reading':
      if (!lesson.body.trim()) out.push('It has nothing to read yet.')
      break
    case 'checklist':
      if (content.items.length === 0) out.push('It needs at least one checklist item.')
      break
    case 'practical':
      if (content.criteria.length === 0) {
        out.push('It needs at least one thing the manager will look for.')
      }
      break
    case 'quiz':
      if (content.questions.length === 0) out.push('It needs at least one question.')
      content.questions.forEach((q, index) => {
        const label = `Question ${index + 1}`
        if (!q.prompt.trim()) out.push(`${label} has no wording.`)
        if (q.options.length < 2) out.push(`${label} needs at least two answers.`)
        if (q.correctOptionIds.length === 0) out.push(`${label} has no correct answer marked.`)
        if (q.kind !== 'multiple' && q.correctOptionIds.length > 1) {
          out.push(`${label} can only have one correct answer.`)
        }
      })
      break
  }
  return out
}

/** Every problem across a version, each naming its lesson. Empty means publishable. */
export function versionProblems(lessons: readonly LessonForReview[]): string[] {
  if (lessons.length === 0) return ['Add at least one lesson.']
  return lessons.flatMap((lesson, index) =>
    lessonProblems(lesson).map((p) => `${lesson.title.trim() || `Lesson ${index + 1}`}: ${p}`),
  )
}

// ---------------------------------------------------------------------------
// Taking a quiz
// ---------------------------------------------------------------------------

/** A question as a learner receives it: no answer key, no explanation. */
export interface LearnerQuestion {
  id: string
  kind: QuestionKind
  prompt: string
  options: ContentItem[]
}

export function learnerQuestions(content: {
  questions: readonly QuizQuestion[]
}): LearnerQuestion[] {
  return content.questions.map(({ id, kind, prompt, options }) => ({
    id,
    kind,
    prompt,
    options: options.map((o) => ({ id: o.id, text: o.text })),
  }))
}

export interface QuizScore {
  correctCount: number
  questionCount: number
  /** Rounded DOWN, so a displayed score never implies a pass that did not happen. */
  scorePercent: number
  passed: boolean
  /** How many correct answers a pass needs. */
  neededToPass: number
  results: { questionId: string; correct: boolean }[]
}

export function neededToPass(passPercent: number, questionCount: number): number {
  return Math.ceil((passPercent * questionCount) / 100)
}

/**
 * Score a submission. Only the SERVER calls this, against the stored version.
 *
 * A question is right when exactly the correct options were chosen. Unknown
 * option ids are ignored rather than counted, and an unanswered question is
 * wrong. The pass test is integer arithmetic, so 79.5% is not rounded into a
 * pass at 80.
 */
export function scoreQuiz(
  content: { questions: readonly QuizQuestion[]; passPercent: number },
  answers: Readonly<Record<string, readonly string[]>>,
): QuizScore {
  const results = content.questions.map((question) => {
    const valid = new Set(question.options.map((o) => o.id))
    const chosen = new Set((answers[question.id] ?? []).filter((id) => valid.has(id)))
    const correct = new Set(question.correctOptionIds)
    const single = question.kind !== 'multiple'
    const right =
      correct.size > 0 &&
      chosen.size === correct.size &&
      (!single || chosen.size === 1) &&
      [...chosen].every((id) => correct.has(id))
    return { questionId: question.id, correct: right }
  })

  const questionCount = results.length
  const correctCount = results.filter((r) => r.correct).length
  return {
    correctCount,
    questionCount,
    scorePercent: questionCount === 0 ? 0 : Math.floor((correctCount * 100) / questionCount),
    passed: questionCount > 0 && correctCount * 100 >= content.passPercent * questionCount,
    neededToPass: neededToPass(content.passPercent, questionCount),
    results,
  }
}

/** Attempts a person may make in total, or null for unlimited. */
export function attemptsAllowed(maxAttempts: number | null, extraAttempts: number): number | null {
  return maxAttempts === null ? null : maxAttempts + extraAttempts
}
