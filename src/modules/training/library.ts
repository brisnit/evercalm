import type { Tx } from '@/server/db'
import type { Actor } from '@/server/authz/actor'
import { ValidationError } from '@/lib/errors'
import { addLesson, createCourse, updateDraftDetails, updateLesson, getCourse } from './authoring'

/**
 * COURSES A MANAGER DOES NOT HAVE TO WRITE.
 *
 * Round 2 asks for a library of ready-made training alongside the builder,
 * because the reason training never gets written is not that the editor is
 * hard — it is that facing an empty page at the end of a double is hopeless.
 *
 * Adopting one is not a link to somebody else's content: it creates a real
 * draft course in this organization, with real lessons, which the manager then
 * edits in their own words and publishes under their own name. After that it
 * is theirs, and the library has nothing more to do with it.
 */

export interface LibraryLesson {
  title: string
  kind: 'reading' | 'checklist' | 'quiz' | 'practical'
  minutes: number
  body: string
  /** Checklist items or practical criteria, one per line. */
  items?: string
}

export interface LibraryCourse {
  key: string
  industry: 'restaurant' | 'salon_spa' | 'any'
  title: string
  summary: string
  why: string
  lessons: LibraryLesson[]
}

export const COURSE_LIBRARY: LibraryCourse[] = [
  {
    key: 'allergens',
    industry: 'restaurant',
    title: 'Allergen awareness for service',
    summary:
      'How to take, flag and deliver an allergy order so it is right every time — and what to do when you are not sure.',
    why: 'The single highest-consequence thing a new server can get wrong.',
    lessons: [
      {
        title: 'Why this matters',
        kind: 'reading',
        minutes: 4,
        body: 'An allergic guest is trusting a stranger with their safety. Most serious incidents are not caused by a missing ingredient list — they are caused by a message that did not travel: a modification heard but not written, a plate that changed hands, a runner who did not know.\n\nThree rules carry almost all of it.\n\n1. Write it down, every time, even for one table.\n2. Tell the kitchen out loud, and get an answer back.\n3. Carry the plate yourself, and say the allergy out loud when you set it down.\n\nIf you are ever unsure whether a dish is safe, the answer is not a guess. Ask the chef.',
      },
      {
        title: 'Taking the order',
        kind: 'checklist',
        minutes: 3,
        body: 'Work through these in order, at the table, before you leave it.',
        items:
          'Ask which allergy, and how severe\nWrite the allergy on the ticket, not just the modification\nRepeat the order back to the guest\nCheck the dish with the kitchen before promising it\nTell the guest what you have confirmed, in your own words',
      },
      {
        title: 'When something is unclear',
        kind: 'reading',
        minutes: 3,
        body: 'A guest says "a bit of dairy is fine". A ticket says "no nuts" but the dish has a nut oil. A dish is safe as written but the fryer is shared.\n\nIn all three, the answer is the same: stop, and ask the chef before anything leaves the pass. Nobody has ever been disciplined here for asking. Say to the guest: "Let me check that with the kitchen so I can be certain." That sentence is never the wrong thing to say.',
      },
      {
        title: 'Knowledge check',
        kind: 'quiz',
        minutes: 3,
        body: 'A few situations from real service.',
      },
      {
        title: 'Run an allergy ticket with a manager',
        kind: 'practical',
        minutes: 10,
        body: 'Take one real allergy order from greet to delivery with a manager watching.',
        items:
          'Wrote the allergy on the ticket\nConfirmed the dish with the kitchen and waited for an answer\nCarried the plate personally\nSaid the allergy aloud when setting it down',
      },
    ],
  },
  {
    key: 'hot-holding',
    industry: 'restaurant',
    title: 'Hot holding, cooling and reheating',
    summary:
      'The temperatures and times that keep food out of the danger zone, on the line and in the walk-in.',
    why: 'The part of food safety that a health inspection actually tests.',
    lessons: [
      {
        title: 'The danger zone',
        kind: 'reading',
        minutes: 4,
        body: 'Between 41°F and 135°F, bacteria double roughly every twenty minutes. Everything in this course is one idea: move food through that range fast, and hold it outside it.\n\nHot holding: 135°F or above, checked every two hours.\nCooling: 135°F to 70°F within two hours, then 70°F to 41°F within four more.\nReheating: to 165°F within two hours, once.\n\nThose are the numbers. The rest is how to hit them on a Friday.',
      },
      {
        title: 'Cooling a hot pan',
        kind: 'checklist',
        minutes: 3,
        body: 'Never put a full hotel pan straight in the walk-in. It will sit at 90°F overnight and everything around it will warm up.',
        items:
          'Split into shallow pans, no more than two inches deep\nUse an ice bath or ice wand for stocks and sauces\nLeave uncovered until it is below 70°F\nLabel with the time cooling started\nCheck and record the temperature at the two-hour mark',
      },
      {
        title: 'Knowledge check',
        kind: 'quiz',
        minutes: 3,
        body: 'Numbers and judgement calls.',
      },
    ],
  },
  {
    key: 'first-week',
    industry: 'any',
    title: 'Your first week here',
    summary:
      'How we work, what we expect, and who to ask. Everything a new person needs before their first shift.',
    why: 'The course every new hire should have, and almost nobody writes.',
    lessons: [
      {
        title: 'How we work',
        kind: 'reading',
        minutes: 5,
        body: 'Replace this with how your business actually works: what the place is for, what a good shift looks like, and the two or three things you care about more than anything else.\n\nThe library gives you the shape. The words should be yours — a new person can tell the difference immediately, and the ones written by the owner are the ones that get read.',
      },
      {
        title: 'Before your first shift',
        kind: 'checklist',
        minutes: 3,
        body: 'Small things that make the first day easier.',
        items:
          'Know where to park and which door to use\nKnow what to wear and what to bring\nSave your manager’s number in your phone\nCheck your schedule in EverCalm\nAsk anything you are unsure about — before the day, not during it',
      },
      {
        title: 'Who to ask',
        kind: 'reading',
        minutes: 2,
        body: 'Name the people here. Who runs the floor, who runs the kitchen, who to call when you cannot make a shift, and who to talk to if something is wrong and you do not want to raise it with your manager.\n\nA new person who knows who to ask stops being new about two weeks sooner.',
      },
    ],
  },
  {
    key: 'wine-service',
    industry: 'restaurant',
    title: 'Wine service fundamentals',
    summary:
      'Presenting, opening and pouring a bottle at the table without making it a performance.',
    why: 'A small, teachable skill that visibly raises the room.',
    lessons: [
      {
        title: 'Presenting and opening',
        kind: 'reading',
        minutes: 4,
        body: 'Present the bottle label-first to whoever ordered it and say the producer and vintage. Wait for the nod.\n\nCut the foil below the lip so nothing the wine touches has been handled. Insert the worm slightly off-centre, turn until one spiral remains, and lever in two stages. The cork should leave the bottle with a sigh, not a pop.\n\nPour a taste — about an ounce — for the person who ordered. Wait. Then pour the table, women and guests first where that is the house style, the host last, and return the bottle to the table label out.',
      },
      {
        title: 'Open a bottle at the table',
        kind: 'practical',
        minutes: 10,
        body: 'With a manager watching, at a real table or a set one.',
        items:
          'Presented label-first and named producer and vintage\nCut foil below the lip\nRemoved the cork cleanly and quietly\nPoured a taste and waited\nPoured the table and set the bottle label out',
      },
    ],
  },
  {
    key: 'consultation',
    industry: 'salon_spa',
    title: 'The consultation',
    summary:
      'The ten minutes before the first cut, and how to leave them with the client agreeing to what you are about to do.',
    why: 'Almost every unhappy client was lost before the service started.',
    lessons: [
      {
        title: 'What a consultation is for',
        kind: 'reading',
        minutes: 4,
        body: 'A consultation is not a preamble. It is where you and the client agree on one outcome, in words you both understand, before anything is irreversible.\n\nThree questions carry it: what do you want it to look like, what does your hair do on a bad day, and how much time will you give it in the morning? The third one is the one that decides whether they love it in two weeks.',
      },
      {
        title: 'Before you start',
        kind: 'checklist',
        minutes: 3,
        body: 'Run through these with the client in the chair, before the gown goes on.',
        items:
          'Asked what they want, in their words\nLooked at and felt the hair dry\nAsked about the last colour service and any home colour\nAgreed the length and the shape out loud\nSaid what you would not recommend, and why\nAgreed the price before starting',
      },
    ],
  },
]

