# Stakeholder feedback — Round 1

Source: “EverCalm mvp feedback.pdf” (6 pages, round-one stakeholder review of
the MVP stakeholder demo). Read in full, including the annotated comments in
red and the two embedded images (a proposed brand palette on page 2 and a
screenshot of an earlier EverCalm mobile dashboard on page 3). The PDF itself
is not modified or stored in the repository.

**The dominant direction is SIMPLICITY:** calm, organized, easy to scan; less
information at once; owners reach any tool in under a minute; employees always
know where to go next — while keeping the infrastructure and disclosing its
complexity progressively.

## Classifications

| Code         | Meaning                                       |
| ------------ | --------------------------------------------- |
| **UX**       | Existing capability that needs a UX change    |
| **Defect**   | Confirmed defect (reproduced or root-caused)  |
| **New**      | New feature                                   |
| **Decision** | Major product decision needed before building |
| **Phase 2**  | Explicitly later work                         |

Status: **1A** = addressed in Round 1A · **Brief** = implementation brief
below, not built · **Decision** = needs product approval · **Noted** = no
build change.

## Traceability

| #   | Page | Section                          | Stakeholder finding                                                                                                                                                                                   | Classification   | Status and response                                                                                                                                                                                                                                      |
| --- | ---- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1    | Preface                          | Brand should convey sense of order, peace of mind, bases covered                                                                                                                                      | UX (direction)   | Noted — guides every Round 1A change                                                                                                                                                                                                                     |
| 2   | 1    | Preface                          | Must adapt beyond hospitality; a total business solution; as much a gift to employees as owners                                                                                                       | Decision         | Decision — industry-neutral core already exists (restaurant and salon demo tenants); which additional sectors to template is a positioning decision                                                                                                      |
| 3   | 1    | Preface                          | Not bloated, expensive, half-functional or underused                                                                                                                                                  | UX (direction)   | Noted — drives progressive disclosure and navigation reduction                                                                                                                                                                                           |
| 4   | 1    | Preface                          | Look: calm, organized, simple, less noise, easy navigation and flow                                                                                                                                   | UX               | 1A — launcher dashboards, fewer nav items, less text on landing screens                                                                                                                                                                                  |
| 5   | 1    | Preface                          | Core pitch: one platform replacing messaging, scheduling, training, project tools                                                                                                                     | Decision         | Noted — marketing copy; unchanged this round                                                                                                                                                                                                             |
| 6   | 1    | Goals                            | Timesheets and payroll                                                                                                                                                                                | Phase 2          | Brief 5 — Reports returns with this work                                                                                                                                                                                                                 |
| 7   | 1    | Goals                            | Candidate taglines                                                                                                                                                                                    | Decision         | Decision — marketing chooses; homepage copy unchanged                                                                                                                                                                                                    |
| 8   | 1–2  | Homepage                         | New brand palette: Deep Teal #2A5C5A, Soft Sage #7FB5A0, Warm Sand #F5E6D3, Coral Pop #E8856C, Navy #1E2D3D; “open to a new color template… fresh and cutting edge”                                   | UX               | 1A — **applied** across marketing, administration, employee and EverCalm team surfaces through the shared tokens. Three of the five fail AA as small text, so each has one measured darker text variant; see “Palette” below and docs/design-system.md   |
| 9   | 2    | Homepage                         | Greeting/tagline to be rethought after the MVP matures                                                                                                                                                | Decision         | Decision — deferred by stakeholder                                                                                                                                                                                                                       |
| 10  | 2    | Homepage                         | “The Four Questions” — revisit                                                                                                                                                                        | Decision         | Decision — homepage structure unchanged until the tagline work                                                                                                                                                                                           |
| 11  | 2    | Owner                            | Don’t greet owners with a rolling list of to-dos (“Needs you” / “Items on deck”)                                                                                                                      | UX               | 1A — Overview becomes a tool launcher with a compact “Needs attention” summary; full queue moves to its own view                                                                                                                                         |
| 12  | 2    | Owner                            | “Overview” should be a box, not a list; the list appears only when opened; on the next page                                                                                                           | UX               | 1A — summary box on the launcher opens `/app/attention`                                                                                                                                                                                                  |
| 13  | 2    | Owner                            | Infrastructure is good but shouldn’t all be seen at login; boxes with sections to click on                                                                                                            | UX               | 1A — large tool cards, one status line each, permission-aware                                                                                                                                                                                            |
| 14  | 2–3  | Owner                            | Follow the earlier MVP layout (small attention section, then app boxes), fresher                                                                                                                      | UX               | 1A — pattern adopted within the current EverCalm visual system                                                                                                                                                                                           |
| 15  | 3    | Owner                            | Earlier dashboard screenshot: 2×2 counts (open shifts, pending time off, new applicants, overdue training) then tool boxes (Schedule, Team, Time off, Messages, Hiring, Training) with EN/ES and bell | UX / New         | 1A for layout; **New** — Spanish language (EN/ES) and applicants/hiring are new features, not built (see Decisions)                                                                                                                                      |
| 16  | 3    | Onboarding                       | Clicking employee names is unresponsive and slow                                                                                                                                                      | Defect           | 1A — measured; root cause below. The pressed link responds at once, a duplicate database transaction and unneeded directory loads were removed. The page is not yet materially faster on a hosted database                                               |
| 17  | 3    | Onboarding                       | Employee view looks nice                                                                                                                                                                              | —                | Noted                                                                                                                                                                                                                                                    |
| 18  | 3    | Onboarding / profile             | See the employee’s active shifts on their admin profile                                                                                                                                               | New (small)      | 1A — “Active and upcoming shifts” on the profile, published shifts only, limited to locations where the viewer may see the schedule                                                                                                                      |
| 19  | 3    | Onboarding                       | Big “Add new hire” button near the top                                                                                                                                                                | UX               | 1A — large “Add new hire” at the top of People and Onboarding for anyone who may invite; it opens the existing invitation flow                                                                                                                           |
| 20  | 3    | Scheduling                       | Clicking an open day doesn’t let you add shifts                                                                                                                                                       | Defect           | 1A — every day offers “Add shift”, opening the form with that date selected                                                                                                                                                                              |
| 21  | 4    | Scheduling                       | One-time guided setup: shifts per day, positions, time slots; clean day view (week view on desktop); auto-populated from employee responses; click an employee to add them                            | New / Decision   | Brief 1                                                                                                                                                                                                                                                  |
| 22  | 4    | Scheduling                       | Scheduling needs substantial separate integration work                                                                                                                                                | Decision         | Brief 1 — acknowledged as its own project                                                                                                                                                                                                                |
| 23  | 4    | Scheduling / availability        | Availability is a cut-off spreadsheet, not mobile; a per-employee dropdown or similar                                                                                                                 | UX               | Brief 1 (team availability rebuild); not changed in 1A beyond existing contained scroll                                                                                                                                                                  |
| 24  | 4    | Scheduling / templates           | Templates too complex; the system should do the heavy lifting                                                                                                                                         | Decision         | Brief 1 — templates remain; replaced by guided setup later                                                                                                                                                                                               |
| 25  | 4    | Operations                       | Handoffs are good but must be simpler: TASK, ASSIGNED TO                                                                                                                                              | UX               | 1A — simplified creation (task + assigned to); categories, priority and history preserved underneath                                                                                                                                                     |
| 26  | 4    | Operations                       | The task should reach the employee on their next shift or when they open the app                                                                                                                      | UX / New (small) | 1A — handoffs assigned to a person appear on their home and shift workspace                                                                                                                                                                              |
| 27  | 4    | Reports                          | Remove the tab entirely for now; redundant; returns with timesheets/payroll                                                                                                                           | UX               | 1A — removed from customer navigation only; routes, permissions, services, exports and tests kept (see Reports decision)                                                                                                                                 |
| 28  | 4    | Courses                          | Course builder doesn’t let you design and build real lessons                                                                                                                                          | New              | Brief 3                                                                                                                                                                                                                                                  |
| 29  | 4    | Courses                          | Pre-built courses plus create/import                                                                                                                                                                  | New              | Brief 3                                                                                                                                                                                                                                                  |
| 30  | 4    | Courses / sign-offs              | Managers don’t want to tick every box; check yes and be done                                                                                                                                          | UX               | 1A — one deliberate “Approve sign-off” after reviewing the criteria; criteria and audit record kept                                                                                                                                                      |
| 31  | 4    | Messages                         | Take from Slack/Discord                                                                                                                                                                               | New              | Brief 2                                                                                                                                                                                                                                                  |
| 32  | 4    | Messages                         | One announcement channel plus up to two custom channels; announcements by owners/managers; the other two anyone or managers only                                                                      | New / Decision   | Brief 2                                                                                                                                                                                                                                                  |
| 33  | 4    | Messages                         | Direct messaging between employers and staff; CA off-the-clock considerations                                                                                                                         | New / Decision   | Brief 2 (legal review required)                                                                                                                                                                                                                          |
| 34  | 5    | Missing                          | Document hub: upload handbooks and CA policies, offered free                                                                                                                                          | New / Decision   | Brief 4 (no legal-advice positioning)                                                                                                                                                                                                                    |
| 35  | 5    | Employee home                    | Too cluttered; simple boxes with icons (On Now, Your Schedule, Do This Next, Your Training, Messages)                                                                                                 | UX               | 1A — compact launcher cards; detail behind each card                                                                                                                                                                                                     |
| 36  | 5    | Employee home                    | “Where you work” unnecessary                                                                                                                                                                          | UX               | 1A — removed from home (still on each shift and in the profile)                                                                                                                                                                                          |
| 37  | 5    | Shifts / time off / availability | Likes these tabs                                                                                                                                                                                      | —                | Noted                                                                                                                                                                                                                                                    |
| 38  | 5    | Shifts                           | Shifts should also have a week view                                                                                                                                                                   | New              | Brief 1 (employee week view)                                                                                                                                                                                                                             |
| 39  | 5    | Time off                         | The “last day” field cuts outside its container                                                                                                                                                       | Defect           | 1A — fixed                                                                                                                                                                                                                                               |
| 40  | 5    | Shift                            | Unsure whether shift tasks will be used                                                                                                                                                               | Decision         | Decision — keep; measure use in the pilot before removing                                                                                                                                                                                                |
| 41  | 5    | Training                         | Simple; likes the view                                                                                                                                                                                | —                | Noted                                                                                                                                                                                                                                                    |
| 42  | 5    | Training                         | Needs “save progress” to leave and return later                                                                                                                                                       | UX / Defect      | 1A — Defect confirmed: a checklist lesson saved nothing until “Save progress” was pressed. Each tick now saves as it happens and the screen says “Progress saved”; the button is gone. Reading lessons and knowledge checks already saved when completed |
| 43  | 5    | Training                         | Started a course and couldn’t get out                                                                                                                                                                 | Defect           | 1A — every course and lesson screen opens with “Course overview”/“All training” and “Exit to Training”/“Home” links                                                                                                                                      |
| 44  | 5    | Schedule                         | Don’t reinvent the wheel                                                                                                                                                                              | Decision         | Brief 1                                                                                                                                                                                                                                                  |
| 45  | 5    | Inbox                            | Full schedule view and shift trades from here                                                                                                                                                         | New / Decision   | Brief 1 and 2 — schedule and trades already exist under Schedule; placement decision                                                                                                                                                                     |
| 46  | 5    | Account                          | Sign out appears broken                                                                                                                                                                               | Defect           | 1A — could not be reproduced as a sign-out failure; two real defects next to it fixed (findings below)                                                                                                                                                   |
| 47  | 5    | Back end                         | Unsure whether it is built correctly                                                                                                                                                                  | —                | Noted — isolation, RLS, audit and test evidence available on request                                                                                                                                                                                     |
| 48  | 5    | Conclusion                       | SIMPLICITY above all                                                                                                                                                                                  | UX (direction)   | 1A throughout                                                                                                                                                                                                                                            |
| 49  | 5    | Conclusion                       | Employers reach the tab they want and make changes in under a minute                                                                                                                                  | UX               | 1A — launcher with every permitted tool one tap away                                                                                                                                                                                                     |
| 50  | 5–6  | Conclusion                       | Employees can’t do ANYTHING until walkthrough steps are done (login, info, onboarding) before posting or seeing the schedule                                                                          | Decision         | Designed below as progressive activation; **not enforced in Round 1A**                                                                                                                                                                                   |

