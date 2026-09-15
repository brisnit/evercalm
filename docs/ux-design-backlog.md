# UX and visual design backlog

A running record of visual-design, information-architecture, interaction,
hierarchy, responsive-layout, and usability issues found during development.

**This is a deferral list, not an excuse list.** The product-wide visual and UX
redesign waits until scheduling, training, communication, and shift operations
are functional — there is no point redesigning navigation around four features
that do not exist yet. But nothing ships broken, confusing, inaccessible, or
unusable. Anything in those four categories gets fixed immediately and is
recorded here as _Fixed now_, not deferred.

**Severity**

|             | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| **Blocker** | Broken, inaccessible, or unusable. Fixed before the slice closes.             |
| **High**    | Works, but actively confuses or slows a real user. Fix early in the redesign. |
| **Medium**  | Noticeably unpolished or inconsistent. Redesign material.                     |
| **Low**     | Refinement.                                                                   |

---

## Fixed during development

Recorded for the redesign's benefit, since each says something about the
system, not just the screen.

### F1 · Onboarding board showed almost everyone as "Blocked" — **Blocker**

_Found: Slice 2, reviewing the first dashboard screenshot._

Steps waiting on EverCalm features that have not shipped (training, policy
acknowledgement) counted identically to a genuine real-world blocker, so every
new hire landed in the blocked column and the board told a manager nothing.

**Fixed:** `awaitingPlatform` now distinguishes "waiting on us" from "waiting on
a person", and only human-actionable blocks set the overall state. **Lesson for
the redesign:** any status that aggregates causes must separate _who can act_.

### F2 · Directory rendered every row twice — **Blocker**

_Found: Slice 2, when a Playwright locator matched two elements._

A desktop table plus a duplicated mobile card list meant every person appeared
twice in the DOM. Wasteful on a large directory and ambiguous to tooling.

**Fixed:** one table whose secondary columns collapse into the name cell at
phone width. **Lesson:** responsive means one structure that adapts, not two
structures that hide each other.

### F3 · Timezone shown where a place belonged — **High**

_Found: Slice 2, reviewing the mobile employee screenshot._

The employee's location badge rendered the IANA zone segment, so a Sacramento
restaurant was labelled "Los Angeles".

**Fixed:** shows the city. **Lesson:** never surface an internal identifier
because it is nearly readable.

### F4 · Next.js dev overlay covered page content — **Medium**

Obscured the bottom-left of every screen in development and in screenshots.
**Fixed:** `devIndicators: false`.

---

### F5 · Two pages scrolled sideways on a phone — **Blocker**

_Found: Slice 2, measuring the full-page mobile screenshots. A full-page capture
is as wide as the document, so a shot wider than the viewport is proof of
overflow: the dashboard came out 478 CSS px wide and the import page 415, on a
390 px screen._

Two separate causes, both invisible on a desktop:

1. Every `Card` sits in a grid or flex parent, and a grid item's default
   `min-width: auto` refuses to shrink below its content's min-content width.
   The dashboard's onboarding rows already truncated their text, but the
   truncation never got a chance to apply.
2. The import page rendered the browser's native file input, whose intrinsic
   width does not shrink.

**Fixed:** `Card` carries `min-w-0`; every `fr` grid track is now
`minmax(0, …)`; the native file input is `sr-only` behind its own label, with
the chosen filename echoed in a live region. **Guarded:** `tests/e2e/layout.spec.ts`
asserts `scrollWidth <= clientWidth` at 390 px on every screen and names the
widest offending element when it fails. **Lesson for the redesign:** `truncate`
is not sufficient on its own — every ancestor between the text and the viewport
must also be allowed to shrink.

### F6 · The empty state asked for an action it did not offer — **Blocker**

_Found: Slice 2, reviewing the employee profile screenshot at full size._

A person with no checklist showed "Onboarding has not started — Assign a
checklist so this person knows what to do in their first weeks." The control
that does it, `Start onboarding`, was roughly 1,400 px further down the page,
inside the Employment tab of the management panels.

**Fixed:** the control moved into the empty state that asks for it, and was
removed from the panels so there is exactly one. **Lesson for the redesign:**
an empty state that names an action owns that action.

### F7 · The import review table crushed the columns that carried the meaning — **High**

_Found: Slice 2, reviewing the error-report screenshot at full size._

Automatic table layout gave the email column most of the width, breaking every
person's name across three lines, while the reason a row was skipped — the
whole point of the screen — was squeezed into the narrowest column and wrapped
one or two words per line.

