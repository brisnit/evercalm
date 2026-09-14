# Architecture

EverCalm is a **modular monolith**: one Next.js application, one deployment,
one CI pipeline, with module boundaries enforced by lint rules rather than by
network hops.

## Surfaces

| Route group   | Path                                     | Audience                                                                                            |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `(marketing)` | `/`, `/pricing`, `/contact`, `/security` | Public. Statically generated.                                                                       |
| `(auth)`      | `/signin`                                | Sign-in and recovery.                                                                               |
| `(app)`       | `/app/…`                                 | Company administration.                                                                             |
| `(me)`        | `/my`                                    | Employees. Mobile-first, and a **separate information architecture** rather than a narrowed `/app`. |
| `(platform)`  | `/platform/…`                            | EverCalm staff. Phase 2; not built.                                                                 |

A person who is both a manager and an employee holds both `/app` and `/my`.
Someone with no administrative capability is redirected from `/app` to `/my`
server-side.

## Module layout

```
src/
  modules/<name>/
    schema.ts       Drizzle tables for this module
    service.ts      business logic - authorizes, then touches data
    validators.ts   Zod schemas
    actions.ts      server actions ('use server')
  server/
    db/             tenant-scoped access, migrations, seed
    authz/          capability registry, role presets, can()/authorize()
    audit/          append-only event writer
    auth/           Better Auth configuration and session resolution
    email/          provider interface (development-safe by default)
    notifications/  audience and preference types (Slice 3+)
  ui/               design system
  lib/              env, errors, ids, dates, logging
```

Two lint rules hold the structure together, so a violation fails CI instead of
depending on someone noticing in review:

1. **`src/server/db/client`, `pg`** cannot be imported outside `src/server/db/`.
   Everything else uses `withTenant()`.
2. **Modules cannot import each other's `schema.ts`** — they talk through
   services. Schema files themselves are exempt, because declaring a composite
   `(organization_id, id)` foreign key _requires_ referencing the parent table;
   that cross-reference is the isolation mechanism, not a violation.

## Tenant isolation

Three independent layers. Any one failing does not expose data.

### 1. PostgreSQL Row-Level Security

Every tenant table carries a `tenant_isolation` policy:

```sql
USING      (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
```

`nullif` is load-bearing, not stylistic. After a transaction ends the setting
reverts to an **empty string**, and `''::uuid` raises `22P02`. With `nullif`
the predicate becomes `NULL`, which is never true — so policies **fail closed**
and return zero rows when there is no tenant context.

### 2. Tenant-scoped access

```ts
await withTenant(organizationId, async (tx) => { … })
```

Opens a transaction, sets `app.organization_id` with `SET LOCAL` semantics,
runs the callback. The setting cannot outlive the transaction, so it cannot
leak to the next request that borrows the same pooled connection.

`withGlobal()` / `globalDb()` exist only for the global identity tables, which
have no `organization_id` because authentication resolves before any
organization context exists.

### 3. Composite tenant-aware foreign keys

Child rows reference `(organization_id, id)` rather than `id`. A row pointing
at another tenant's parent is rejected by the schema itself, before any
application code runs — including for the migration role, which bypasses RLS.

### Cross-tenant access returns 404

Never 403. A 403 confirms the record exists.

## The sanctioned cross-tenant reads

Three questions have to be answered _before_ a tenant context exists, and each
is a `SECURITY DEFINER` function with a pinned `search_path`, schema-qualified
objects, and `EXECUTE` granted only to the runtime role:

| Migration | Function                                    | Returns                                                         |
| --------- | ------------------------------------------- | --------------------------------------------------------------- |
| `0002`    | membership lookup                           | one user's own memberships                                      |
| `0005`    | invitation lookup                           | one invitation, by token hash                                   |
| `0013`    | `evercalm_organizations_with_due_work(now)` | organization ids with background work due — no names, no counts |

None of them can be used to enumerate a tenant's employees. Everything that
follows each lookup runs inside `withTenant()`, under RLS.