## Decisions still needed

1. **Brand palette** (#8): **decided and applied** — the stakeholder palette replaced the lavender/violet/pink system on 17 September 2026. What still needs the owner: the wordmark artwork, which still carries the old violet/pink mark (see “Assets that still carry the old colours”).
2. **Onboarding gate** (#50): approve the progressive-activation rules below, or ask for the total lockout. The total lockout conflicts with employees seeing their published schedule and receiving safety or HR notices.
3. **Industries** (#2): which sectors beyond restaurants and salons get templates first.
4. **Language** (#15): whether Spanish (EN/ES) is in scope and when.
5. **Hiring/applicants** (#15): whether applicant tracking is in scope at all.
6. **Shift tasks** (#40): keep and measure, simplify, or remove.
7. **Channels and direct messages** (#32–33): posting rules, retention, and California off-the-clock guidance before building.
8. **Document hub** (#34): storage provider, file scanning, and how CA policy templates are offered without implying legal advice.
9. **Reports** (#27): hidden, not deleted; returns with timesheets and payroll.
10. **Documents card** (#13): the stakeholder list of owner tools includes Documents, but there is no document hub yet. Round 1A leaves the card out rather than show a card that goes nowhere; it arrives with Brief 4.
11. **Sign-in rate limit for the stakeholder demo** (#46): production allows 5 sign-in attempts a minute per network. Several reviewers in one office switching demo accounts will hit it. Keep it (recommended), or raise it for the demo environment only.
12. **Deploying Round 1A** adds migration `0021_handoff_assignee.sql` (additive: one nullable column, a tenant-scoped foreign key and an index). The stakeholder-demo database is at 0020 and was not changed; it must be migrated before this code is deployed there.

## Product decisions taken (17 September 2026)

- **Documents stays off Home** until the document hub exists (Brief 4). No card
  is shown for something that cannot be opened.
- **The production sign-in limit stays at 5 attempts per IP per minute.**
- **The stakeholder demo allows 20 sign-in attempts per IP per minute**
  (built and released with Round 1A), so a room of reviewers switching demo
  accounts is not mistaken for an attack. It applies only to `/sign-in/email`,
  only when the validated `EVERCALM_ENVIRONMENT` is exactly
  `stakeholder-demo`; sign-up, forget-password and reset-password stay at the
  production values everywhere. `tests/unit/rate-limits.test.ts` proves that a
  missing, empty, differently-cased, padded or attacker-supplied value falls
  back to 5 a minute, and that the browser suite's relaxation can never apply
  in production.
- **The employee profile's ~35 sequential queries are recorded as
  high-priority performance debt** (see the measurements above). No broad query
  rewrite was attempted during review preparation. The work is to combine the
  per-section reads into a few queries and to measure again against a hosted
  database.

## Palette (applied 17 September 2026)

The five supplied colours were put into the shared tokens in
`src/app/globals.css`; no page substitutes its own colour. The hierarchy asked
for is what shipped: Navy for text, headings and dark surfaces; Deep Teal for
primary actions, current navigation and links; Soft Sage for secondary accents,
success and progress; Warm Sand for the calm application ground and raised
surfaces; Coral Pop for the one thing that needs a person and for warning
emphasis.

**Three of the five cannot carry small text on white**, so each has exactly one
measured darker variant while the stakeholder colour itself stays as fills,
borders, icons and large accents:

| Stakeholder colour  | On white | Text variant                           | On white |
| ------------------- | -------: | -------------------------------------- | -------: |
| Soft Sage `#7FB5A0` |   2.33:1 | `sage-700` `#2E6B54` (also `success`)  |   6.27:1 |
| Coral Pop `#E8856C` |   2.62:1 | `coral-700` `#A34128` (also `warning`) |   6.28:1 |
| Warm Sand `#F5E6D3` |   1.23:1 | none — a surface colour, never text    |        — |

Deep Teal is 2.18:1 on the navy dark ground, so dark surfaces use `teal-300`,
`sage-300` and `coral-300`. Every derived colour and its purpose is documented
in `docs/design-system.md`.

**Destructive stays crimson.** `danger #A8172B` shares no hue with Coral Pop,
so a delete or a failure can never be mistaken for a decorative coral accent.
Coral means "look at this"; crimson means "this went wrong".

### Brand assets

The wordmark was recoloured onto the palette at the owner's request, part by
part: **wordmark Navy `#1E2D3D`, hands Deep Teal `#2A5C5A`, central light
Coral Pop `#E8856C`, rays Soft Sage `#7FB5A0`**, on transparency. No shape
changed — `scripts/recolour-wordmark.py` separates the parts by connected
components and rewrites colour only, and every pixel keeps its original alpha
(verified: zero pixels differ from the original artwork's alpha). The
typography, proportions and the hand/light drawing are the supplied ones.

| Asset                                              | State                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `public/brand/evercalm-wordmark-brand.png`         | **In use.** The four-colour mark, cropped to its ink, transparent background                 |
| `public/brand/evercalm-wordmark-brand-on-dark.png` | **In use on dark grounds.** Wordmark in Warm Sand, hands in light teal; nothing else changes |
| `public/brand/evercalm-wordmark.png`               | The original black-and-violet artwork, kept and no longer referenced                         |
| `Brand Assets/ECL.png`                             | The supplied original; untouched                                                             |
| `Brand Assets/Homepage_Screenshot.png`             | A screenshot of the earlier lavender homepage (untracked reference); untouched               |

Verified legible at 22px, 32px, 48px and 72px on white, the canvas ground,
Warm Sand `#F5E6D3` and navy, and in the marketing, administration and
employee headers at desktop and phone widths.

A vector wordmark is still worth commissioning: this is a faithful raster
recolour, so it cannot be restyled further without the source artwork. The
four lifestyle photographs carry no brand colour and need no change.

## Reports: navigation decision

Reports is removed from the customer navigation and from the owner launcher.
The routes (`/app/reports`, `/app/reports/[report]`, CSV exports),
capabilities, services, report builders and their tests are unchanged, and a
direct visit keeps today’s safe behavior: authorized people see the report,
everyone else is refused exactly as before. There is no redirect: a redirect
would hide the data from the few people who still need an export while adding
no protection, and the “Needs attention” summary still links to report tables
where no dedicated page exists.

## Round 1A defects: what was found

Reproduced in real browsers (Chromium and WebKit) at 1280px desktop, iPhone 14
(390px), 360px and 820px tablet, against a separate local test database.

**Sign out appears broken (#46).** Signing out worked on every engine and
size, from the employee account menu and from administration, and a second
account could sign in afterwards; Back after signing out stayed on the sign-in
page. What was broken sat next to it:

- _Rate-limited sign-in was reported as a wrong password._ Sign-in allows 5
  attempts a minute per network. Reviewers signing out and switching demo
  accounts reach that quickly, and the form answered every refusal with
  “That email and password combination did not match” — which reads as
  switching accounts, or signing out, not working. A 429 now says “Too many
  sign-in attempts from this network in the last minute. Wait a minute, then
  try again.”
- _Administration sign-out ignored failure._ If the server call failed, the
  button spun forever or moved to a sign-in page that sent the still-signed-in
  person straight back. Both sign-out controls now share one routine that ends
  the session first, then loads the sign-in page fresh (replacing the history
  entry), and says so when it cannot. Sign-in also loads the next page fresh,
  so nothing of a previous person stays in the browser.

**Couldn't get out of a course (#43).** The only way out of a lesson was a
small grey “Course” word in the header, and pressing “Save progress” opened a
panel that took focus and offered no button. Course and lesson screens now
start with a visible “Course overview”/“All training” back link and an “Exit
to Training”/“Home” link.

**Training progress (#42).** A checklist lesson kept ticks only in the page
until “Save progress” was pressed; leaving lost them. Each tick now saves as it
happens, one save at a time with only the latest ticks sent, and shows
“Saving…”, then “Progress saved”. Ticking the last step completes the lesson.

**Time off “Last day” (#39).** The two date fields sat side by side at every
width. iPhone Safari gives a native date field a minimum width that ignores
its column, so the second field ran past the card. The fields stack on phones,
and date and time fields may now shrink to their column everywhere.

**Slow onboarding names (#16).** Measured locally with a proxy adding about
16ms per database round trip (similar to a hosted database):

| Profile page                        | Round trips                   | Click to rendered (median of 6) |
| ----------------------------------- | ----------------------------- | ------------------------------- |
| Before                              | 39 statements, 3 transactions | 708ms                           |
| After (with the new shifts section) | 35 statements, 2 transactions | 758ms                           |

Cause: opening a profile runs about 35 sequential queries, the page title read
the person again in its own transaction, and nothing on screen changed until
all of it finished (the loading bar was 2px). Changes: the page and its title
share one read; the directory, locations and separations load only for people
who can edit; onboarding and separations look up only the names they show; the
pressed link is marked at once and the loading bar is thicker. Loading the
profile's sections in parallel transactions was tried and was _slower_ (1,131ms),
because each extra connection costs more round trips than it saves. The
deployed demo's health check took 200–570ms warm, so on the hosted database
each click still waits roughly a second. Going further means fewer, combined
queries per page; that is follow-up work, not done here.

**Adding a shift on an empty day (#20).** Days on the manager's week had no
action, and an entirely empty week (as on Mon 21 September) showed one empty
message instead of the days. The week now always shows its days, and each has
“Add shift”, which opens the form with that day already chosen.

## Round 1A changes

- **Owner and manager home** (`/app`): a short welcome, a “Needs attention”
  box with the total and at most three figures that opens `/app/attention`
  (the full queue, onboarding list and credentials to chase), and a card for
  each tool the person can open — People, Onboarding, Schedule, Training,
  Operations, Communication, Settings — each with one status line from the
  same location-scoped figures. Navigation’s first item is now “Home”.
- **Employee home** (`/my`): urgent items stay in full view (messages to
  confirm, urgent notices, credentials running out, tasks handed to you), then
  icon cards for On now / My shift, Your schedule, Do this next, Your training
  and Messages. “Where you work” and the progress bars and previews moved off
  Home; the bottom navigation is unchanged. A course onboarding points to is
  not offered again under training.
- **Profile:** active and upcoming published shifts.
- **People and Onboarding:** “Add new hire”.
- **Reports** leave the navigation (see below).
- **Practical sign-off:** the criteria are listed to review; one “Approve
  sign-off” confirms them all and still records each criterion; sending back
  with a note sits behind “Not ready? Send it back to practise”.
- **Handoffs:** the form asks only for **Task** and **Assigned to** (“Whoever
  is on next” or anyone active at that location). Category defaults to
  follow-up and priority to normal; both, the history, acknowledgements and
  audit are unchanged. An assigned person is notified in the app, sees the
  handoff on Home until they mark it read, and sees it first on their shift.
  The assignee is checked on the server (same organization, active, works at
  the location) and recorded in the audit event.

## Onboarding gate — progressive activation (design for approval, not enforced)

Stakeholders asked that employees complete setup before doing anything else.
A total lockout would also hide the published schedule and safety notices,
which people need from day one. Proposed instead:

### States

| State                            | Meaning                                                                  | How it is reached                  |
| -------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| **Invited**                      | Has an invitation, no account                                            | Invitation sent                    |
| **Account ready**                | Signed in once with their own password                                   | Invitation accepted                |
| **Profile confirmed**            | Contact, emergency contact and required employee information confirmed   | Employee confirms the profile step |
| **Onboarding required complete** | Every _required_ onboarding step done, waived or awaiting only a manager | Onboarding progress                |
| **Active**                       | All of the above                                                         | Automatic                          |

### Always available, in every state after sign-in

- Published schedule (their own shifts)
- Requesting time off
- Safety and emergency communication
- Required HR messages and acknowledgements
- Onboarding itself, and training that onboarding requires
- Account menu, notification settings, and Sign out

### Gated until Active (proposed)

- Posting in non-essential channels (when channels exist)
- Claiming open shifts, offering or accepting swaps
- Optional training
- Other interactive workplace actions (e.g. leaving handoffs)

### Rules and exceptions

- A gated action shows _why_ and the single step that unlocks it, never a dead button.
- A manager can mark a person Active early (recorded in the audit log), for someone who starts before their paperwork completes.
- Anything waiting on a manager (a practical sign-off, a document the business hasn’t uploaded) never blocks the employee.
- Gating is enforced on the server as well as hidden in the interface, like every other permission.
- Existing employees are treated as Active when the feature launches.

### Prototype

Not built in Round 1A. The first build would add an activation state derived
from onboarding progress (no new stored flag except the manager override), a
`requireActivated()` check next to the existing capability checks, and a
“Finish setting up” card that leads the employee home until Active.

## Deferred implementation briefs (not built)

### Brief 1 — Scheduling redesign

- **Guided one-time setup:** per location, the shift types (e.g. line cook, register), roles and stations they need, how many of each per day, and time ranges. Replaces template authoring for most businesses; templates remain for advanced use.
- **Day view first** on phone and desktop, optional week view on desktop; unfilled demand shown as gaps to fill, not blank cells.
- **Availability** captured per employee as simple weekly choices on a phone, feeding suggestions; the manager’s team-availability view becomes a per-person picker instead of a wide grid.
- **System-assisted staffing:** suggested assignments that respect availability, time off, qualifications, rest and overtime (existing conflict rules), confirmed by the manager with one action.
- **Employee week view** and shift trading from the schedule, reusing the existing swap and open-shift workflows.
- **Keeps:** draft/publish separation, conflict detection, audit, location scope.

### Brief 2 — Communication

- **Announcements channel** (owners/managers post) plus **up to two organization-configurable channels**, each set to “anyone can post” or “managers only”.
- **Direct messages** between an employee and their managers; no employee-to-employee DMs unless approved.
- **Off-hours expectations:** quiet hours by default for non-urgent messages; clear labeling that replies are not expected off the clock; urgent/safety override remains. Needs California counsel review.
- **Retention and moderation:** retention period, message deletion rules, export for HR/legal holds, reporting abuse.
- **Keeps:** acknowledgements, receipts, delivery preferences and the existing announcement model.

### Brief 3 — Course authoring

- **Lesson editor** with real content blocks (text, images, video, checklists, knowledge checks) and preview.
- **EverCalm course library** of prebuilt, editable courses by industry.
- **Create or import** (e.g. SCORM-lite/structured import, or PDF-to-lesson).
- **Files and video:** storage provider, size limits, transcoding and bandwidth costs, captions for accessibility.
- **Keeps:** versioning, assignments, progress, practical sign-offs.

### Brief 4 — Document hub

- **Handbooks and workplace policies** uploaded per organization.
- **Visibility** by role and location.
- **Versioning** with acknowledgement per version, reusing the acknowledgement model.
- **Storage provider** decision (e.g. S3-compatible object storage), encryption at rest.
- **File scanning** for malware before availability.
- **Audit history** of upload, publish, view and acknowledgement.
- **California policy templates** provided as starting points with clear language that they are not legal advice and should be reviewed by counsel.

### Brief 5 — Timesheets and payroll (Phase 2)

- Time capture against published shifts, approvals, exports to payroll providers.
- **Reports navigation returns** with this work, focused on labor cost and hours.