**Fixed:** fixed proportions via `colgroup`, and the explanation moved out of
the status cell into a full-width row beneath its record, so it reads as a
sentence. Long values wrap rather than run into the next column.

### F8 · The error report vanished at the moment it was needed — **High**

_Found: Slice 2, reviewing the completion screenshot._

The completion screen reported "Skipped 3" and offered no way to see why. The
`Download error report` button existed only on the previous step, which is
replaced on confirmation, so fixing the rejected rows meant re-uploading the
file just to read the reasons again.

**Fixed:** the completion screen keeps the report and offers
`Download the skipped rows` whenever anything was skipped.

### F9 · Smaller things the screenshots caught — **Low**

All fixed in place:

- "in use by 1 people" — the count was pluralised in one place and not the other.
- Paired fields where one had a hint and its neighbour did not sat visibly
  off-baseline. Each partner got a hint that earns its place rather than an
  empty reserved row.
- Checkboxes and radios wore the browser's default blue next to an otherwise
  violet interface. `accent-color` now follows the brand, keeping the native
  control and its native accessibility.
- The column-mapping step never said which side was the file and which was
  EverCalm. It has headings now.
- Due dates broke mid-date across lines on a phone.

### F10 · A location manager could not see an organization-wide announcement — **Blocker**

_Found: Slice 3, writing the browser test for a General Manager's view._

The author list filtered to "announcements naming one of my locations", which
is the right question for a Downtown-only notice and the wrong one for
everything else. An organization-wide safety notice reaches a manager's people,
and they are the person who has to chase the outstanding confirmations — but it
was invisible to them.

**Fixed:** the rule is now subtractive. An announcement is hidden only when
**every** include rule points somewhere the manager does not cover. **Lesson
for the redesign:** a visibility filter written as "show when X" hides
everything the author of the filter did not think of; written as "hide when
every Y", the default is to show.

### F11 · Four services asked the organization-wide permission question — **Blocker**

_Found: Slice 3, the first browser test that signed in as a General Manager._

`authorize(actor, cap)` with no location is the STRONGER question, and a
location-scoped grant cannot satisfy it. Receipts, the author list, reminders
and the urgent-priority option all used it, so a General Manager was refused
for their own site — the identical family of bugs to Slice 2, in a new module.

**Fixed:** one documented helper, `authorizeSomewhere`, used at every entry
point, with the specific location enforced by the audience check instead.
**Lesson for the redesign:** this has now happened twice. The next module
should start from the helper rather than rediscover it.

### F12 · A `<details>` disclosure is invisible to tests and to assistive tech — **High**

_Found: Slice 3, and again — it also cost a hunt in Slice 2._

A collapsed `<summary>` is exposed to the accessibility tree as a generic node
rather than a button with expanded state. Screen readers do not announce that
it can be opened, and neither `getByRole('button')` nor `getByRole('group')`
finds it.

**Fixed:** a `Disclosure` primitive — a real button with `aria-expanded` and
`aria-controls`. Used by the audience picker. **Still to migrate:** the
onboarding template builder's add-step disclosure, left alone to keep Slice 3's
blast radius contained. See D13.

### F13 · A malformed id in a URL was a 500 — **High**

_Found: Slice 3, asserting that a message which is not yours is not found._

`/my/inbox/not-an-id` handed a non-UUID to a uuid column, PostgreSQL raised
22P02, and the result was a 500 with a stack trace. Wrong twice: it is not a
server fault, and an error page is a _different response_ from "no such thing"
— exactly the distinction the 404-not-403 rule exists to remove.

**Fixed:** `isUuid` guards the route parameter, and the domain `NotFoundError`
is mapped to Next's `notFound()`. A malformed id, an id belonging to another
tenant, and an id that never existed now all answer 404.

### F14 · An empty `<select>` posted an empty string into a uuid column — **Blocker**

_Found: Slice 3, the first attempt to save a draft from the browser._

`readString` returns `''` for a field that is present but empty, so
`readString(...) ?? null` never fires and "No event" posted `''`. Every draft
save failed with a generic "we could not save that".

**Fixed:** optional fields use `readOptionalString`, which is `undefined` when
there is nothing there. **Lesson:** `?? null` on a helper that returns `''` is
a silent no-op; the two helpers now have clearly different jobs.

### F15 · Smaller things the screenshots caught — **Low**

- List rows used about 40% of their width, with the counts a manager scans for
  crammed under the title and the rest of the row empty. The stats are now
  right-aligned on a wide screen and stack on a phone.