## The global identity boundary

- **`user`, `session`, `account`, `verification`** — global. No
  `organization_id`, and **no tenant RLS policy**, because authentication has
  to resolve before an organization context exists. Adding RLS here would
  break the sign-in, verification, and password-reset lifecycle.
- **`employments`** — tenant-scoped. **Every organization-owned row references
  `employment_id`, never `user_id`.**

A person who works for two EverCalm customers has one global identity and two
employments that share nothing. The seed includes exactly this case
(`noa.feldman@example.test`, employed by both demo tenants) so the property is
tested rather than assumed.

### Because the database cannot isolate identity, the architecture does

The schema is split into three barrels:

| Barrel                             | Contents                        | Who may import it                                          |
| ---------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| `src/server/db/schema.ts`          | Tenant tables only              | Business modules, services, pages                          |
| `src/server/db/identity-schema.ts` | The four global identity tables | `src/server/auth/**`, `src/server/db/**`                   |
| `src/server/db/full-schema.ts`     | Both                            | Drizzle client typing, migrations, seed, RLS coverage test |

`withGlobal()` and `globalDb()` live in `src/server/db/global.ts` under the same
restriction. Business modules only ever get `withTenant()`.

**The tenant barrel does not re-export identity tables at all**, so a business
module cannot reach `users` even by accident — there is no path to it from
`@/server/db/schema`.

Three rules follow:

1. **The global `user` table is never an employee directory.** One row can
   belong to several customers, so reading it in a tenant feature would leak
   that a person also works somewhere else.
2. **All tenant-facing people queries resolve through `employments`**
   (`src/modules/people/service.ts`). The directory is not searchable by email,
   because an email search is an existence oracle.
3. **Email lookups are tenant-scoped.** `findEmploymentByEmailInTenant()` can
   answer "does this organization already employ this address"; it can never
   answer "does this person have an EverCalm account". An address belonging to
   another tenant and an address belonging to nobody return the same result.

### Enforced twice, on purpose

- **ESLint** `no-restricted-imports`, scoped so the database layer, the
  authentication adapter, and module _schema_ files (which must reference
  `users` structurally to declare the `employments.user_id` foreign key) are
  the only exemptions.
- **`tests/unit/architecture.test.ts`**, which scans the source tree and the
  runtime exports independently of any lint configuration, and asserts the API
  route surface is exactly `auth/[...all]` and `health`.

The duplication is deliberate: `no-restricted-imports` is _replaced_, not
merged, by a later matching flat-config block, and an earlier version of this
config silently lost the identity rules that way. The test does not depend on
lint being configured correctly.

## Invitations: the only anonymous write path

Accepting an invitation is the one place an unauthenticated caller writes data,
so it is deliberately narrow.

| Property                | How                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens are never stored | 32 random bytes, base64url; only the SHA-256 is persisted                                                                                                                                                  |
| Single use              | Acceptance claims the row with a conditional `UPDATE ... WHERE status = 'pending'`, so a race produces one employment and one failure                                                                      |
| Expiry                  | Checked on lookup; an expired link is indistinguishable from an invented one                                                                                                                               |
| Revocation is immediate | Revoking replaces the hash with a dead value, so an outstanding link stops working at once                                                                                                                 |
| Resend rotates          | A new token is issued and the old hash replaced, so a forwarded old link dies                                                                                                                              |
| No enumeration          | The preview returns the organization and nothing personal. The account is created from the **invitation's** address, never from the form, so the page cannot be used to discover who an address belongs to |
| Nothing granted early   | Role, scope and locations are stored as intent and applied only on acceptance                                                                                                                              |
| Rate limited            | Per organization per rolling hour, plus a per-invitation resend cooldown                                                                                                                                   |

Migration `0005` provides the SECURITY DEFINER lookup, keyed on the hash. It is
the second and last sanctioned cross-tenant read, and the pre-authentication
call is routed through `src/server/auth/invitation-access.ts` so unscoped
database access stays confined to the auth layer.