/**
 * Make one of these a real course in this organization.
 *
 * Everything is created as a draft: the manager edits and publishes it
 * themselves, under their own name, and nothing reaches an employee until
 * they do.
 */
export async function adoptFromLibrary(tx: Tx, actor: Actor, key: string): Promise<string> {
  const entry = COURSE_LIBRARY.find((course) => course.key === key)
  if (!entry) throw new ValidationError({ key: ['That course is not in the library.'] })

  const courseId = await createCourse(tx, actor, { title: entry.title, summary: entry.summary })
  const course = await getCourse(tx, actor, courseId)
  const versionId = course.draft!.id

  await updateDraftDetails(tx, actor, versionId, {
    title: entry.title,
    summary: entry.summary,
  })

  for (const lesson of entry.lessons) {
    const lessonId = await addLesson(tx, actor, versionId, {
      title: lesson.title,
      kind: lesson.kind,
      estimatedMinutes: lesson.minutes,
    })
    await updateLesson(tx, actor, lessonId, {
      title: lesson.title,
      estimatedMinutes: lesson.minutes,
      body: lesson.body,
      itemsText: lesson.items,
    })
  }

  return courseId
}

/**
 * Turn something a business already has into a course.
 *
 * Most operators do not need a course written — they need the policy that is
 * already in a shared drive to become something a person can be assigned and
 * shown to have read. Paste it, and each section becomes a reading lesson:
 * a short line on its own is treated as a heading, and the paragraphs under it
 * are that lesson's body.
 *
 * Deliberately text, not a file: uploading a PDF needs file storage and text
 * extraction, which is written down in the deferred list rather than faked.
 */