- The receipt report — a table plus three breakdowns — was squeezed into a
  column while the page had room to spare. It is full width now.

## Scheduling: known gaps (Slice 4)

Deliberate limits of the first scheduling slice, recorded so they are chosen
rather than forgotten.

### S1 · No drag-and-drop on the week board — **Medium**

_Area: interaction._ Shifts are added from a form and assigned from the shift's
own page, where every candidate's conflicts are stated. Keyboard-accessible and
explicit, but slower than dragging for a manager building a busy week.

### S2 · One availability window per day in the employee editor — **Low**

_Area: form design._ The data model and service accept several windows a day;
the phone editor shows one and warns that saving keeps only the one shown.

### S3 · Managers are not notified of new requests — **Medium**

_Area: notifications._ Time off, claims and swaps appear on the Requests page
for the people who can decide them, but nothing is pushed to those managers
yet. Resolving "who should be told" per location is its own small feature.

### S4 · No calendar export (.ics) — **Low**

_Area: integration._ Planned in the original slice outline; not built.

### S5 · Requests on shifts that have started are closed lazily — **Low**

_Area: background work._ A pending claim or swap for a shift that has already
started is shown as expired and cannot be approved, but its row is only closed
when someone acts on it. A worker step could close them on schedule.

### S6 · The assignment candidate list includes managers without the role — **Low**

_Area: information design._ Everyone assigned to the location is listed, sorted
best fit first, with "different role" stated. Filtering to role holders by
default would shorten long lists.

## Training: known gaps (Slice 5)

Deliberate limits of the first training slice, recorded so they are chosen
rather than forgotten.

### L1 · Onboarding training steps are not linked to courses — **Fixed**

_Area: workflow._ Fixed before Slice 5 review: a checklist's training step
links a published course, onboarding assigns it pinned to a version, and the
step follows the course (see docs/architecture.md, Onboarding and training).
Still open: a step can link one course, not a learning path.

### L2 · No skills catalogue or learning paths — **Medium**

_Area: scope._ Practical sign-off lives inside a course. There is no separate
list of skills a person holds, no expiry on a sign-off, and no path that
unlocks one course after another. `skill.define` and `skill.revoke` are unused.

### L3 · Assignment by job role is a one-time action — **Medium**

_Area: workflow._ "Everyone who is a Server" assigns the people who hold the
role today. Someone hired into the role next week is not assigned
automatically.

### L4 · No reminders, and managers are not told about sign-off requests — **Medium**

_Area: notifications._ People are notified when training is assigned, moved or
withdrawn, and when a sign-off is decided. Nothing reminds them as a due date
approaches, and a manager finds sign-off requests on the Sign-offs page and the
training overview rather than in a notification (the same gap as S3).

### L5 · Text-only lessons — **Medium**

_Area: content._ No video, image or document lessons until file storage exists.

### L6 · Training is not on the employee profile — **Medium**

_Area: information architecture._ Managers see a person's training on the
Progress page and each course's People page, not on the person's profile.

### L7 · Questions cannot be reordered, and editing has no live preview — **Low**

_Area: authoring._ Questions are added to the end of a knowledge check, and
formatting is checked in the Preview tab rather than while typing.

### L9 · Not-found and loading states are the framework defaults — **Low**

_Area: states._ An assignment or lesson that is not yours (or does not exist)
returns a correct 404, but the page is Next's unbranded default with no way
back. Training pages render on the server with no loading skeleton, so a slow
connection shows the previous page until the next one arrives. Both are
product-wide, not training-specific.

### L10 · A blocked course still offers "Continue the course" — **Low**

_Area: wording._ When someone is out of knowledge-check attempts, their
onboarding step says so and the course card shows "Needs your manager", but
still offers "Continue the course", because the course's other lessons can be
done meanwhile. Accurate, but it could say which lessons remain open.

### L8 · Points and levels are intentionally absent — **Decision**

_Area: product._ The implementation plan sketched XP, levels and idempotent
awards. They were left out: progress and accomplishment are shown privately
and plainly, and nothing ranks one person against another. Recorded so the
choice is visible, not so it is revisited by default.

## Shift operations: known gaps (Slice 6)

### O1 · No photo evidence on tasks — **Medium**

A temperature log or a clean station cannot carry a photo: there is no file
storage provider configured yet. Numbers and short notes are the evidence for
now.

### O2 · Runs keep their version when a template is republished — **Low**