## The integration boundary with later slices

Onboarding steps of kind `training_assignment` and `policy_ack` point at systems that have
not been built. Rather than letting them be ticked off as if they had, they
start **blocked** with a stated reason, and the service refuses to complete
them.

They are also distinguished from real blockers: `awaitingPlatform` marks a step
waiting on EverCalm rather than on a person. The onboarding board counts only
human-actionable blocks as "blocked", because a board where every new hire is
blocked by our own roadmap tells a manager nothing.

When Slice 5 lands, a training step points at a real assignment through the
`reference_type` / `reference_id` pair with no schema change here.

## Onboarding templates are versioned, and published versions are immutable

A checklist is three things, not one:

| Table                            | Holds                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| `onboarding_templates`           | The identity of a checklist: its name, description, targeting, status |
| `onboarding_template_versions`   | One editable draft or one frozen published version                    |
| `onboarding_sections` / `_steps` | The content, owned by a **version**, never by the template            |

The rule the whole design exists to enforce: **once a version is published, its
content cannot change.** Editing means creating a new draft.

Two properties follow, and both matter to somebody:

- An assignment pins `template_version_id`. A person part-way through a
  checklist keeps working through exactly the steps they were given, even if an
  administrator publishes three new versions that afternoon.
- An audit trail of "what was this person actually asked to do" survives,
  because the version they were assigned still exists unaltered.

Every content mutation goes through one gate, `requireDraftVersion()`, which
loads the version and refuses anything that is not a draft. Authoring actions do
not each re-implement the check, so a new one cannot forget it. Assignment is
guarded from the other side: `resolveTemplateForAssignment()` considers only
published, non-archived versions, so an unfinished draft cannot reach a new hire
by accident.

Migration `0006` restructured the original flat model and carried the existing
data across, mapping the old step kinds onto the new ones, creating a v1 for
every template, and repointing every step and assignment.

## Importing people from a spreadsheet

The import is the only place EverCalm ingests a file somebody else produced, so
the rules are concentrated and tested rather than spread through the UI.

`src/modules/people/csv.ts` is pure and dependency-free — parsing, header
detection, field validation, safe output — which is what makes the hostile cases
exhaustively unit-testable. The database-aware half lives in
`import-service.ts`.

| Property                        | How                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tenant is never in the file | `organizationId` always comes from the session. No column maps to an organization id, and a header claiming to be one is simply unrecognised                                                            |
| Preview writes nothing          | `previewImport()` is read-only                                                                                                                                                                          |
| Confirmation re-validates       | `runImport()` re-parses and re-validates the raw text from scratch. Nothing the preview computed is trusted as input, so a hand-crafted post cannot submit pre-approved rows                            |
| All or nothing                  | One transaction                                                                                                                                                                                         |
| No formulas in our own report   | Any exported cell beginning `=`, `+`, `-` or `@`, with or without leading whitespace, is prefixed with a quote. The error report echoes untrusted input, so without this our report would be the attack |
| Invitations are explicit        | Never sent during preview. At confirmation the administrator chooses, and the choice defaults to off                                                                                                    |
| Bounded                         | 500 rows and 1 MB per file, plus a rolling-hour ceiling measured by people actually created                                                                                                             |

Line numbers count the file as a spreadsheet shows it: interior blank rows are
kept through parsing so that a stray empty line in the middle does not shift
every later error message onto the wrong row.

## Announcements: audience, receipts, and revisions

Five tables, and the split is the design:

| Table                     | Holds                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `announcement_categories` | Tenant-owned rows, not a code enum, so a salon can rename "Operations" |
| `announcements`           | The durable thing: status, schedule, priority, targeting               |
| `announcement_revisions`  | Immutable content history. **Content lives on a revision**             |
| `announcement_audience`   | Explicit include/exclude rules                                         |
| `announcement_recipients` | The materialised result, one row per person                            |

### Why content lives on a revision

