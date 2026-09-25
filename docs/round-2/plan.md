# Round 2 — implementation plan

Sources, in priority order: `EverCalm mvp round 2.pdf` (stakeholder feedback,
overrides earlier decisions), `Slotted-UX-Concept.pdf` (the scheduling product
model), the fifteen design comps, and `Option C · Two Sides of the Shift`.

## What is already here

352 source files, 71 tables, 19 modules. The manager application lives under
`src/app/(app)/app`, the employee application under `src/app/(me)/my`, the
EverCalm team console under `src/app/(platform)/platform`, and marketing under
`src/app/(marketing)`. Authorization is capability-based (`src/server/authz`),
every tenant read goes through `withTenant` and PostgreSQL RLS, and the UI kit
is `src/ui/primitives` plus `src/ui/patterns`.

**None of that changes.** Round 2 is a product and presentation change on top
of it.

### What maps onto Round 2 without new tables

| Round 2 concept | Already exists |
| --- | --- |
| Availability: available / not preferred / unavailable | `availability_rules.preference` = `preferred` / `available` / `unavailable` |
| Approved time off (hard stop) | `time_off_requests` with `approved` status |
| Demand template | `shift_templates` (role, station, times, `days_of_week`, `headcount`, breaks) |
| Draft vs published week | `schedules.status` + the `published_*` mirror columns on `shifts` |
| Conflicts and overtime | `src/modules/scheduling/conflicts.ts` |
| Course → lesson → content | `courses` → `course_versions` → `course_lessons.content` (JSONB) |
| Announcements with urgency and confirmation | the whole `comms` module |
| Shift trades, open shifts, claims | `shift_swap_requests`, `open_shift_claims` |

### What genuinely needs new data

- **Channels and direct messages.** `comms` has announcements only.
- **Documents.** Nothing exists.
- **Schedule review state** (approved / flagged per day) and **recorded
  overrides**, which the Slotted flow needs to survive a page reload.
- **Call-outs** as a first-class event, so a replacement is a decision and not
  an edit.

## Design system

The Round 1A palette is already the comps' palette. What changes is how it is
applied:

| Surface | Now | Round 2 |
| --- | --- | --- |
| Page top | white header, thin border | **navy band** carrying nav, title and page actions |
| Page body | sand canvas | warm white, calmer, with the band providing the contrast |
| Page title | 24–30px semibold | **oversized two-tone display type** ("Good to see you, **Dana**") |
| Primary action | teal | **coral** on cream, white on navy |
| Card | 1px line, flat | softer radius, layered shadow, hover lift |
| Icon tile | violet-tinted | pale mint |
| Mobile manager | header links | **bottom navigation** |

Decorative background geometry (large soft shapes, two-tone angled section
breaks) belongs on marketing and on the empty/hero moments inside the app —
not behind dense working surfaces.

## Phases

Each phase ends in a state that could be shown to a stakeholder.

| # | Phase | Scope | Status |
| --- | --- | --- | --- |
| 0 | Audit | This document | done |
| 1 | Design system + shells | Tokens, display type, cards, buttons, pills, manager navy shell, staff shell, mobile bottom nav | done |
| 2 | Manager Home | Comp layout; **remove the per-tile counts** (round 2 explicitly) | done |
| 3 | People | Directory to comp; **employee detail with editable contact** (explicit gap) | done |
| 4 | Onboarding | Visual conversion only — stakeholder had no objections | done |
| 5 | Communication | Announcements + exactly two custom channels + direct messages | done |
| 6 | Scheduling data | Template wizard, week generation, slots, review state, overrides | done |
| 7 | Autofill | Proposal + the explanation panel ("46 preferred, 2 not preferred, 3 time-off days respected…") | done |
| 8 | Review and publish | Day cards, approve/flag/edit, warnings, final check, publish | done |
| 9 | Desktop week grid | Dense grid, attention list, hours | done |
| 10 | Call-out | Ranked replacement candidates with hours and overtime | done |
| 11 | Training | Library, course builder with blocks, import path | done |
| 12 | Document hub | Upload, list, metadata, open, replace | done |
| 13 | Staff app | Home, schedule, shift, training, inbox, **profile** (new) | done |
| 14 | QA | Responsive, accessibility, console, overflow, demo walkthrough | done |

## Rules this work follows

1. **No parallel prototype.** Every change lands in the real application.
2. **Approved time off can never be overridden.** Unavailable can be, with a
   warning that is recorded and shown again at publish.
3. **Autofill never publishes.** It produces a draft the manager owns.
4. **A one-off edit never mutates the template.**
5. **At most two custom channels**, enforced server-side, not in the form.
6. Security, tenancy and authorization are untouched. Where a Round 2 feature
   would need deeper backend engineering than this pass allows, the interface
   is real and the gap is written down in `docs/STAKEHOLDER-DEMO-DEFERRED.md`
   rather than hidden behind a dead control.