Shifts that already have a run stay on the version they were given, including
shifts later in the week that nobody has started. That is the honest record,
but a manager fixing a mistake in a template may expect next Saturday's run to
change. A "move not-started runs to the new version" action, like training's,
would cover it.

### O3 · Overdue is computed, not stamped — **Low**

There is no job that marks work missed at the end of a shift, and no
notification when something goes overdue. The board and workspace compute it
on every read; the pre-shift reminder is the only push.

### O4 · The phone workspace is long on a busy shift — **Medium**

A bartender with setup, pre-shift and close on one overnight shift sees a dozen
cards, each with its own controls. Everything is correct and reachable, but a
compact "tick list" mode for simple check tasks would read faster. Found in
visual review with the seeded bar close.

### O5 · The board has no date picker — **Low**

Previous day, today and next day only. A manager looking at last Tuesday edits
the address or clicks back several times.

### O6 · Handoffs are not notified to the next shift — **Low**

They appear on the next person's workspace and the board, and a priority
handoff is marked, but nobody is pushed a notification when one is left.

### O7 · Visual review fixes — **Fixed**

"1 need attention" became "1 needs attention"; the general "Leave a handoff"
form on the workspace is collapsed, since the end-of-shift handoff task already
asks; an empty grey toolbar no longer shows for a manager with one location;
another location's board or handoffs by address, or a malformed location in the
address, is a 404 rather than an error page.

### O8 · Employees had no way to sign out — **Fixed**

_Found: Slice 6 review. Switching from one demo employee to another was
impossible from any /my screen._

**Fixed:** every employee page now uses one shared header with an account
control: the person's initials and first name, labelled "Account: full name"
for screen readers. It opens a small panel with their name, organization,
notification settings and Sign out. It is a disclosure, not an ARIA menu:
reached with Tab, closed by Escape (focus returns to the control), a tap
outside, or tabbing away. Sign out ends the session on the server and loads
the sign-in page fresh. A tap inside the panel no longer closes it on iPhone
Safari, which does not focus tapped buttons. **Lesson for the redesign:** the
employee surface still has no navigation of its own (D4); the account control
is where that navigation will naturally grow.

## Reporting, billing and support: known gaps (Slice 7)

### R1 · Reports have no charts or trends beyond a weekly table — **Low**

Deliberate: exceptions and lists first. A manager asking "is this getting
better?" has only the weekly request table and the date filter.

### R2 · Report pages build every table on each load — **Medium**

Fine at pilot size. A year-long range for a large organization will be slow;
materialised daily aggregates would be the fix.

### R3 · The people report cannot filter invitations by department or role — **Low**

Invitations have no role until accepted; the table says so when a role filter
is active.

### R4 · No full data export — **Medium**

CSV exports cover report tables. A complete organization export is a manual,
two-person step ([data retention](runbooks/data-retention.md)).

### R5 · Billing without prices — **Medium**

Plans show what is included and no prices, because pricing is agreed with
pilots. Owners cannot compare cost on the screen.

### R6 · Support cases have no attachments — **Medium**

Needs file storage. The form asks for page addresses and a description.

### R7 · Staff times are UTC only — **Low**

The team dashboard shows one clock so customers compare; a customer's own
timezone is not shown next to it.

### R8 · Diagnostics access is a cookie per browser — **Low**

Opening diagnostics is audited and lasts 15 minutes in that browser. It is not
a shared, revocable grant.

### R9 · Rate limits are per instance — **Fixed**

Export, webhook and authentication limits are now stored in the database and
shared by every instance (Phase B).

### R10 · Visual review fixes — **Fixed**

Report tables squeezed every column on a phone until dates wrapped over three
lines; columns now keep a minimum width and the table scrolls inside its own
region. The site's "Start free" buttons led to sign-in although there is no
self-service signup, and "Free for your first location" and "No credit card ·
Cancel anytime" described pricing that does not exist; they now say "Ask about
a pilot" and describe pilot pricing honestly. A `'use server'` file that
exported a constant broke the whole development build; the diagnostics window
helpers moved to their own module.

## Test reliability

Browser-suite failures seen once and not yet investigated. Recorded so they are
not rediscovered from scratch; neither blocks feature work.

### T1 · Employee-profile accessibility scan intermittently sees no `<title>` — **Low**

_Seen 2026-09-12, during the homepage hero fix._
`tests/e2e/accessibility.spec.ts` › "an employee profile with management panels
has no accessibility violations" failed on desktop with axe
`document-title: Documents must have <title> element`. It ran with
`E2E_SKIP_REFRESH=true` against a database already changed by earlier runs, and
immediately after a `next build` in the same checkout, while the dev server was
serving. Re-run after a normal reseed: passed on desktop and mobile.

