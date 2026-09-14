import { and, desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { newId } from '@/lib/ids'
import { addCalendarDays, businessDate } from '@/lib/dates'
import {
  buildQuestion,
  linesToItems,
  serializeContent,
  type LessonContent,
  type QuizQuestion,
} from '@/modules/training/content'
import * as schema from '../full-schema'
import type { SeedOrganization } from './data'

/*
 * TRAINING DEMO DATA.
 *
 * Written by people who do the work. The restaurant's courses are about
 * allergens at the pass and cooling stock in the walk-in; the salon's are
 * about patch tests before colour and disinfecting a station between guests.
 * The tables and code are identical; nothing is borrowed across industries.
 *
 * Every state a manager or employee should be able to see exists somewhere:
 *
 *   a course with two published versions, and people on each
 *   someone not started on an OLDER version, who can be moved
 *   in progress, overdue, waiting for sign-off, completed, and a draft
 *
 * Dates are relative to the day the seed runs, in the organization's
 * timezone, so the demo stays plausible.
 */

type SeedDb = NodePgDatabase<typeof schema>

interface QuestionSeed {
  kind: 'single' | 'multiple' | 'true_false'
  prompt: string
  options?: string[]
  correct: number[]
  explanation: string
}

interface LessonSeed {
  title: string
  kind: 'reading' | 'checklist' | 'quiz' | 'practical'
  minutes: number
  body: string
  items?: string[]
  criteria?: string[]
  quiz?: { passPercent: number; maxAttempts?: number; questions: QuestionSeed[] }
}

interface VersionSeed {
  title: string
  summary: string
  changeNote?: string
  /** Null leaves it a draft. */
  publishedDaysAgo: number | null
  lessons: LessonSeed[]
}

interface CourseSeed {
  key: string
  author: string
  versions: VersionSeed[]
}

interface AssignmentSeed {
  course: string
  version: number
  person: string
  assignedBy: string
  location: string
  assignedDaysAgo: number
  dueInDays?: number
  /** Lessons completed, in course order. */
  completed: number | 'all'
  /** The next lesson (a practical) is waiting for a manager. */
  awaitingSignoff?: boolean
  signedOffBy?: string
  /** A failed first attempt before the pass, for a realistic record. */
  retriedQuiz?: boolean
}

interface TrainingSeed {
  courses: CourseSeed[]
  assignments: AssignmentSeed[]
}

// ---------------------------------------------------------------------------
// Harbor & Vine
// ---------------------------------------------------------------------------

const ALLERGEN_ORDER: LessonSeed = {
  title: 'Taking an allergy order',
  kind: 'reading',
  minutes: 5,
  body: [
    'An allergy is not a preference. Treat every mention of one as a safety order, even when the guest says "it is only mild".',
    '',
    '1. **Ask** which allergen, and whether cross-contact matters (shared fryer oil, the same cutting board).',
    '2. **Check** the allergen matrix at the host stand. If a dish is not on it, the answer is "let me ask the kitchen", never a guess.',
    '3. **Flag** the ticket: ring the item with the ALLERGY modifier and type the allergen in the note.',
    '4. **Tell** the expo out loud as you fire it. The ticket alone is not enough on a busy rail.',
    '5. **Run it yourself** or hand it only to someone you have told. Allergy plates never go out on a tray with other plates.',
    '',
    'If you are unsure at any step, stop and get the manager on duty.',
  ].join('\n'),
}

const ALLERGEN_PASS: LessonSeed = {
  title: 'Before the plate leaves the pass',
  kind: 'checklist',
  minutes: 4,
  body: 'Run through this at the pass for every plate with an allergy flag. Tick each step as you would on a real ticket.',
  items: [
    'The ticket shows the ALLERGY modifier and the allergen in the note',
    'The expo has read the allergen back to you',
    'The plate is garnished from a clean container, not the shared garnish tray',
    'The plate has an allergy pick in it',
    'You are carrying it to the table yourself',
  ],
}

const ALLERGEN_PRACTICAL: LessonSeed = {
  title: 'Walk a manager through an allergy ticket',
  kind: 'practical',
  minutes: 10,
  body: 'During a quiet part of service, take a real or practice allergy order from start to finish while a manager watches. They sign it off here.',
  criteria: [
    'Asks which allergen and whether cross-contact matters',
    'Checks the allergen matrix instead of guessing',
    'Rings the ALLERGY modifier with the allergen in the note',
    'Tells the expo out loud when firing',
    'Runs the plate without stacking it with others',
  ],
}

const HARBOR: TrainingSeed = {
  courses: [
    {
      key: 'allergens',
      author: 'owner',
      versions: [
        {
          title: 'Allergen awareness for service',
          summary: 'How we take, flag and deliver an allergy order, so it is right every time.',
          publishedDaysAgo: 45,
          lessons: [
            {
              title: 'The major food allergens',
              kind: 'reading',
              minutes: 6,
              body: [
                'Eight foods cause most serious allergic reactions. Know them by heart:',
                '',
                '- Milk',
                '- Eggs',
                '- Fish (such as bass, cod, flounder)',
                '- Crustacean shellfish (crab, lobster, shrimp)',
                '- Tree nuts (almonds, walnuts, pecans)',
                '- Peanuts',
                '- Wheat',
                '- Soybeans',
                '',
                'A reaction can start within minutes and can be fatal. There is no safe "small amount" for someone with a severe allergy.',
              ].join('\n'),
            },
            ALLERGEN_ORDER,
            ALLERGEN_PASS,
            {
              title: 'Knowledge check',
              kind: 'quiz',
              minutes: 5,
              body: 'Four questions. You need all four right, and you can try again.',
              quiz: {
                passPercent: 100,
                questions: [
                  {
                    kind: 'single',
                    prompt:
                      'A guest says they are "a little allergic" to shellfish. What do you do?',
                    options: [
                      'Treat it as a full allergy order',
                      'Ask the kitchen to go light on shellfish',
                      'Suggest a dish without obvious shellfish',
                    ],
                    correct: [0],
                    explanation: 'Every allergy is a safety order. Severity is not ours to judge.',
                  },
                  {
                    kind: 'true_false',
                    prompt:
                      'Ringing the ALLERGY modifier on the ticket is enough; you do not need to tell the expo.',
                    correct: [1],
                    explanation:
                      'Always tell the expo out loud as well. Tickets get missed on a busy rail.',
                  },
                  {
                    kind: 'single',
                    prompt:
                      'A dish is not on the allergen matrix. The guest asks if it contains nuts.',
                    options: [
                      'Say it probably does not',
                      'Say you will ask the kitchen, then ask',
                      'Recommend they avoid it without checking',
                    ],
                    correct: [1],
                    explanation: 'Never guess. Ask the kitchen and come back with an answer.',
                  },
                  {
                    kind: 'multiple',
                    prompt: 'Which of these are major allergens?',
                    options: ['Peanuts', 'Garlic', 'Soybeans', 'Wheat'],
                    correct: [0, 2, 3],
                    explanation:
                      'Garlic can be an allergen for some people, but it is not one of the major allergens.',
                  },
                ],
              },
            },
            ALLERGEN_PRACTICAL,
          ],
        },
        {
          title: 'Allergen awareness for service',
          summary: 'How we take, flag and deliver an allergy order, so it is right every time.',
          changeNote:
            'Adds sesame as the ninth major allergen, now labelled on our menu, and a knowledge-check question about it.',
          publishedDaysAgo: 6,
          lessons: [
            {
              title: 'The nine major food allergens',
              kind: 'reading',
              minutes: 6,
              body: [
                'Nine foods cause most serious allergic reactions. Know them by heart:',
                '',
                '- Milk',
                '- Eggs',
                '- Fish (such as bass, cod, flounder)',
                '- Crustacean shellfish (crab, lobster, shrimp)',
                '- Tree nuts (almonds, walnuts, pecans)',
                '- Peanuts',
                '- Wheat',
                '- Soybeans',
                '- **Sesame**, including tahini, sesame oil and the seeds on our brioche buns',
                '',
                'A reaction can start within minutes and can be fatal. There is no safe "small amount" for someone with a severe allergy.',
              ].join('\n'),
            },
            ALLERGEN_ORDER,
            ALLERGEN_PASS,
            {
              title: 'Knowledge check',
              kind: 'quiz',
              minutes: 6,
              body: 'Five questions. You need all five right, and you can try again.',
              quiz: {
                passPercent: 100,
                questions: [
                  {
                    kind: 'single',
                    prompt:
                      'A guest says they are "a little allergic" to shellfish. What do you do?',
                    options: [
                      'Treat it as a full allergy order',
                      'Ask the kitchen to go light on shellfish',
                      'Suggest a dish without obvious shellfish',
                    ],
                    correct: [0],
                    explanation: 'Every allergy is a safety order. Severity is not ours to judge.',
                  },
                  {
                    kind: 'true_false',
                    prompt:
                      'Ringing the ALLERGY modifier on the ticket is enough; you do not need to tell the expo.',
                    correct: [1],
                    explanation:
                      'Always tell the expo out loud as well. Tickets get missed on a busy rail.',
                  },
                  {
                    kind: 'single',
                    prompt:
                      'A dish is not on the allergen matrix. The guest asks if it contains nuts.',
                    options: [
                      'Say it probably does not',
                      'Say you will ask the kitchen, then ask',
                      'Recommend they avoid it without checking',
                    ],
                    correct: [1],
                    explanation: 'Never guess. Ask the kitchen and come back with an answer.',
                  },
                  {
                    kind: 'multiple',
                    prompt: 'Which of these are major allergens?',
                    options: ['Peanuts', 'Garlic', 'Soybeans', 'Sesame'],
                    correct: [0, 2, 3],
                    explanation:
                      'Sesame is now the ninth major allergen. Garlic is not one of the nine.',
                  },
                  {
                    kind: 'single',
                    prompt: 'A guest with a sesame allergy orders the burger. What changes?',
                    options: [
                      'Nothing, sesame is only in the dressing',
                      'Flag it and ask the kitchen for a bun without sesame seeds',
                      'Scrape the seeds off the bun',
                    ],
                    correct: [1],
                    explanation:
                      'Our brioche buns carry sesame seeds. Scraping them off still leaves sesame behind.',
                  },
                ],
              },
            },
            ALLERGEN_PRACTICAL,
          ],
        },
      ],
    },
    {
      key: 'cooling',
      author: 'owner',
      versions: [
        {
          title: 'Hot holding, cooling and reheating',
          summary:
            'The temperatures and times that keep food out of the danger zone on the line and in the walk-in.',
          publishedDaysAgo: 21,
          lessons: [
            {
              title: 'Temperatures that keep food safe',
              kind: 'reading',
              minutes: 7,
              body: [
                'Bacteria grow fastest between 41°F and 135°F. Our job is to move food through that range quickly and keep it out of it.',
                '',
                '- **Hot holding:** 135°F or above. Check the steam well with a probe every two hours and log it.',
                '- **Cold holding:** 41°F or below, in the reach-ins and the walk-in.',
                '- **Cooling:** from 135°F to 70°F within 2 hours, then to 41°F within the next 4 hours.',
                '- **Reheating** for hot holding: to 165°F within 2 hours.',
                '',
                'If food misses a cooling step, tell the sous chef. It is reheated and started again, or thrown away; it is never quietly put in the walk-in.',
              ].join('\n'),
            },
            {
              title: 'Cooling a batch of stock',
              kind: 'checklist',
              minutes: 5,
              body: 'The steps for cooling anything over a gallon. Tick them off the next time you cool stock or braising liquid.',
              items: [
                'Divide it into shallow pans no more than two inches deep',
                'Use an ice wand or an ice bath and stir',
                'Probe it and write the start time and temperature on the cooling log',
                'Check it has reached 70°F by the two-hour mark',
                'Label with the date and your initials before it goes in the walk-in',
              ],
            },
            {
              title: 'Knowledge check',
              kind: 'quiz',
              minutes: 5,
              body: 'Four questions. Three right is a pass.',
              quiz: {
                passPercent: 75,
                maxAttempts: 3,
                questions: [
                  {
                    kind: 'single',
                    prompt: 'What is the minimum temperature for hot holding?',
                    options: ['120°F', '135°F', '165°F'],
                    correct: [1],
                    explanation: 'Hot food is held at 135°F or above.',
                  },
                  {
                    kind: 'single',
                    prompt: 'Cooked rice is at 135°F at 3:00 pm. By when must it reach 70°F?',
                    options: ['4:00 pm', '5:00 pm', '9:00 pm'],
                    correct: [1],
                    explanation: 'The first stage is 135°F to 70°F within two hours.',
                  },
                  {
                    kind: 'true_false',
                    prompt:
                      'A stockpot can go straight into the walk-in to cool as long as the lid is off.',
                    correct: [1],
                    explanation:
                      'A full pot cools far too slowly. Shallow pans and an ice wand first.',
                  },
                  {
                    kind: 'single',
                    prompt:
                      'Chili from yesterday is going back into the steam well. What temperature must it reach first?',
                    options: ['135°F', '150°F', '165°F within 2 hours'],
                    correct: [2],
                    explanation: 'Reheat to 165°F within two hours before hot holding.',
                  },
                ],
              },
            },
            {
              title: 'Calibrate a probe thermometer',
              kind: 'practical',
              minutes: 10,
              body: 'Show the sous chef or a manager how you check and adjust a probe thermometer before service.',
              criteria: [
                'Makes an ice slurry, not just cold water',
                'Keeps the stem in for at least two inches and waits for the reading to settle',
                'Reads 32°F, or adjusts the calibration nut until it does',
                'Cleans and sanitizes the probe afterwards',
              ],
            },
          ],
        },
      ],
    },
    {
      key: 'wine',
      author: 'owner',
      versions: [
        {
          title: 'Wine service fundamentals',
          summary: 'Presenting, opening and pouring a bottle at the table.',
          publishedDaysAgo: null,
          lessons: [
            {
              title: 'Presenting and opening a bottle',
              kind: 'reading',
              minutes: 6,
              body: [
                'Present the bottle label-first to the person who ordered it and say the producer, wine and vintage.',
                '',
                'Cut the foil below the lip, draw the cork quietly, and wipe the neck before the first pour.',
              ].join('\n'),
            },
            {
              title: 'Setting up for a wine order',
              kind: 'checklist',
              minutes: 3,
              body: 'Before you go to the table.',
              items: [
                'Correct glasses for the wine, polished',
                'Wine key and a folded service cloth',
                'Ice bucket ready for whites and sparkling',
              ],
            },
          ],
        },
      ],
    },
  ],
  assignments: [
    {
      course: 'allergens',
      version: 1,
      person: 'server',
      assignedBy: 'gm-riverside',
      location: 'riverside',
      assignedDaysAgo: 40,
      dueInDays: -26,
      completed: 'all',
      signedOffBy: 'gm-riverside',
    },
    {
      course: 'allergens',
      version: 1,
      person: 'host',
      assignedBy: 'gm-downtown',
      location: 'downtown',
      assignedDaysAgo: 9,
      dueInDays: 10,
      completed: 0,
    },
    {
      course: 'allergens',
      version: 2,
      person: 'new-server',
      assignedBy: 'gm-riverside',
      location: 'riverside',
      assignedDaysAgo: 5,
      dueInDays: 5,
      completed: 2,
    },
    {
      course: 'allergens',
      version: 2,
      person: 'bartender',
      assignedBy: 'gm-riverside',
      location: 'riverside',
      assignedDaysAgo: 5,
      dueInDays: -2,
      completed: 1,
    },
    {
      course: 'allergens',
      version: 2,
      person: 'dual-server',
      assignedBy: 'gm-downtown',
      location: 'downtown',
      assignedDaysAgo: 5,
      dueInDays: 9,
      completed: 4,
      awaitingSignoff: true,
      retriedQuiz: true,
    },
    {
      course: 'cooling',
      version: 1,
      person: 'prep',
      assignedBy: 'gm-riverside',
      location: 'riverside',
      assignedDaysAgo: 20,
      dueInDays: -6,
      completed: 'all',
      signedOffBy: 'gm-riverside',
      retriedQuiz: true,
    },
    {
      course: 'cooling',
      version: 1,
      person: 'sous',
      assignedBy: 'gm-riverside',
      location: 'riverside',
      assignedDaysAgo: 20,
      completed: 'all',
      signedOffBy: 'gm-riverside',
    },
    {
      course: 'cooling',
      version: 1,
      person: 'new-cook',
      assignedBy: 'gm-riverside',
      location: 'riverside',
      assignedDaysAgo: 4,
      dueInDays: 3,
      completed: 0,
    },
  ],
}

// ---------------------------------------------------------------------------
// Lumen Salon & Spa
// ---------------------------------------------------------------------------

const DISINFECT_RESET: LessonSeed = {
  title: 'Resetting a chair or treatment room',
  kind: 'checklist',
  minutes: 4,
  body: 'Between every guest. Tick each step the next time you reset.',
  items: [
    'Throw away single-use items: neck strips, cotton, buffers, used wax spatulas',
    'Wash combs, brushes and implements with soap and water, then fully immerse them',
    'Wipe the chair or table, headrest and armrests with disinfectant',
    'Put used towels and linens in the closed laundry bin',
    'Store disinfected tools in the clean, closed container',
    'Wash your hands before you greet the next guest',
  ],
}

const LUMEN: TrainingSeed = {
  courses: [
    {
      key: 'patch-test',
      author: 'trainer',
      versions: [
        {
          title: 'Patch testing and colour consultation',
          summary:
            'Keeping colour guests safe, and making sure what we mix is what they asked for.',
          publishedDaysAgo: 28,
          lessons: [
            {
              title: 'Why we patch test',
              kind: 'reading',
              minutes: 6,
              body: [
                'Permanent and demi-permanent colour contains ingredients such as PPD and PTD that can cause allergic reactions, sometimes years after someone first coloured their hair.',
                '',
                "We do a **skin allergy alert test 48 hours before** the appointment, following the manufacturer's instructions for the line we are using:",
                '',
                '- every new colour guest',
                '- anyone who has not had colour with us in the last six months',
                '- anyone who has changed brands, or tells us about a reaction, a new medication, or a tattoo since their last visit',
                '',
                'Record the date and the result on their colour card. **No result on file, no colour** - offer to rebook, and never skip it because the book is busy.',
              ].join('\n'),
            },
            {
              title: 'The consultation',
              kind: 'reading',
              minutes: 7,
              body: [
                "A good consultation happens before the cape goes on, sitting at eye level, with the guest's hair dry.",
                '',
                '1. **History:** box dye, henna, keratin or relaxers in the last two years. These change how colour lifts and deposits.',
                '2. **Scalp:** any tenderness, broken skin or irritation. If you see any, we do not colour today.',
                '3. **Goal:** use photos, not words. "Honey blonde" means something different to everyone.',
                '4. **Maintenance:** how often they can come in, and how much time they spend styling.',
                '5. **Price and time:** quote before you start, including any correction work.',
              ].join('\n'),
            },
            {
              title: 'Before you mix',
              kind: 'checklist',
              minutes: 4,
              body: 'Every colour service, every time.',
              items: [
                'A patch test result from the last 48 hours to six months is on their colour card',
                'You have done a strand test if there is box dye or henna in their history',
                'The formula card is updated before you mix',
                'The guest has agreed the price and time',
                'Gloves on, cape and towel secured',
              ],
            },
            {
              title: 'Knowledge check',
              kind: 'quiz',
              minutes: 5,
              body: 'Five questions. Four right is a pass.',
              quiz: {
                passPercent: 80,
                questions: [
                  {
                    kind: 'single',
                    prompt: 'When is the skin allergy alert test done?',
                    options: [
                      'At the start of the appointment',
                      '48 hours before the appointment',
                      'Only if the guest asks',
                    ],
                    correct: [1],
                    explanation:
                      "Forty-eight hours before, following the manufacturer's instructions.",
                  },
                  {
                    kind: 'multiple',
                    prompt: 'Who needs a patch test before colour?',
                    options: [
                      'A new colour guest',
                      'A regular whose last colour with us was eight months ago',
                      'A regular who came in for colour three weeks ago with no changes',
                      'A regular who has started a new medication',
                    ],
                    correct: [0, 1, 3],
                    explanation:
                      'New guests, anyone past six months, and anyone with a change such as a new medication.',
                  },
                  {
                    kind: 'true_false',
                    prompt:
                      'If the book is running late, it is fine to skip the patch test for a guest who has never reacted before.',
                    correct: [1],
                    explanation: 'No result on file, no colour. Offer to rebook instead.',
                  },
                  {
                    kind: 'single',
                    prompt:
                      'A guest mentions henna from last summer. What do you do before colouring?',
                    options: [
                      'Nothing, henna has washed out',
                      'A strand test',
                      'Use a stronger developer',
                    ],
                    correct: [1],
                    explanation:
                      'Henna and box dye can react unpredictably with salon colour. Strand test first.',
                  },
                  {
                    kind: 'single',
                    prompt: 'During the consultation you notice broken skin on the scalp.',
                    options: [
                      'Apply colour away from that area',
                      'Do not colour today, and explain why',
                      'Use a barrier cream and continue',
                    ],
                    correct: [1],
                    explanation: 'Broken or irritated skin means no colour service today.',
                  },
                ],
              },
            },
            {
              title: 'Consultation observed by an educator',
              kind: 'practical',
              minutes: 20,
              body: 'Run a full colour consultation with a real or model guest while Yuki or your salon manager observes.',
              criteria: [
                'Checks the colour card for a current patch test result',
                'Asks about box dye, henna and chemical treatments',
                'Checks the scalp before agreeing to the service',
                'Confirms the goal with photos',
                'Quotes the price and time before starting',
              ],
            },
          ],
        },
      ],
    },
    {
      key: 'disinfection',
      author: 'trainer',
      versions: [
        {
          title: 'Disinfection between guests',
          summary:
            'Cleaning and disinfecting tools and stations so every guest gets a clean start.',
          publishedDaysAgo: 70,
          lessons: [
            {
              title: 'Clean, then disinfect',
              kind: 'reading',
              minutes: 5,
              body: [
                'Disinfectant cannot work through hair, product or skin. Always **clean first** with soap and water, then disinfect.',
                '',
                '- Use the EPA-registered disinfectant at the dispensary, mixed fresh each morning.',
                '- Fully immerse tools for ten minutes.',
                '- Anything porous that cannot be disinfected is single-use and goes in the bin after one guest.',
              ].join('\n'),
            },
            DISINFECT_RESET,
            {
              title: 'Knowledge check',
              kind: 'quiz',
              minutes: 4,
              body: 'Four questions. Three right is a pass.',
              quiz: {
                passPercent: 75,
                questions: [
                  {
                    kind: 'true_false',
                    prompt:
                      'You can disinfect a comb without washing it first, as long as it is fully immersed.',
                    correct: [1],
                    explanation: 'Clean first. Disinfectant cannot reach through product and hair.',
                  },
                  {
                    kind: 'multiple',
                    prompt: 'Which are single-use?',
                    options: ['Nail buffer', 'Metal cuticle pusher', 'Neck strip', 'Cotton pad'],
                    correct: [0, 2, 3],
                    explanation: 'Porous items cannot be disinfected. Metal tools can.',
                  },
                  {
                    kind: 'single',
                    prompt: 'Where do used towels go?',
                    options: [
                      'Folded on the trolley',
                      'In the closed laundry bin',
                      'Over the back of the chair',
                    ],
                    correct: [1],
                    explanation: 'Used linens go straight into a closed container.',
                  },
                  {
                    kind: 'single',
                    prompt: 'When is the disinfectant mixed?',
                    options: ['Fresh each morning', 'Once a week', 'When it looks cloudy'],
                    correct: [0],
                    explanation: 'Mixed fresh at the start of every day.',
                  },
                ],
              },
            },
          ],
        },
        {
          title: 'Disinfection between guests',
          summary:
            'Cleaning and disinfecting tools and stations so every guest gets a clean start.',
          changeNote:
            'Contact time now follows the label on our disinfectant instead of a fixed ten minutes, and wax spatulas are single-use: no double-dipping.',
          publishedDaysAgo: 3,
          lessons: [
            {
              title: 'Clean, then disinfect',
              kind: 'reading',
              minutes: 5,
              body: [
                'Disinfectant cannot work through hair, product or skin. Always **clean first** with soap and water, then disinfect.',
                '',
                '- Use the EPA-registered disinfectant at the dispensary, mixed fresh each morning.',
                '- Fully immerse tools for the **contact time on the label**. Our current product says five minutes; a different product may say something else.',
                '- Anything porous that cannot be disinfected is single-use and goes in the bin after one guest.',
                '- **Wax spatulas are single-use.** Once a spatula has touched skin, it never goes back into the pot.',
              ].join('\n'),
            },
            DISINFECT_RESET,
            {
              title: 'Knowledge check',
              kind: 'quiz',
              minutes: 4,
              body: 'Four questions. Three right is a pass.',
              quiz: {
                passPercent: 75,
                questions: [
                  {
                    kind: 'true_false',
                    prompt:
                      'You can disinfect a comb without washing it first, as long as it is fully immersed.',
                    correct: [1],
                    explanation: 'Clean first. Disinfectant cannot reach through product and hair.',
                  },
                  {
                    kind: 'multiple',
                    prompt: 'Which are single-use?',
                    options: [
                      'Nail buffer',
                      'Metal cuticle pusher',
                      'Neck strip',
                      'Wax spatula once used',
                    ],
                    correct: [0, 2, 3],
                    explanation:
                      'Porous items and used spatulas are single-use. Metal tools can be disinfected.',
                  },
                  {
                    kind: 'single',
                    prompt: 'How long do tools stay immersed?',
                    options: [
                      'Ten minutes, always',
                      'The contact time on the disinfectant label',
                      'Until the next guest arrives',
                    ],
                    correct: [1],
                    explanation: 'Follow the label for the product we are using.',
                  },
                  {
                    kind: 'single',
                    prompt: 'Where do used towels go?',
                    options: [
                      'Folded on the trolley',
                      'In the closed laundry bin',
                      'Over the back of the chair',
                    ],
                    correct: [1],
                    explanation: 'Used linens go straight into a closed container.',
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      key: 'desk',
      author: 'trainer',
      versions: [
        {
          title: 'Rebooking and retail at the desk',
          summary:
            'Helping guests leave with their next appointment and the right products for their hair and skin.',
          publishedDaysAgo: 50,
          lessons: [
            {
              title: 'Rebooking before the guest leaves',
              kind: 'reading',
              minutes: 5,
              body: [
                'Guests who book their next visit before leaving come back. Ask the provider what they recommend, then offer two specific times.',
                '',
                '"Grace suggests your next facial in four weeks. Would Tuesday the 14th at 10 or Thursday the 16th at 3 suit you?"',
              ].join('\n'),
            },
            {
              title: 'The checkout conversation',
              kind: 'checklist',
              minutes: 3,
              body: 'At every checkout.',
              items: [
                'Ask how the service felt',
                'Mention the products the provider used and noted on the ticket',
                'Offer two specific times for the next visit',
                'Confirm their mobile number for appointment reminders',
              ],
            },
            {
              title: 'Knowledge check',
              kind: 'quiz',
              minutes: 3,
              body: 'Three questions. Two right is a pass.',
              quiz: {
                passPercent: 66,
                questions: [
                  {
                    kind: 'single',
                    prompt: 'What is the best way to offer a rebooking?',
                    options: [
                      '"Do you want to book again?"',
                      'Two specific times the provider recommends',
                      'Wait for the guest to ask',
                    ],
                    correct: [1],
                    explanation: 'Specific times are easier to say yes to.',
                  },
                  {
                    kind: 'true_false',
                    prompt:
                      'Recommend products based on what the provider noted on the ticket, not on what is on promotion.',
                    correct: [0],
                    explanation: 'The recommendation should fit the guest.',
                  },
                  {
                    kind: 'single',
                    prompt: 'A guest says they will book later. What do you do?',
                    options: [
                      'Push for a booking now',
                      'Thank them and offer a reminder text',
                      'Book a time anyway',
                    ],
                    correct: [1],
                    explanation: 'Respect the answer and make it easy to come back.',
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      key: 'balayage',
      author: 'trainer',
      versions: [
        {
          title: 'Balayage foundations',
          summary: 'Placement, saturation and toning for a soft, lived-in lift.',
          publishedDaysAgo: null,
          lessons: [
            {
              title: 'Sectioning for balayage',
              kind: 'reading',
              minutes: 8,
              body: 'Start with a horseshoe section and work in diagonal-back slices. Keep the paint on the surface of each slice.',
            },
          ],
        },
      ],
    },
  ],
  assignments: [
    {
      course: 'patch-test',
      version: 1,
      person: 'stylist-senior',
      assignedBy: 'trainer',
      location: 'pearl',
      assignedDaysAgo: 26,
      completed: 'all',
      signedOffBy: 'trainer',
    },
    {
      course: 'patch-test',
      version: 1,
      person: 'colourist',
      assignedBy: 'gm-pearl',
      location: 'pearl',
      assignedDaysAgo: 14,
      dueInDays: 4,
      completed: 4,
      awaitingSignoff: true,
    },
    {
      course: 'patch-test',
      version: 1,
      person: 'new-stylist',
      assignedBy: 'gm-pearl',
      location: 'pearl',
      assignedDaysAgo: 8,
      dueInDays: 6,
      completed: 2,
    },
    {
      course: 'patch-test',
      version: 1,
      person: 'apprentice',
      assignedBy: 'gm-pearl',
      location: 'pearl',
      assignedDaysAgo: 8,
      dueInDays: 12,
      completed: 2,
    },
    {
      course: 'disinfection',
      version: 1,
      person: 'esthetician',
      assignedBy: 'gm-pearl',
      location: 'pearl',
      assignedDaysAgo: 60,
      completed: 'all',
    },
    {
      course: 'disinfection',
      version: 1,
      person: 'apprentice',
      assignedBy: 'gm-pearl',
      location: 'pearl',
      assignedDaysAgo: 10,
      dueInDays: 8,
      completed: 0,
    },
    {
      course: 'disinfection',
      version: 2,
      person: 'new-stylist',
      assignedBy: 'gm-pearl',
      location: 'pearl',
      assignedDaysAgo: 3,
      completed: 'all',
      retriedQuiz: true,
    },
    {
      course: 'disinfection',
      version: 2,
      person: 'massage',
      assignedBy: 'gm-bench',
      location: 'bench',
      assignedDaysAgo: 2,
      dueInDays: 5,
      completed: 1,
    },
    {
      course: 'desk',
      version: 1,
      person: 'coordinator',
      assignedBy: 'gm-pearl',
      location: 'pearl',
      assignedDaysAgo: 40,
      completed: 'all',
    },
    {
      course: 'desk',
      version: 1,
      person: 'dual-assistant',
      assignedBy: 'gm-pearl',
      location: 'pearl',
      assignedDaysAgo: 12,
      dueInDays: -1,
      completed: 1,
    },
  ],
}

const SEEDS: Record<string, TrainingSeed> = {
  'harbor-vine': HARBOR,
  'lumen-salon': LUMEN,
}

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------

function contentFor(lesson: LessonSeed): LessonContent {
  switch (lesson.kind) {
    case 'reading':
      return { kind: 'reading' }
    case 'checklist':
      return { kind: 'checklist', items: linesToItems((lesson.items ?? []).join('\n')) }
    case 'practical':
      return { kind: 'practical', criteria: linesToItems((lesson.criteria ?? []).join('\n')) }
    case 'quiz': {
      const questions: QuizQuestion[] = (lesson.quiz?.questions ?? []).map((q) => {
        const built = buildQuestion({
          kind: q.kind,
          prompt: q.prompt,
          options: q.options ?? [],
          correct: q.correct,
          explanation: q.explanation,
        })
        if (!built.ok) throw new Error(`Seed question is invalid: ${q.prompt}`)
        return built.question
      })
      return {
        kind: 'quiz',
        questions,
        passPercent: lesson.quiz?.passPercent ?? 80,
        maxAttempts: lesson.quiz?.maxAttempts ?? null,
      }
    }
  }
}

interface WrittenLesson {
  id: string
  kind: LessonSeed['kind']
  title: string
  content: LessonContent
}

export async function seedTraining(
  db: SeedDb,
  context: {
    organizationId: string
    slug: string
    timezone: string
    locationIds: Map<string, string>
    employmentIds: Map<string, string>
    systemEvent: (
      action: string,
      summary: string,
      extra?: Partial<typeof schema.auditEvents.$inferInsert>,
    ) => void
  },
): Promise<{ courses: number; assignments: number; courseIds: Map<string, string> }> {
  const seed = SEEDS[context.slug]
  if (!seed) return { courses: 0, assignments: 0, courseIds: new Map() }

  const { organizationId } = context
  const now = new Date()
  const DAY = 86_400_000
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY + hours * 3_600_000)
  const today = businessDate(now, context.timezone)
  const person = (key: string) => {
    const id = context.employmentIds.get(key)
    if (!id) throw new Error(`Training seed refers to unknown person "${key}"`)
    return id
  }

  const versionsByCourse = new Map<
    string,
    {
      courseId: string
      versions: { id: string; number: number; title: string; lessons: WrittenLesson[] }[]
    }
  >()

  for (const course of seed.courses) {
    const courseId = newId()
    const author = person(course.author)
    const latest = course.versions.at(-1)!
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId,
      title: latest.title,
      createdByEmploymentId: author,
      createdAt: ago(course.versions[0]!.publishedDaysAgo ?? 2, -24),
    })

    const written: { id: string; number: number; title: string; lessons: WrittenLesson[] }[] = []
    let publishedId: string | null = null
    for (const [index, version] of course.versions.entries()) {
      const versionId = newId()
      const number = index + 1
      // Inserted as a draft, filled, then published: the same order the
      // product uses, and the only order the frozen-version trigger allows.
      await db.insert(schema.courseVersions).values({
        id: versionId,
        organizationId,
        courseId,
        versionNumber: number,
        title: version.title,
        summary: version.summary,
        createdByEmploymentId: author,
      })
      const lessons: WrittenLesson[] = []
      for (const [position, lesson] of version.lessons.entries()) {
        const id = newId()
        const content = contentFor(lesson)
        await db.insert(schema.courseLessons).values({
          id,
          organizationId,
          versionId,
          position,
          title: lesson.title,
          kind: lesson.kind,
          body: lesson.body,
          estimatedMinutes: lesson.minutes,
          content: serializeContent(content),
        })
        lessons.push({ id, kind: lesson.kind, title: lesson.title, content })
      }
      if (version.publishedDaysAgo !== null) {
        await db
          .update(schema.courseVersions)
          .set({
            status: 'published',
            changeNote: version.changeNote ?? '',
            publishedAt: ago(version.publishedDaysAgo),
            publishedByEmploymentId: author,
          })
          .where(eq(schema.courseVersions.id, versionId))
        publishedId = versionId
        context.systemEvent(
          'training_course.published',
          `Published version ${number} of "${version.title}"`,
          { subjectType: 'course', subjectId: courseId, metadata: { versionNumber: number } },
        )
      }
      written.push({ id: versionId, number, title: version.title, lessons })
    }
    if (publishedId) {
      await db
        .update(schema.courses)
        .set({ publishedVersionId: publishedId })
        .where(eq(schema.courses.id, courseId))
    }
    versionsByCourse.set(course.key, { courseId, versions: written })
  }

  let assignmentCount = 0
  for (const a of seed.assignments) {
    const course = versionsByCourse.get(a.course)!
    const version = course.versions.find((v) => v.number === a.version)!
    const employmentId = person(a.person)
    const assignedAt = ago(a.assignedDaysAgo, -3)
    const lessonCount = version.lessons.length
    const done = a.completed === 'all' ? lessonCount : a.completed
    const finished = done === lessonCount
    const started = done > 0 || a.awaitingSignoff === true
    // Spread the work over the days since assignment, ending a day ago.
    const span = Math.max(1, a.assignedDaysAgo - 1)
    const stepAt = (i: number) =>
      ago(a.assignedDaysAgo - Math.ceil(((i + 1) * span) / (lessonCount + 1)), 2)
    const completedAt = finished ? stepAt(lessonCount - 1) : null
    const assignmentId = newId()

    await db.insert(schema.trainingAssignments).values({
      id: assignmentId,
      organizationId,
      employmentId,
      courseId: course.courseId,
      courseVersionId: version.id,
      versionNumber: version.number,
      locationId: context.locationIds.get(a.location) ?? null,
      source: 'manual',
      required: true,
      dueOn: a.dueInDays === undefined ? null : addCalendarDays(today, a.dueInDays),
      status: finished ? 'completed' : started ? 'in_progress' : 'assigned',
      assignedByEmploymentId: person(a.assignedBy),
      assignedAt,
      startedAt: started ? stepAt(0) : null,
      completedAt,
      createdAt: assignedAt,
    })
    assignmentCount += 1
    context.systemEvent(
      'training.assigned',
      `Assigned "${version.title}" (version ${version.number})`,
      {
        subjectType: 'training_assignment',
        subjectId: assignmentId,
        locationId: context.locationIds.get(a.location) ?? null,
      },
    )

    const writeProgress = async (
      lesson: WrittenLesson,
      status: string,
      at: Date,
      extra: Partial<typeof schema.trainingLessonProgress.$inferInsert> = {},
    ) => {
      const id = newId()
      await db.insert(schema.trainingLessonProgress).values({
        id,
        organizationId,
        assignmentId,
        versionId: version.id,
        lessonId: lesson.id,
        employmentId,
        status,
        completedAt: status === 'completed' ? at : null,
        createdAt: at,
        updatedAt: at,
        ...extra,
      })
      return id
    }

    for (let i = 0; i < done; i += 1) {
      const lesson = version.lessons[i]!
      const at = stepAt(i)
      const content = lesson.content
      if (content.kind === 'checklist') {
        await writeProgress(lesson, 'completed', at, {
          checkedItemIds: content.items.map((x) => x.id),
        })
      } else if (content.kind === 'quiz') {
        const right = Object.fromEntries(content.questions.map((q) => [q.id, q.correctOptionIds]))
        let attempt = 1
        if (a.retriedQuiz && content.questions.length > 1) {
          // One wrong answer on the first try.
          const [first, ...rest] = content.questions
          const wrong = {
            ...right,
            [first!.id]: [first!.options.find((o) => !first!.correctOptionIds.includes(o.id))!.id],
          }
          const correctCount = rest.length
          await db.insert(schema.trainingQuizAttempts).values({
            id: newId(),
            organizationId,
            assignmentId,
            versionId: version.id,
            lessonId: lesson.id,
            employmentId,
            attemptNumber: attempt,
            answers: wrong,
            correctCount,
            questionCount: content.questions.length,
            scorePercent: Math.floor((correctCount * 100) / content.questions.length),
            passed: correctCount * 100 >= content.passPercent * content.questions.length,
            submittedAt: new Date(at.getTime() - 20 * 60_000),
          })
          attempt += 1
        }
        await db.insert(schema.trainingQuizAttempts).values({
          id: newId(),
          organizationId,
          assignmentId,
          versionId: version.id,
          lessonId: lesson.id,
          employmentId,
          attemptNumber: attempt,
          answers: right,
          correctCount: content.questions.length,
          questionCount: content.questions.length,
          scorePercent: 100,
          passed: true,
          submittedAt: at,
        })
        await writeProgress(lesson, 'completed', at)
      } else if (content.kind === 'practical') {
        const progressId = await writeProgress(lesson, 'completed', at, {
          signoffRequestedAt: new Date(at.getTime() - 26 * 3_600_000),
        })
        await db.insert(schema.trainingSignoffs).values({
          id: newId(),
          organizationId,
          progressId,
          assignmentId,
          lessonId: lesson.id,
          employmentId,
          decision: 'verified',
          criteriaConfirmed: content.criteria.map((c) => c.id),
          decidedByEmploymentId: person(a.signedOffBy ?? a.assignedBy),
          decidedAt: at,
        })
      } else {
        await writeProgress(lesson, 'completed', at)
      }
    }

    if (a.awaitingSignoff) {
      const lesson = version.lessons[done]
      if (!lesson || lesson.kind !== 'practical') {
        throw new Error(`Seed assignment for ${a.person} expects a practical after ${done} lessons`)
      }
      await writeProgress(lesson, 'awaiting_signoff', ago(1, 3), { signoffRequestedAt: ago(1, 3) })
    }

    if (finished) {
      context.systemEvent(
        'training.completed',
        `Completed "${version.title}" (version ${version.number})`,
        { subjectType: 'training_assignment', subjectId: assignmentId },
      )
    }
  }

  return {
    courses: seed.courses.length,
    assignments: assignmentCount,
    courseIds: new Map([...versionsByCourse.entries()].map(([key, v]) => [key, v.courseId])),
  }
}

/**
 * Link the seeded onboarding checklists' training steps to their courses, and
 * each seeded new hire's step to a training assignment, by the same rules
 * starting onboarding follows (modules/onboarding/training-link.ts): an open
 * assignment of the course first, then a completed one, otherwise a new
 * `onboarding` assignment of the published version.
 */
export async function linkSeededOnboardingTraining(
  db: SeedDb,
  context: {
    organizationId: string
    seed: SeedOrganization
    courseIds: Map<string, string>
    systemEvent: (
      action: string,
      summary: string,
      extra?: Partial<typeof schema.auditEvents.$inferInsert>,
    ) => void
  },
): Promise<void> {
  const { organizationId } = context

  for (const template of context.seed.onboardingTemplates) {
    for (const step of template.sections.flatMap((section) => section.steps)) {
      if (!step.course) continue
      const courseId = context.courseIds.get(step.course)
      if (!courseId)
        throw new Error(`Onboarding step "${step.title}" names unknown course "${step.course}"`)
      await db.execute(sql`
        update onboarding_steps s
           set course_id = ${courseId}
          from onboarding_templates t
         where t.organization_id = ${organizationId}
           and t.name = ${template.name}
           and s.organization_id = t.organization_id
           and s.version_id = t.published_version_id
           and s.title = ${step.title}`)
    }
  }

  const rows = await db.execute<{
    id: string
    assignment_id: string
    employment_id: string
    course_id: string
    due_on: string | null
    started_on: string
    manager_id: string | null
    home_location_id: string | null
  }>(sql`
    select p.id, p.assignment_id, a.employment_id, s.course_id, p.due_on, a.started_on,
           e.manager_employment_id as manager_id, e.home_location_id
      from onboarding_step_progress p
      join onboarding_assignments a on a.id = p.assignment_id
      join onboarding_steps s on s.id = p.step_id
      join employments e on e.id = a.employment_id
     where p.organization_id = ${organizationId}
       and p.kind = 'training_assignment'
       and s.course_id is not null`)

  const runs = new Set<string>()
  for (const row of rows.rows) {
    const existing = await db
      .select()
      .from(schema.trainingAssignments)
      .where(
        and(
          eq(schema.trainingAssignments.organizationId, organizationId),
          eq(schema.trainingAssignments.employmentId, row.employment_id),
          eq(schema.trainingAssignments.courseId, row.course_id),
        ),
      )
      .orderBy(desc(schema.trainingAssignments.assignedAt))
    let assignment =
      existing.find((a) => a.status === 'assigned' || a.status === 'in_progress') ??
      existing.find((a) => a.status === 'completed')

    if (!assignment) {
      const [course] = await db
        .select({
          publishedVersionId: schema.courses.publishedVersionId,
          versionNumber: schema.courseVersions.versionNumber,
          title: schema.courseVersions.title,
        })
        .from(schema.courses)
        .innerJoin(
          schema.courseVersions,
          eq(schema.courseVersions.id, schema.courses.publishedVersionId),
        )
        .where(eq(schema.courses.id, row.course_id))
        .limit(1)
      const [created] = await db
        .insert(schema.trainingAssignments)
        .values({
          id: newId(),
          organizationId,
          employmentId: row.employment_id,
          courseId: row.course_id,
          courseVersionId: course!.publishedVersionId!,
          versionNumber: course!.versionNumber,
          locationId: row.home_location_id,
          source: 'onboarding',
          required: true,
          dueOn: row.due_on,
          assignedByEmploymentId: row.manager_id,
          assignedAt: new Date(`${row.started_on}T16:00:00Z`),
          createdAt: new Date(`${row.started_on}T16:00:00Z`),
        })
        .returning()
      assignment = created!
      context.systemEvent(
        'training.assigned',
        `Assigned "${course!.title}" (version ${course!.versionNumber}) as part of onboarding`,
        { subjectType: 'training_assignment', subjectId: assignment.id },
      )
    }

    const completed = assignment.status === 'completed'
    await db
      .update(schema.onboardingStepProgress)
      .set({
        courseId: row.course_id,
        trainingAssignmentId: assignment.id,
        status: completed ? 'completed' : 'pending',
        blockedReason: null,
        completedAt: completed ? assignment.completedAt : null,
        completedByEmploymentId: completed ? row.employment_id : null,
      })
      .where(eq(schema.onboardingStepProgress.id, row.id))
    runs.add(row.assignment_id)
  }

  // Completion follows the steps, exactly as refreshOnboardingCompletion does.
  for (const runId of runs) {
    await db.execute(sql`
      update onboarding_assignments a
         set completed_at = case
           when exists (
             select 1 from onboarding_step_progress p
              where p.assignment_id = a.id and p.required and p.blocks_completion
                and p.status not in ('completed','waived')
           ) then null
           else coalesce(a.completed_at, now())
         end
       where a.id = ${runId}`)
  }
}