export function splitIntoLessons(text: string): { title: string; body: string }[] {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const out: { title: string; body: string }[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const first = lines[0]!.trim()
    const looksLikeHeading =
      lines.length === 1 && first.length <= 80 && !first.endsWith('.') && !first.endsWith(',')

    if (looksLikeHeading) {
      out.push({ title: first.replace(/^#+\s*/, ''), body: '' })
      continue
    }
    if (out.length === 0) {
      out.push({ title: 'Introduction', body: block })
      continue
    }
    const current = out[out.length - 1]!
    current.body = current.body ? `${current.body}\n\n${block}` : block
  }

  return out.filter((lesson) => lesson.body.trim().length > 0).slice(0, 20)
}

export async function importCourseFromText(
  tx: Tx,
  actor: Actor,
  input: { title: string; summary: string; text: string },
): Promise<{ courseId: string; lessons: number }> {
  const lessons = splitIntoLessons(input.text)
  if (lessons.length === 0) {
    throw new ValidationError({
      text: ['Paste the text of the document. We could not find anything to turn into a lesson.'],
    })
  }

  const courseId = await createCourse(tx, actor, { title: input.title, summary: input.summary })
  const course = await getCourse(tx, actor, courseId)
  const versionId = course.draft!.id

  for (const lesson of lessons) {
    // A rough reading pace: two hundred words a minute, rounded up.
    const minutes = Math.max(1, Math.ceil(lesson.body.split(/\s+/).length / 200))
    const lessonId = await addLesson(tx, actor, versionId, {
      title: lesson.title,
      kind: 'reading',
      estimatedMinutes: minutes,
    })
    await updateLesson(tx, actor, lessonId, {
      title: lesson.title,
      estimatedMinutes: minutes,
      body: lesson.body,
    })
  }

  return { courseId, lessons: lessons.length }
}