_Suspected:_ the scan ran before the page's metadata was applied, while the dev
server recompiled. _To investigate:_ wait for the page heading and a non-empty
`document.title` before scanning; check whether a concurrent build affects the
dev server.

### T2 · Invitations table overflows at 390px on accumulated data — **Low**

_Seen 2026-09-12, same run as T1._
`tests/e2e/layout.spec.ts` › "administration screens fit a phone screen" failed:
`/app/people/invitations scrolls sideways at 390px`, widest element the table
(`min-w-[46rem]`, right edge 757px). Same conditions as T1. Re-run after a
normal reseed: passed.

_Suspected:_ a row created by earlier runs rendered the table outside its
horizontal scroll container, or the container did not constrain it for that
content. _To investigate:_ reproduce with `E2E_SKIP_REFRESH=true` after a full
suite run; confirm the table always sits inside `ScrollArea`.

### T3 · Inbox home-screen test sees a React development timing error — **Resolved (test environment)**

_Seen 2026-09-13, in two consecutive full browser runs during Slice 5._
`tests/e2e/employee-inbox.spec.ts` › "what needs confirming is surfaced on the
home screen" failed only its no-console-errors check, on desktop, with:

    Failed to execute 'measure' on 'Performance': '​AppLayout' cannot have a negative time stamp.

Once, on the phone project, it instead logged WebKit's `Type error` and
`__nextjs_original-stack-frames due to access control checks`: the Next dev
overlay's attempt to symbolicate an error, cut off by the test navigating away.
Every functional assertion in the test passed both times.

_What produces the message._ In development only, React's Server Components
client (`react-server-dom-webpack-client.browser.development.js`, bundled by
Next) draws each server component on the browser's Performance panel with
`performance.measure`. It clamps a negative start time to 0 but not a negative
end time; the browser throws on a negative end. The `​` prefix is React's
marker for a Server Components track entry, and `AppLayout` is simply the
component being drawn. The production client contains no `performance.measure`
calls at all (0, against 9 in development). No EverCalm code is involved.

_What was ruled out, with evidence._

| Hypothesis                                                   | Test                                                                                          | Result                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A real bug from Slice 5's extra `/my` queries                | The failing component is the `/app` layout, not `/my`; 5 instrumented runs with Slice 5 code  | Not reproduced                                                                                                      |
| Clock skew between a long-running dev server and the browser | Measured the dev server clock 121 ms behind wall time after 41 h; read React/Next timing code | Next and React use the same server clock, so skew cancels; simulating up to 400 ms browser skew produced no failure |
| First render after a recompile                               | Forced 10 recompiles, then loaded `/app` pages and the employee `/app` → `/my` redirect       | Not reproduced                                                                                                      |
| Order within the suite                                       | The four preceding spec files plus the inbox spec, instrumented, 4 times                      | 208 of 208 passed                                                                                                   |
| Anything in the full suite                                   | Full browser run with `performance.measure` instrumented                                      | Not reproduced                                                                                                      |

The exact state that produced a negative end was not reproduced again, so the
triggering request is not known.

_Resolution._ It is framework development instrumentation, not an application
error, so the suite's console check excludes exactly that message
(`tests/e2e/console-noise.ts`): the React Server Components marker and the
negative-time-stamp wording, nothing else. `tests/unit/console-noise.test.ts`
fails if the exclusion is removed or widened. The console check now records
each error's source location and, for uncaught errors, the stack, so a future
occurrence of anything else arrives with its trace.

### T4 · The swap confirmation vanished with the "Needs you" section — **Fixed (application bug)**

_Seen 2026-09-13 and 2026-09-14, in two full browser runs._
`tests/e2e/scheduling.spec.ts` › "a swap: asked by one employee, accepted by
the colleague, approved by a manager" waited for "You agreed." and found no
notice, although the page showed the swap "Waiting for a manager": the answer
had been saved.

_Cause._ The employee schedule rendered `IncomingSwaps` only while requests
were waiting, and that component owned its confirmation notice. Answering the
last request removed the section in the same refresh, and the notice with it,
unless the notice happened to paint first. A real bug, of the D14 kind.

_Fix._ `IncomingSwaps` is always rendered and owns the notice outside the
section that disappears. The test now asserts the notice is visible after the
"Needs you" heading has gone, which fails every time with the old structure.

## Deferred to the product-wide redesign