An acknowledgement is a claim about a specific wording — "I read the allergen
policy". If an author could edit the text in place, every previous
acknowledgement would silently become a claim about text nobody agreed to. So
each recipient's acknowledgement records `acknowledged_revision_id`, and a
**material** revision sets `reacknowledgement_requested_at` on everyone who had
already confirmed, without erasing what they confirmed or when.

The employee sees this stated: "You confirmed revision 1 on the 3rd. It has
been revised since, so please read it again."

### The audience model

Rules, not a stored query. Three rules govern how they combine, and the
authoring screen says them in the same words:

- **includes are a union** — anyone matching any include rule is in
- **excludes are subtracted** — anyone matching any exclude rule is out
- **exclude always wins**, even against a more specific include

A union rather than an intersection because that is what a manager means.
"All bartenders and all hosts" is two groups of people; read as an intersection
it is the empty set of people who are somehow both. Narrowing is expressed by
excluding, which reads the way it behaves: "everyone at Riverside, except the
kitchen".

Seven selector types: `organization`, `location`, `department`, `job_role`,
`team`, `station`, `employment`. Two are resolved rather than stored:

- a **department** contains job roles, and people belong to roles
- a **station** is a place to work during a shift, not a roster, so targeting
  a work position means the people who could be put on it: everyone at that
  station's location holding its job role. When scheduling lands, this becomes
  answerable precisely without the selector type changing.

`employment_teams` was added in this slice. Teams existed as a structural unit
but nobody belonged to one, which made "tell the closing team" impossible to
express.

### Scope is checked twice

`assertRulesWithinScope` runs when a draft is saved **and again at
publication**. A manager whose grant is narrowed between the two must not still
publish the wider audience. A location-scoped author cannot target the
organization, another location, or a person who does not work somewhere they
cover; departments and job roles span the organization, so they are refused as
a standalone include for such an author.

### Why recipients are materialised at publication

Publishing writes one row per person rather than resolving the audience on
every read. Three reasons, in order of weight:

1. **Receipts need a stable denominator.** "12 of 40 acknowledged" must not
   change because somebody was hired this morning.
2. **Reporting must survive people moving.** The row snapshots the location,
   department and job role the person held _when they were targeted_, so a
   bartender who transfers next month does not rewrite last month's report.
   Every receipt query filters on `location_id_at_publish`, never on where the
   person is today.
3. **Acknowledgement is a record with consequences.** It has to be pinned to a
   person, a revision, and a time.

The cost is that somebody hired after publication is not a recipient. That is
handled explicitly rather than by recomputing: `syncRecipients` re-runs the
audience and inserts only the people who are missing. It is safe to run
repeatedly because `(organization_id, announcement_id, employment_id)` is
unique — which is also what makes publication itself idempotent under retry.

### Reading is never acknowledging

Opening an announcement records a view: `first_viewed_at` once,
`last_viewed_at` and a counter every time. Acknowledgement only ever happens
through `acknowledge()`, reached from a button a person deliberately presses.
"They opened it" is not a defensible answer to "did they agree to the allergen
policy", and a system that conflates the two produces a record that looks like
consent and is not.

## Notifications

One queue, many channels. A notification row is the intent to tell somebody
something on one channel. Announcements, schedules (Slice 4) and messaging
(Phase 2) all enqueue here rather than each growing a delivery path.

**What a row does not contain:** the announcement body. Delivery records
outlive the thing they point at, are read by administrators debugging a queue,
and may one day be handed to a channel provider. A row carries a title, a short
non-sensitive preview, and a pointer — never the content, and never anything
about the person beyond their employment id.

