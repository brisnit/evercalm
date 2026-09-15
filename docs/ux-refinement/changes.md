# UX and visual-design refinement: changes by phase

Companion to [the audit](audit.md). Evidence screenshots and measurements are
in `docs/screenshots/ux/<phase>/` (gitignored), captured with
`tests/e2e/screenshots-ux.spec.ts`.

## Phase 1 — Design system and navigation

**Tokens.** `canvas` (#F5F2FD) pale-lavender ground behind white surfaces in
every product shell; `field` (#878299) for control boundaries at 3.70:1 on
white and 3.34:1 on canvas, fixing the 1.6:1 input edges (A6). Measured values
are recorded in `docs/design-system.md`.

**Shared components.**

- `ButtonLink`, `TextLink` (with a 44px `standalone` form) and `BackLink`
  replace 27 hand-built link buttons, 12 colour-only text links and 21
  "← Label" links (X2, N4, M1).
- `Select` and `Textarea` replace 15 private `SELECT` and the private
  `TEXTAREA` class strings (X1).
- `Button` gains pressed feedback, a clearer disabled state and a
  violet-tinted secondary hover; `buttonClasses()` is shared with links (I4).
- `PageHeader` renders context as a plain line instead of an uppercase
  eyebrow, takes an optional `back` link, and redundant eyebrows that repeated
  the navigation section or organization were removed from 40+ pages (N3).
- `StatTile` shows zero as quiet and marks problems with a coloured edge
  instead of tinting whole tiles (H3).
- `ProgressRing` gradient ids are unique per ring (A1).
- `Disclosure` uses a drawn chevron with a hover state.
- Permission denied now tells people where access is actually granted (N5).
- Employment and onboarding states have labels (H4).

**Navigation.**

- `AppNav` for administration and the EverCalm team: current section marked
  with `aria-current`, weight and a violet rule (N1, A2). Below 1024px the
  sections sit behind one "Menu · Current section" row instead of wrapping into
  three rows (C5, M2).
- Section tabs stay on one scrolling row on a phone.
- Employees get a thumb-reach bottom bar on phones (Home, Schedule, Shift,
  Training, Inbox) and the same links in the header from tablet width up (N6,
  M3).
- A thin navigation progress bar shows that a click is loading (I1, P1).

**States.** Branded error and not-found screens for the administration,
employee and EverCalm team shells, and a root not-found page (S1).

Route `loading.tsx` skeletons were added and then **removed**: the Phase 1
browser run showed another tenant's shift and another location's report
answering **200** instead of 404. A loading boundary makes the page stream, and
a streamed response has already committed its status before `notFound()` runs
(Next.js 16 streaming guide, "Status codes"). Loading feedback is the
navigation progress bar instead, which leaves every 404 intact.

## Phase 2 — Employee experience

**Nothing on an employee screen talks about the product's roadmap or its
development setup (C2, C3).**

- An onboarding step waiting on a document now says "Your manager will share
  this document with you here. There is nothing to do until then." and is
  labelled "Not ready yet", instead of "arrive in a later release".
- Company setup no longer says scheduling, training and operations "arrive in
  later releases".
- Notification settings say "Every message appears in your inbox. Choose which
  ones also come by email." SMS and push are no longer shown as disabled "(not
  yet)" switches; channels appear when they can be delivered. Checkboxes are
  20px inside 44px rows (M4). The browser test now asserts no dead channel is
  offered.

**One primary action per screen (C4, H6).**

- Home picks a single lead: a message that needs confirming, otherwise the
  shift in progress, otherwise the next onboarding step. Every other button on
  the screen is secondary.
- The shift workspace makes only the first task that can be done primary;
  every other "Mark done" is secondary and smaller. "Can't do it?" is quieter.
- A completed or waiting course inside onboarding offers a secondary button;
  onboarding's own "Mark done" is secondary so the step list does not stack
  violet buttons. A message's in-body link is secondary; "I have read this"
  stays primary.

**What needs you comes first.** Notes from earlier shifts now sit after "Needs
attention now" instead of above it, so overdue and returned work is on the
first screen.

**Less repetition on home.** The schedule card no longer repeats the shift
already shown as "On now"; the messages card previews a message only when
something is unread or needs confirming; "Where you work" is a plain list.
Time off and Availability are 44px links.

**Colour means one thing (A4).** Onboarding progress is violet while in
progress, green when complete and amber only when overdue — never red because
a step is waiting on someone else. The "Next up" box on onboarding is a real
link to that step (I5).

**Readable labels.** Uppercase micro-labels on employee screens ("NEXT UP",
"EVERY STEP", day headings) became normal-case headings; the organization-name
eyebrow above each page title was removed (the header already shows it).
Finishing a shift says "Nice work." (B2).

## Phase 3 — Manager and owner experience

**The overview is a queue of decisions (C1).** `src/modules/reports/attention.ts`
reuses each report's own headline figures, so every count is scoped exactly as
the report is — the locations the person may see, the capabilities they hold —
and keeps only figures that ask for a decision: time off and swaps to decide,
shifts without anyone, blocked or waiting shift work, sign-offs waiting,
onboarding blocked or overdue, messages that could not be delivered. Each row
links to the page where it is decided (requests, operations, sign-offs,
onboarding, system status), falling back to the report when that page is not
the person's to open. Urgent first. When nothing needs a decision the card says
so in one calm line. The row of onboarding-only tiles is gone; "Invite someone"
became secondary so the queue leads (B3).

**Schedule (H1).** The week board leads; "Add a shift" is a header action that
jumps to the form, which now has a wider column, with templates and hours
stacked beside it instead of three equal cramped columns. Summary figures
lost their uppercase labels and zeros are quiet. Shift cards no longer truncate
role and station.

**Operations (H2).** The four figures carry a coloured edge only when non-zero.
Per-task "Send back", "Reassign" and "Reopen" are borderless disclosures, so the
needs-you list reads as a list. Station, role and person breakdowns are one
"How the day is going" card with collapsible groups (station open), instead of
three stacked cards repeating the same numbers.

**Toolbars (M2).** Location and week/day controls are one compact row of
`Select` and secondary buttons, not a card of controls.

**Decisions (I2).** When a request can only be refused, the refusal is
secondary; approving stays the one primary. The note field meets 3:1.

**Audit log (N7).** The latest 25 entries, with "Show older entries".

**Announcement composer (H5).** "Save as draft" sits in a bar that stays at the
bottom of the viewport, with a line saying nothing is sent on save.

**Phone header.** The organization name gets the room: a smaller logo and no
divider below the sm breakpoint.

### Phase 2 follow-up, found in the Phase 2 screenshots

The roadmap sentence was still visible on Ava's onboarding: it is **stored**
with each step when a checklist is assigned, so changing the service's wording
did not change existing rows. The seed now writes the current wording, and the
onboarding service translates that one legacy sentence wherever progress is
read, so no stored copy can reach a person. Home's onboarding progress now uses
the same colours as the onboarding page (amber only when overdue).

### Phase 3 fixes, found in the Phase 3 screenshots

- "Invite someone" on the overview was still primary; it is secondary, so the
  "Needs you" queue leads.
- The select's chevron was declared with a Tailwind background-image utility
  that tailwind-merge treated as a background colour, removing the white fill,
  so a select looked disabled on the canvas. The chevron is now set with an
  arbitrary background-image property. (Tailwind scans every project file for
  class names, documentation included, so class-like text must not be written
  literally in these notes: an example class with a placeholder URL broke the
  build.)
- Tests updated for intended changes: the directory shows "Invited" instead of
  the stored value; the audit isolation test reads the full history
  (`?all=1`) now that the log shows the latest 25.

## Phase 4 — EverCalm team dashboard

**Attention first.** `/platform` opens with "Needs attention": each organization
with a reason, in words — suspended, payment overdue, failed deliveries,
publish failures, open cases — most reasons first, linking to the organization.
When nothing needs the team, it says so. The full table follows, ordered the
same way.

**What this role can do.** A line under the title says what the signed-in
person's role permits, and what needs a support administrator (retrying
deliveries, changing a pilot's billing status), and restates that no one on
the team can sign in as a customer or read their people's records. Nothing
about the no-impersonation model or what staff can see changed.

**Words, not stored values.** Industry ("Salon & spa"), plan ("Multi-location"),
billing ("Manual pilot (billed by EverCalm)", "Test provider (development
only)"), severity ("High") and case category are labels. "Trial ends" appears
only while a subscription is trialing. "Last customer activity" says "No
sign-ins yet" instead of a dash. Background errors link to the organization
they belong to.

## Phase 5 — Marketing homepage

The approved structure, copy and hero stay as they were. What changed is how
the page moves, responds and makes room for people.

**Navigation on phones and tablets (N2).** Below 1024px a "Menu" button opens
the section links (Platform, For teams, Training, Industries, Rollout) and Sign
in. The links stay in the document, so every anchor still resolves.

**Motion, always optional.**

- Sections and cards rise gently into place as they approach the viewport,
  with a short stagger across a row of cards. They move but never fade: the
  first version faded them in, and the accessibility scan caught 53 text
  elements below contrast while half-transparent, so the fade was removed
  rather than the check. Content is visible by default: blocks are only
  hidden once script has loaded and marked the page ready; anything already on
  screen is shown immediately; nothing stays hidden beyond two seconds; and with
  `prefers-reduced-motion` nothing is hidden or animated at all.
- The hero phone floats very slightly, the console's "Live" dot pulses and the
  finished checklist item ticks in once. The float is on an inner box, so the
  measured phone never moves and the hero overlap tests still hold.
- Industry tab panels fade in when switched; tabs, capability cards and calls
  to action have hover, focus and pressed feedback.

**Lifestyle imagery.** The four supplied photographs now fill the
placements below (kitchen pass before service; a bar manager checking in with a
bartender; a stylist preparing her station; a team closing up together), served
through `next/image` from WebP copies, lazy-loaded below the fold, cropped with
a set focus so faces stay in frame. They were first built as placeholders: Four placements (beside "The promise",
at the top of both experience cards, and above the final call to action) render
clearly labelled "Photo placeholder" boxes describing the photograph intended
for each, at the final aspect ratio so swapping in a licensed image moves
nothing. No photography was downloaded or committed. The asset brief —
placements, crops, dimensions, art direction, alt text and licensing — is in
[lifestyle-imagery.md](lifestyle-imagery.md).

## Final verification (15 September 2026)

| Check                                      | Result                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, format, secret scan       | Clean                                                                                                                                                                            |
| Unit and PostgreSQL integration tests      | 40 files, 606 passed                                                                                                                                                             |
| Full browser suite, desktop and iPhone     | 238 passed, 1 skipped, 1 failed; the failure (iPhone training lesson did not render within 10s after "Continue") passed 3 of 3 on rerun — a slow first compile on the dev server |
| Production build, separate copy            | Succeeded                                                                                                                                                                        |
| UX captures, 218 screens across 9 personas | 0 axe violations, 0 sideways overflow, 0 console errors before and after; phone targets under 24px 240 → 181                                                                     |

## Remaining issues

- Shift work with many tasks is still long on a phone (Ava's 17 tasks ≈ 7,000px); tasks could collapse by section.
- Marcus's operations "Needs you now" list is long when many items are overdue; capping it needs the operations test to find items by name rather than position.
- The course detail page on employee training still has an uppercase "Training" eyebrow.
- The people profile still saves each field separately (I3), and support staff cannot filter cases by assignee.
- The homepage is about 13,800px on a phone. Commercial usage rights for the four supplied photographs should be confirmed and recorded before launch.
- The screenshot tool counts the active employee tab's violet marker as a primary button, inflating that count by one on employee pages.