### D1 · Navigation will not survive four more slices — **High**

_Area: information architecture._

`/app` has a flat four-item nav (Overview, People, Onboarding, Settings).
Scheduling, training, communication, and shift operations each add a top-level
area plus sub-navigation. A flat bar will not hold ten areas, and Settings is
already accumulating unrelated sections behind one label.

**Why deferred:** the right structure depends on what the other four surfaces
actually contain. Designing it now would be guesswork.

### D2 · The dashboard is a holding pattern — **High**

_Area: hierarchy._

Four stat tiles and two lists read as a reasonable dashboard _today_ only
because onboarding and credentials are the only live systems. Once shifts,
training, and announcements land, "what needs my attention" has to be a ranked,
cross-domain feed rather than one tile per subsystem.

### D3 · "Coming in later slices" cards on the employee home — **Fixed**

_Area: usability._ Removed before Slice 5 review. The home screen shows only
sections that exist; shift operations will add its own section when it ships.

### D4 · Employee surface has no navigation — **Medium**

_Area: information architecture._

`/my` is a single scrolling page because onboarding is the only thing on it.
Shifts, training, inbox, and tasks need real mobile navigation — most likely a
bottom tab bar, which is a decision to make once all five destinations exist.

### D5 · Profile management panels are a tab strip bolted beneath the page — **Medium**

_Area: interaction._

Employment, Access, Credentials, and Offboarding sit in a secondary tab strip
below the read-only profile, so editing means scrolling past everything you
just read. Likely wants inline editing or a side panel.

### D6 · Settings sub-navigation duplicates the section header — **Low**

_Area: hierarchy._ The tab label and the page's `PageHeader` say the same word.

### D7 · Onboarding board cards are fixed-width in a fluid grid — **Low**

_Area: responsive layout._ With one person in a state group, a lone narrow card
sits in a wide empty row. Needs a density decision, not a spacing tweak.

### D8 · No toast or global feedback surface — **Medium**

_Area: interaction._

Every mutation reports inline next to its own form. That is accessible and
unambiguous, but with several forms on a page the feedback can land off-screen.
A shared, polite live region belongs in the redesign.

### D9 · Two different empty-state voices — **Low**

_Area: visual design._ `EmptyState` is used both for "nothing exists yet" and
for "your filter matched nothing". Those deserve different treatments.

### D10 · Detail pages leave a tall empty column — **Low**

_Area: responsive layout._ The builder and the import wizard put a short main
column beside a long sidebar, so a draft with one empty section leaves several
hundred pixels of white below it. A density decision for the redesign, not a
spacing tweak.

### D11 · The template preview is a narrow column with no frame — **Low**

_Area: visual design._ It renders the employee view at its real width inside a
wide card, which reads as an oddly centred column rather than as a device
preview. The `EMPLOYEE VIEW` label is currently doing all the explaining.

### D12 · Manage-card buttons have inconsistent widths — **Low**

_Area: visual design._ In the template builder's Manage card, `Duplicate` is
auto-width and `Archive` is full-width, in the same stack.

### D13 · The onboarding builder still uses `<details>` — **Medium**

_Area: interaction._ Slice 3 added a `Disclosure` primitive with proper
`aria-expanded`. The template builder's add-step control still uses a raw
`<details>`, which announces nothing about being expandable. Migrate it when
onboarding is next touched.

### D14 · Action feedback is lost whenever the action revalidates — **Fixed**

_Fixed in Slice 3 review._ Publishing, scheduling, cancelling, correcting,
archiving and acknowledging now hand their result to a notice held by a
component that survives the refresh (`src/ui/patterns/action-notice.tsx`). It
takes focus, stays until dismissed or the page is left, and is never stored, so
it cannot reappear on a later visit. Covered by browser tests.

_Original finding:_

_Area: interaction._ Publishing reports "queued for 38, 2 after quiet hours",
then `revalidatePath` re-renders the page and the message is gone. The durable
outcome is visible (the receipt report appears), but the nuance about delayed
and suppressed deliveries is not. This is D8 with a concrete cost attached.

### D15 · Three badges on one inbox card wrap to two lines — **Low**

_Area: visual design._ An urgent message that also needs confirming and is
unread carries three marks. Each is legible and each carries a word, but the
row is busy. A single combined state chip would read better.

### D16 · The announcement detail leaves a tall empty left column — **Low**

_Area: responsive layout._ "What it says" is short while the sidebar carries
publishing, correction and management panels, so the left column ends well
above the right. Same shape as D10.