Two separate decisions shape a row, each with its own override flag (see
[the delivery policy](permissions.md#the-delivery-policy) for which messages
carry which):

1. **Is the category switched off for this person and channel?** Then the row
   is written as `suppressed` rather than not written — a suppressed row is the
   evidence that we deliberately did not tell somebody something. Skipped when
   the message `overrides_preferences` (stored as `mandatory`).
2. **Are they inside quiet hours?** Then the row is `pending` with
   `scheduled_for` moved to the end of the window. **Delayed, never dropped.**
   Skipped only when the message `overrides_quiet_hours` — a narrower flag,
   because "cannot be muted" and "may wake you" are different promises.

In-app and email rows are queued together for every announcement and reminder,
under the same policy.

Quiet hours are measured in the person's own timezone, defaulting to their home
location's, and the overnight case (22:00–07:00, where start > end) is the
normal shape rather than an edge case.

`idempotency_key` is `(subject, employment, channel, purpose)`, unique per
organization. A retried publish, a double-clicked button and two racing workers
converge on one row; a reminder carries its number in `purpose`, so today's
nudge and tomorrow's are different messages while a double click is not.

**No external mail leaves the machine.** The provider is the development-safe
console provider; the Resend path still refuses to start without an approved
sending domain, and no domain is assumed anywhere.

## Background work

Scheduled publishing, expiry, automatic acknowledgement reminders and
notification delivery are done by one worker, `src/server/jobs/worker.ts`.

### What a tick does

`runWorkerTick(now)` asks `evercalm_organizations_with_due_work(now)` which
organizations have anything due, then for each, inside `withTenant()` as the
runtime role:

1. **Publish** each scheduled announcement whose `publish_at` has passed — one
   transaction per announcement, re-checking the scheduler's permissions and
   audience scope at that moment.
2. **Expire** published announcements past `expires_at`, cancelling anything
   still queued for them.
3. **Remind** — one "due within a day" and one "overdue" reminder per person
   who has not confirmed.
4. **Deliver** queued notifications: claim, send outside any transaction,
   complete.

The steps run in that order, so an announcement published in step 1 is
delivered in step 4 of the same tick. A failure in one organization or one
step is logged and reported; the rest of the tick continues.

### Why it is durable and idempotent

The worker holds no state. Every decision is a row:

| Work              | Claimed by                                                                                     | So a second worker…                      |
| ----------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Scheduled publish | `UPDATE … SET status='published' WHERE status='scheduled' AND publish_at <= now`               | blocks, then matches nothing             |
| Recipients        | unique `(organization, announcement, employment)`                                              | inserts nothing                          |
| Expiry            | `SELECT … FOR UPDATE SKIP LOCKED`, then conditional update                                     | skips the row                            |
| Reminders         | announcement row `FOR UPDATE SKIP LOCKED`; `WHERE due_soon_reminded_at IS NULL` per recipient  | skips, or matches nothing                |
| Notifications     | unique `idempotency_key`; delivery **lease** (`locked_until`, `claim_token`) via `SKIP LOCKED` | takes different rows                     |
| Completion        | `WHERE claim_token = <mine> AND status = 'pending'`                                            | cannot overwrite a result (`lease_lost`) |

Any number of workers can therefore run at once. The integration suite runs
four concurrently at the same instant and asserts each announcement is
published once, each person has one recipient row, and no notification is sent
twice (`tests/integration/worker.test.ts`).

### Starting and stopping

| Command                 | What it does                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`           | web server **and** worker, output prefixed; if either exits, both stop            |
| `npm run dev:web`       | web server only                                                                   |
| `npm run worker`        | the worker alone, ticking every `WORKER_INTERVAL_MS` (default 15 s)               |
| `npm run worker:once`   | one tick, then exit; non-zero exit if any step failed                             |
| `npm run worker:status` | PID, interval, time since last tick and its counts; warns when ticks look stalled |
| `npm run worker:stop`   | sends SIGTERM to the running worker and waits for it to exit                      |

The worker refuses to start with a database role that can bypass RLS, the same
boot guard as the web server. It writes `.tmp/worker.json` (PID, last tick) for
`worker:status`; a second `npm run worker` finds a live PID there and exits
rather than starting a duplicate — although a duplicate would be safe.

**Stopping** (Ctrl+C, SIGTERM, `worker:stop`) finishes the tick in progress —
every step is transactional, so killing it outright is also safe; finishing
merely avoids waiting out a delivery lease — then closes the pool and exits.
Ticks in one process never overlap: the next is scheduled only after the
previous finishes.

### Retries

| Failure                                                        | What happens                                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transient delivery error (provider timeout)                    | retried after 30 s, 2 m, 8 m, 32 m (capped at 1 h); after **5** attempts the row is `failed` with the reason                                                                         |
| Permanent delivery error (no email address, channel not built) | `failed` immediately, not retried                                                                                                                                                    |
| An administrator retries a failed row                          | attempts reset; the next tick picks it up                                                                                                                                            |
| Scheduler lost permission, left, or audience out of scope      | back to **draft** with `publish_failure_reason`, an `announcement.schedule_failed` audit event, and a banner on the announcement. Not retried: waiting will not restore a permission |
| Database error during any step                                 | that transaction rolls back; the work is still due, and the next tick retries it                                                                                                     |

Failure reasons are trimmed and have anything shaped like an email address
removed before they are stored or logged.

### Recovery after downtime

Nothing is lost while no worker runs; on the first tick back:

- A schedule whose time passed is published then — once.
- A schedule whose **expiry** also passed is marked expired and **not sent**,
  with an audit event saying why. A notice about something already over is
  worse than none.
- A confirmation already past due gets only the "overdue" reminder, not a stale
  "due soon" first.
- A **material revision** resets the reminder stamps of the people asked to
  confirm again, and the reminder key carries the revision number
  (`auto-due-soon-r2`), so they are reminded afresh while anyone already
  reminded and still outstanding is not reminded twice for the same stage.
- A schedule whose author was **suspended or separated** before publish time
  returns to draft with the reason; reinstating them does not resurrect it.
- A notification claimed by a worker that crashed becomes claimable again when
  its 2-minute lease expires, and is delivered once. The crashed worker's late
  completion is refused.
- Held quiet-hours notifications whose window ended are delivered.

### Delivery guarantees

In-app delivery is exactly-once: "sending" is recording the row. Email is
at-least-once in one narrow window — the provider accepted the message and the
worker died before completing. The lease is far longer than a send, and a real
provider integration should pass the notification id as its idempotency key to
close that window.

### Production (not provisioned)

A scheduler — a platform cron, a queue trigger — invokes `npm run worker:once`
(or `runWorkerTick()` from a route) every minute. Overlapping invocations are
safe by construction. None is configured; that needs approval.

## Scheduling

Slice 4. Everything lives in `src/modules/scheduling`: pure rules in `time.ts`,
`conflicts.ts` and `changes.ts`; database work in `service.ts` (managers),
`requests.ts` (time off, availability, claims, swaps), `employee.ts` (the
employee's reads) and `manager.ts` (one shift's detail); tables in `schema.ts`,
mirrored by `drizzle/0015_scheduling.sql`.

Industry-neutral by construction. A shift is a period of work at a location,
optionally for a job role and at a station. The restaurant's rows say "Bar
close" and "Grill"; the salon's say "Colour bar" and "Chair 2". No code knows
which.

### Time is the location's wall clock

A manager typing "4:00 PM – 10:30 PM on Tuesday" means those clock times where
the work happens. `shiftInstants()` turns a local date and two clock times into
`timestamptz` instants in the location's IANA timezone, and:

- an end time at or before the start means the shift ends the next day;
- a clock time that does not exist (02:30 when clocks spring forward) is
  **refused**, not silently moved;
- the real elapsed time is stored, so a night shift on the night clocks fall
  back is nine hours, not eight;
- a week is Monday to Sunday in the location's own calendar.

Boise Bench runs on Denver time and Pearl District on Los Angeles time inside
the same organization; both are tested.

### Two copies of every shift

A shift carries its **live** columns, which managers edit, and its
**published** columns (`published_starts_at`, `published_assignee_employment_id`,
…), which are what employees were last told. Employees only ever read the
published copy. Editing a published week therefore changes nothing for anyone
until the manager presses **Publish changes**, and the week shows
"Changes not published" until then.

Publishing (`publishSchedule`):

1. locks the schedule row, so two managers pressing Publish produce one
   version;
2. refuses while any assigned shift has a **blocking** conflict;
3. diffs live against published per person (`diffPublication`): _added_,
   _removed_, _changed_; people with no difference are not in the result;
4. copies live over published in one statement and bumps the version;
5. notifies exactly the people in the diff, keyed on the version, plus eligible
   people about newly offered open shifts.

Decisions already agreed by everyone involved — an approved swap, a claimed open
shift — apply to **both** copies at once (`reassignNow`), because the people
involved agreed to exactly that change.

### Conflicts

`detectConflicts(shift, person)` is a pure function, and the only place the
rules live. The assignment picker, publication, open-shift claims and swap
approvals all call it.

| Severity  | Conflict                                                                            |
| --------- | ----------------------------------------------------------------------------------- |
| **Block** | overlaps another active shift (any location)                                        |
| **Block** | approved time off during the shift                                                  |
| **Block** | not assigned to the shift's location                                                |
| **Block** | not an active employment                                                            |
| Warn      | pending time off                                                                    |
| Warn      | declared unavailability (a dated exception replaces the weekly pattern for its day) |
| Warn      | does not hold the shift's job role                                                  |
| Warn      | less than 8 hours between shifts                                                    |
| Warn      | more than 40 scheduled hours in the local week                                      |

The 8-hour and 40-hour thresholds are **organization defaults for a warning,
not labour-law rules.** EverCalm does not encode jurisdiction-specific
working-time law.

Approving time off never unassigns anyone. Their shifts in that period gain a
blocking conflict, publication is refused until a manager reassigns or opens
them, and the approval result lists the affected shifts.

### Concurrency

| Race                                                   | What stops it                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| One person booked on two overlapping shifts            | `shifts_no_double_booking` exclusion constraint (btree_gist), deferred inside a trade so both moves are checked together         |
| Two swap requests for the same shift                   | partial unique indexes on active requests, on both sides of a trade                                                              |
| Two managers deciding the same swap or claim           | the request row is locked `FOR UPDATE`; the second finds it already decided                                                      |
| Two approvals that move the same shift                 | each move requires the shift's `version` and assignee to be what was agreed; otherwise the request **expires** and nothing moves |
| A swap agreed about a shift a manager has since edited | same version check                                                                                                               |
| Two approvers deciding the same time off               | conditional update on `status = 'pending'`                                                                                       |

Each is exercised with concurrent transactions in
`tests/integration/scheduling.test.ts`.

### Authorization

Every scheduling capability is location-scopable (see
[permissions](permissions.md#scheduling-capabilities)). Outside every scheduling
scope an actor holds, a location, shift or person reads as **not found** — the
same answer another tenant's rows give under RLS. Inside scope but without the
specific capability, the answer is **forbidden**. Availability is changed only
by the person it describes, and nobody decides their own time off, claim or
swap.

### Notifications and records

Schedule notifications use the `schedule` category, in-app and email, and
respect preferences and quiet hours: a schedule change is important but is not
a safety notice. Time off, claims, swaps, schedules and templates are retired
by status and never deleted — DELETE is revoked from the runtime role — and
every decision writes an audit event. A time-off reason and note are not copied
into the audit log.

## Audit

`recordAuditEvent()` takes the caller's transaction, so an action and its audit
row commit or roll back together. `UPDATE` and `DELETE` on `audit_events` are
revoked from the runtime role at the database level.

Platform-scoped events (sign-in) carry `organization_id IS NULL`. `NULL` never
equals a tenant id, so those rows are invisible to every tenant.

## Column naming

Domain tables use `snake_case`. The four Better Auth identity tables use that
library's expected `camelCase` field names. The split is deliberate: it avoids
a mapping layer between us and the auth library.
