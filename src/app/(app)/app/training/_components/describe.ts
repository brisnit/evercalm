import type { LessonContent } from '@/modules/training/content'

/** "5 items", "4 questions · pass mark 80%" - what a lesson holds, in a phrase. */
export function describeLesson(content: LessonContent): string {
  switch (content.kind) {
    case 'checklist':
      return `${content.items.length} ${content.items.length === 1 ? 'item' : 'items'}`
    case 'practical':
      return `${content.criteria.length} ${content.criteria.length === 1 ? 'point' : 'points'} to observe`
    case 'quiz':
      return `${content.questions.length} ${content.questions.length === 1 ? 'question' : 'questions'} · pass mark ${content.passPercent}%${
        content.maxAttempts
          ? ` · ${content.maxAttempts} ${content.maxAttempts === 1 ? 'attempt' : 'attempts'}`
          : ''
      }`
    default:
      return ''
  }
}
