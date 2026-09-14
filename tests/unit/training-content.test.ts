import { describe, expect, it } from 'vitest'
import {
  attemptsAllowed,
  buildQuestion,
  learnerQuestions,
  lessonProblems,
  linesToItems,
  parseLessonContent,
  scoreQuiz,
  versionProblems,
  type QuizQuestion,
} from '@/modules/training/content'

/**
 * Lesson content: what can be published, how a knowledge check is scored, and
 * what a learner is allowed to see. Pure, so every rule is pinned here.
 */

const q = (over: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id: 'q1',
  kind: 'single',
  prompt: 'Which temperature is safe for hot holding?',
  options: [
    { id: 'a', text: '120°F' },
    { id: 'b', text: '135°F or above' },
    { id: 'c', text: '100°F' },
  ],
  correctOptionIds: ['b'],
  explanation: 'Hot food is held at 135°F or above.',
  ...over,
})

describe('reading stored content', () => {
  it('never throws on malformed rows, and degrades to an unpublishable lesson', () => {
    expect(parseLessonContent('quiz', null)).toEqual({
      kind: 'quiz',
      questions: [],
      passPercent: 80,
      maxAttempts: null,
    })
    expect(parseLessonContent('checklist', { items: 'nope' })).toEqual({
      kind: 'checklist',
      items: [],
    })
    expect(parseLessonContent('mystery', { anything: true })).toEqual({ kind: 'reading' })
  })

  it('drops correct-answer ids that are not options, and invalid settings', () => {
    const parsed = parseLessonContent('quiz', {
      passPercent: 400,
      maxAttempts: 0,
      questions: [
        { ...q(), correctOptionIds: ['b', 'zzz', 'b'] },
        { id: '', kind: 'single' },
      ],
    })
    expect(parsed.kind).toBe('quiz')
    if (parsed.kind !== 'quiz') return
    expect(parsed.passPercent).toBe(80)
    expect(parsed.maxAttempts).toBeNull()
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0]!.correctOptionIds).toEqual(['b'])
  })
})

describe('checklist lines', () => {
  it('keeps ids for unchanged lines and strips list markers', () => {
    const first = linesToItems('- Check the patch test date\n2. Record the formula card\n\n')
    expect(first.map((i) => i.text)).toEqual([
      'Check the patch test date',
      'Record the formula card',
    ])
    const second = linesToItems('Record the formula card\nStrand test box-dyed hair', first)
    expect(second[0]!.id).toBe(first[1]!.id)
    expect(second[1]!.id).not.toBe(first[0]!.id)
  })

  it('caps the number of items', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Item ${i}`).join('\n')
    expect(linesToItems(many)).toHaveLength(20)
  })
})

describe('building a question', () => {
  it('gives true-or-false questions fixed answers and exactly one correct', () => {
    const ok = buildQuestion({
      kind: 'true_false',
      prompt: 'Sesame is a major allergen.',
      options: [],
      correct: [0],
      explanation: '',
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.question.options.map((o) => o.text)).toEqual(['True', 'False'])
    const bad = buildQuestion({
      kind: 'true_false',
      prompt: 'x',
      options: [],
      correct: [0, 1],
      explanation: '',
    })
    expect(bad.ok).toBe(false)
  })

  it('requires one correct answer for single choice and at least one for multiple', () => {
    const single = buildQuestion({
      kind: 'single',
      prompt: 'p',
      options: ['a', 'b'],
      correct: [],
      explanation: '',
    })
    expect(single.ok).toBe(false)
    if (!single.ok) expect(single.fieldErrors.correct).toBeDefined()
    const multi = buildQuestion({
      kind: 'multiple',
      prompt: 'p',
      options: ['a', 'b', 'c'],
      correct: [0, 2],
      explanation: '',
    })
    expect(multi.ok).toBe(true)
    if (multi.ok) expect(multi.question.correctOptionIds).toHaveLength(2)
  })

  it('refuses fewer than two answers, duplicates, and a correct mark on a blank answer', () => {
    expect(
      buildQuestion({
        kind: 'single',
        prompt: 'p',
        options: ['only', ''],
        correct: [0],
        explanation: '',
      }).ok,
    ).toBe(false)
    expect(
      buildQuestion({
        kind: 'single',
        prompt: 'p',
        options: ['Same', 'same'],
        correct: [0],
        explanation: '',
      }).ok,
    ).toBe(false)
    expect(
      buildQuestion({
        kind: 'single',
        prompt: 'p',
        options: ['a', '', 'b'],
        correct: [1],
        explanation: '',
      }).ok,
    ).toBe(false)
  })

  it('keeps option ids when only other text changes', () => {
    const first = buildQuestion({
      kind: 'single',
      prompt: 'p',
      options: ['41°F', '50°F'],
      correct: [0],
      explanation: '',
    })
    if (!first.ok) throw new Error('expected ok')
    const edited = buildQuestion(
      {
        kind: 'single',
        prompt: 'Cold holding?',
        options: ['41°F', '55°F'],
        correct: [0],
        explanation: '',
      },
      first.question,
    )
    if (!edited.ok) throw new Error('expected ok')
    expect(edited.question.id).toBe(first.question.id)
    expect(edited.question.options[0]!.id).toBe(first.question.options[0]!.id)
    expect(edited.question.correctOptionIds).toEqual([first.question.options[0]!.id])
  })
})

describe('what can be published', () => {
  it('names each lesson and each problem', () => {
    expect(versionProblems([])).toEqual(['Add at least one lesson.'])
    const problems = versionProblems([
      { title: 'The nine allergens', kind: 'reading', body: '', content: { kind: 'reading' } },
      {
        title: 'Check',
        kind: 'quiz',
        body: '',
        content: {
          kind: 'quiz',
          passPercent: 80,
          maxAttempts: null,
          questions: [q({ correctOptionIds: [] })],
        },
      },
    ])
    expect(problems).toEqual([
      'The nine allergens: It has nothing to read yet.',
      'Check: Question 1 has no correct answer marked.',
    ])
  })

  it('accepts a complete practical and checklist', () => {
    expect(
      lessonProblems({
        title: 'Calibrate a probe',
        kind: 'practical',
        body: '',
        content: { kind: 'practical', criteria: [{ id: '1', text: 'Ice bath reads 32°F' }] },
      }),
    ).toEqual([])
    expect(
      lessonProblems({
        title: 'Before you mix',
        kind: 'checklist',
        body: '',
        content: { kind: 'checklist', items: [] },
      }),
    ).toEqual(['It needs at least one checklist item.'])
  })
})

describe('scoring a knowledge check', () => {
  const multiple = q({
    id: 'q2',
    kind: 'multiple',
    options: [
      { id: 'x', text: 'Sesame' },
      { id: 'y', text: 'Shellfish' },
      { id: 'z', text: 'Garlic' },
    ],
    correctOptionIds: ['x', 'y'],
  })

  it('needs exactly the correct set for choose-all-that-apply', () => {
    const content = { questions: [multiple], passPercent: 100 }
    expect(scoreQuiz(content, { q2: ['x', 'y'] }).passed).toBe(true)
    expect(scoreQuiz(content, { q2: ['x'] }).passed).toBe(false)
    expect(scoreQuiz(content, { q2: ['x', 'y', 'z'] }).passed).toBe(false)
  })

  it('ignores invented option ids and counts unanswered questions as wrong', () => {
    const content = { questions: [q(), multiple], passPercent: 50 }
    const score = scoreQuiz(content, { q1: ['b', 'not-an-option'] })
    expect(score.results).toEqual([
      { questionId: 'q1', correct: true },
      { questionId: 'q2', correct: false },
    ])
    expect(score.passed).toBe(true)
  })

  it('refuses two answers to a single-choice question even if one is right', () => {
    expect(scoreQuiz({ questions: [q()], passPercent: 100 }, { q1: ['a', 'b'] }).passed).toBe(false)
  })

  it('uses exact arithmetic for the pass mark and rounds the shown score down', () => {
    const three = [q({ id: '1' }), q({ id: '2' }), q({ id: '3' })]
    const twoOfThree = { '1': ['b'], '2': ['b'], '3': ['a'] }
    const at67 = scoreQuiz({ questions: three, passPercent: 67 }, twoOfThree)
    expect(at67.scorePercent).toBe(66)
    expect(at67.passed).toBe(false) // 66.7% is not 67%
    expect(at67.neededToPass).toBe(3)
    expect(scoreQuiz({ questions: three, passPercent: 66 }, twoOfThree).passed).toBe(true)
  })

  it('never passes an empty knowledge check', () => {
    expect(scoreQuiz({ questions: [], passPercent: 1 }, {}).passed).toBe(false)
  })
})

describe('what a learner receives', () => {
  it('has no answer key and no explanation', () => {
    const [question] = learnerQuestions({ questions: [q()] })
    expect(Object.keys(question!).sort()).toEqual(['id', 'kind', 'options', 'prompt'])
    expect(JSON.stringify(question)).not.toContain('correct')
    expect(JSON.stringify(question)).not.toContain('135°F or above.')
  })

  it('counts extra attempts on top of a limit, and leaves unlimited unlimited', () => {
    expect(attemptsAllowed(2, 1)).toBe(3)
    expect(attemptsAllowed(null, 5)).toBeNull()
  })
})
