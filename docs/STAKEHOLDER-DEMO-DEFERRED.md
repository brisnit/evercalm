# What the stakeholder demo does not do yet

Round 2 was built front-end first, on purpose: the fastest way to find out
whether EverCalm is the right product is to walk somebody through the whole of
it. That decision has a cost, and this document is the invoice.

Everything here is a real gap between what a stakeholder sees and what a paying
restaurant would need on day one. Nothing in this list is hidden behind a dead
button: where a feature is simulated, the interface says so in the words a user
would use.

**How to read an entry.** Each one says what is implemented, what is simulated,
what production requires, roughly how much work that is, and when it should be
done.

- **Complexity** — small (under a day), medium (two to five days), large (more
  than a week, or needs a decision from outside engineering).
- **Priority** — **Before a paying customer** · **Before scale** · **When it
  earns it**.

---

## Security and hardening

### Document storage lives in the tenant database

**Implemented.** Upload, list, categorise, scope to a location, mark
managers-only, open and remove. Every byte is behind Row-Level Security, and
the route that serves a file authorizes on each request — a managers-only
document is a 404 for anybody else, including by direct URL.

**Simulated.** Nothing about the behaviour. What is wrong is *where* the bytes
are: a `bytea` column in the tenant database, capped at 8 MB by a check
constraint.

**Production requires.** Object storage (S3 or R2) with short-lived signed
URLs, the row keeping only a key and a checksum; a virus scan on upload; and a
migration that moves existing rows out. The authorization boundary does not
change — the signed URL is minted by the same code that answers the request
today.

**Complexity.** Medium. **Priority.** Before a paying customer — database
backups grow with every handbook, and restore time is the thing that bites.

### There is no `document.manage` capability

**Implemented.** Adding and removing documents is gated on
`announcement.create`, and reading a managers-only document on the same — the
people who can already speak for the whole company. A shift lead is a
keyholder, not a manager, and is correctly excluded.

**Simulated.** Nothing, but the mapping is a borrowed one.

**Production requires.** A `document.manage` capability in the registry, plus a
migration that inserts the `role_capabilities` row for every existing
organization's owner, HR admin and general manager roles. Capabilities are
stored rows, not code, so adding one is a data migration and was deliberately
not done during a front-end pass.

**Complexity.** Small. **Priority.** Before a paying customer.

### An employee may open a conversation with their own manager

**Implemented.** Starting a direct conversation needs `conversation.start`,
which managers hold and employees do not. One exception is written into the
service: a person may open a thread with the manager they report to, and a
manager with anyone who reports to them.

**Simulated.** Nothing. This is a deliberate product rule, not a gap — it is
listed because it is the only authorization decision in round 2 that is not a
capability check, and a reviewer should see it named.

**Production requires.** Confirmation that this is the intended rule, and an
integration test if it is (there is one:
`tests/integration/messaging.test.ts`).

**Complexity.** Small. **Priority.** When it earns it.

### Rate limiting covers sign-in, not writes

**Implemented.** Sign-in is rate limited. Tenant isolation, capability checks
and audit logging cover every write.

**Simulated.** Nothing.

**Production requires.** Per-actor limits on the expensive writes — autofill,
publication, document upload, message sending — so one person holding down a
button cannot degrade a tenant.

**Complexity.** Medium. **Priority.** Before scale.

---

## Backend

### Autofill is a greedy pass, not an optimiser

**Implemented.** Real assignment against real data: role qualification,
declared availability, approved time off, existing shifts, and a 40-hour
ceiling. It fills 42 of 51 slots on Harbor & Vine's week and explains every
decision in English.

**Simulated.** Nothing about the result — the shifts it creates are real draft
shifts. What is missing is optimality: it walks the week in order and takes the
best available person for each slot, so an earlier choice can strand a later
one. A human scheduler doing the same thing by hand makes the same mistake.

**Production requires.** A proper assignment pass — minimum-cost bipartite
matching over the week, with preference, fairness and overtime as weights —
and a second pass that tries to fill what the first left open by moving
earlier picks. The explanation panel stays as it is; it is the reason the
feature is trustworthy.

**Complexity.** Large. **Priority.** Before scale. A single-site operator
will not notice; a ten-site one will.

### Break placement is a rule, not a schedule

**Implemented.** Break rules are described once in the template wizard (meal
length, the shift length that triggers it, rest breaks, stagger) and applied to
every generated shift, which carries real unpaid break minutes into hours and
overtime arithmetic.

**Simulated.** The *time* each break is taken. The interface says breaks are
staggered; the system does not yet compute a per-person clock time for each
one, so nobody is told "your break is at 12:30".

**Production requires.** A break scheduler that lays out each shift's breaks
against the role's coverage, keeping at least one person per role on the floor,
and a `shift_breaks` table so the time is a record rather than a calculation.

**Complexity.** Medium. **Priority.** Before a paying customer — a staggered
break nobody is told about is not a staggered break.

### Call-out replacement does not notify the candidate

**Implemented.** A call-out is a recorded event. Replacement is a ranked list
of qualified people grouped by availability, showing what each person's week
becomes and whether it crosses overtime, and choosing one really reassigns the
shift and resolves the call-out.

**Simulated.** "Offer the shift to all available — first to accept gets it."
Today, choosing somebody assigns them directly.

**Production requires.** An offer record with an expiry, a notification to each
candidate, and a first-accept-wins race resolved in a transaction.

**Complexity.** Medium. **Priority.** Before a paying customer.

---

## Database

### Migration 0022–0024 are additive and unreviewed at scale

**Implemented.** Four messaging tables, four Slotted scheduling tables and one
documents table, each with the same `tenant_isolation` policy as the rest of
the database, and each picked up automatically by the RLS coverage test.

**Simulated.** Nothing.

**Production requires.** An index review against real query plans —
`schedule_overrides` and `schedule_day_reviews` are queried per week and have
only their uniqueness constraints; `documents` has no index on `category`; and
`channel_messages` will want keyset pagination long before it wants an index.

**Complexity.** Small. **Priority.** Before scale.

### Channel and thread history is unbounded

**Implemented.** Channels and direct threads store every message.

**Simulated.** Nothing.

**Production requires.** Pagination in the service (both currently read the
whole conversation), and a retention policy — how long a direct message
between a manager and an employee is kept is an HR question, not an
engineering one.

**Complexity.** Medium. **Priority.** Before scale.

---

## Scheduling engine

### The week grid does not support drag to move

**Implemented.** Every cell is a link to the slot picker, which is the full
decision surface — availability, hours, overtime, override. Desktop shows the
whole week; a phone shows one day at a time.

**Simulated.** The Slotted concept's "click a name to swap · drag between days
to move". Both moves are possible today; they take two taps instead of a drag.

**Production requires.** Pointer-based drag with a keyboard equivalent and a
live region announcing each move, plus optimistic update against the shift's
`version` column so two managers dragging at once cannot lose a change.

**Complexity.** Medium. **Priority.** When it earns it. This is polish on a
path that already works.

### Templates cannot be edited after they are created

**Implemented.** The four-step wizard creates a named week — open days,
staffing patterns, break rules — and the library lists them with their shape,
slot count and weekly hours. Archiving one frees its name.

**Simulated.** Nothing. There is simply no edit screen: to change a template
you archive it and build another, and weeks already generated are untouched.

**Production requires.** An edit path, and a decision about what editing means
for weeks already generated from it (nothing, is the right answer).

**Complexity.** Medium. **Priority.** Before a paying customer.

### A shift's times can be changed, a generated slot's cannot

**Implemented.** One-off edits never write back to the template — the rule
holds because nothing in the Slotted path touches `shift_templates` after
generation.

**Simulated.** The "for exceptions only" time editor from the concept. Changing
one shift's hours still happens on the older shift page, which round 2 did not
rebuild.

**Production requires.** Bringing that editor into the day view.

**Complexity.** Small. **Priority.** Before a paying customer.

---

## Notifications

### Publication notifies; nothing else does

**Implemented.** Publishing a schedule notifies exactly the people whose shifts
changed, through the existing delivery queue with retries and a worker.
Announcements deliver on the same path.

**Simulated.** Nothing about publication. What is missing is everything round 2
added: a new channel message, a direct message, a call-out, an override, and a
document marked as required reading all reach the person only when they next
open the app.

**Production requires.** Notification types for each, and — more importantly —
a per-person digest so a busy channel does not become a reason to turn
notifications off.

**Complexity.** Medium. **Priority.** Before a paying customer.

### No email or SMS provider is connected

**Implemented.** The delivery queue, retries, failure states, quiet hours and
per-person preferences.

**Simulated.** The send itself. The demo records a delivery and marks it sent
without a provider.

**Production requires.** A transactional email provider and an SMS provider,
per-tenant sending identity, bounce and opt-out handling, and the legal
plumbing that comes with texting employees.

**Complexity.** Large. **Priority.** Before a paying customer.

---

## Messaging

### Messages do not arrive until the page is reloaded

**Implemented.** Channels and direct threads are real: real tables, real tenant
isolation, unread counts, read receipts on direct messages, and a two-channel
ceiling enforced in the service rather than the form.

**Simulated.** Liveness. A message posted by somebody else appears when the
reader navigates or refreshes.

**Production requires.** A subscription — server-sent events are enough for
this shape of product — plus an unread badge that updates without a round
trip.

**Complexity.** Medium. **Priority.** Before a paying customer.

### No attachments, no editing, no deleting

**Implemented.** Plain text, up to 4,000 characters, with the author and time.

**Simulated.** Nothing.

**Production requires.** Decisions more than code: whether a manager can delete
an employee's message, whether an employee can delete their own, and what a
deleted message leaves behind. Attachments need the same object storage as the
document hub.

**Complexity.** Medium. **Priority.** When it earns it.

---

## File storage

### There is no file storage

**Implemented.** The document hub, working end to end, on `bytea` (see
**Security and hardening**).

**Simulated.** Nothing, within its 8 MB cap and its accepted types.

**Production requires.** One object-storage integration, which then serves the
document hub, message attachments, onboarding document requests, training
images and video, and shift-operations evidence photos. It is the single
highest-leverage piece of backend work outstanding: five features are waiting
on the same afternoon of plumbing.

**Complexity.** Medium. **Priority.** Before a paying customer.

---

## Training

### The library adopts; it does not update

**Implemented.** Five ready-made courses with real content, real lesson kinds
(reading, checklist, knowledge check, practical sign-off) and real minutes.
Adopting one creates a genuine draft course in the organization, which the
manager edits and publishes under their own name. Importing pasted text splits
it into reading lessons on its headings.

**Simulated.** Nothing. What does not exist is any link back: if EverCalm
improves a library course, organizations that already adopted it never hear.

**Production requires.** A decision first — a library course is either a
template (copy once, diverge freely, which is what it does now) or a
subscription (updates flow, edits are overlays). The first is almost certainly
right; it just needs to be said out loud.

**Complexity.** Small, once decided. **Priority.** When it earns it.

### Import is paste-only

**Implemented.** Paste a handbook or SOP; each heading becomes a lesson.

**Simulated.** Nothing — but the button a manager looks for is "upload the
PDF", and that is not there.

**Production requires.** File upload (see **File storage**) plus text
extraction for PDF and Word.

**Complexity.** Medium. **Priority.** Before a paying customer.

### Lessons have no images or video

**Implemented.** Text, checklists, quizzes and practical sign-offs.

**Simulated.** Nothing.

**Production requires.** File storage, and a video host if video is wanted —
which for "how to hold a knife" it probably is.

**Complexity.** Medium. **Priority.** When it earns it.

---

## Testing

### The new surfaces have integration tests; they have no browser tests

**Implemented.** 331 integration tests against real PostgreSQL, including 11
new ones covering the two-channel ceiling, managers-only visibility, who an
employee may message, and thread ownership. 313 unit tests. Both suites pass.

**Simulated.** Nothing.

**Production requires.** Playwright coverage of the round 2 flows —
particularly the review stack, where the gestures and their button equivalents
must both be proven, and the schedule flow from generate to publish. The flows
were verified by hand and by script during this pass; that is not the same as a
test that runs in CI.

**Complexity.** Medium. **Priority.** Before a paying customer.

### The Slotted service has no unit tests of its own

**Implemented.** `availabilityStateFor` is pure and exhaustively exercised
through the integration suite and by hand.

**Simulated.** Nothing.

**Production requires.** Direct unit tests for the four availability states,
particularly around midnight, clock changes and dated exceptions — the same
treatment `conflicts.ts` already has.

**Complexity.** Small. **Priority.** Before a paying customer.

---

## Observability

### Nothing measures how long a week takes to build

**Implemented.** Structured logging, health and readiness endpoints, an audit
log covering every permissioned act including the new ones (contact changes
record field names only, never values; documents record add and remove).

**Simulated.** Nothing.

**Production requires.** Product metrics for the claim the whole design rests
on: time from "generate" to "publish", how many autofill picks a manager
changes, how many days get flagged, how often an override is recorded. Slotted
promises a week in under ten minutes; nothing currently checks.

**Complexity.** Small. **Priority.** Before scale.

### No error tracking

**Implemented.** Errors are logged.

**Simulated.** Nothing.

**Production requires.** Sentry or equivalent, with release tagging and source
maps.

**Complexity.** Small. **Priority.** Before a paying customer.

---

## Performance

### The week is read with several queries per day

**Implemented.** `weekReview` loads a week's shifts, reviews, overrides and
people, and computes availability in memory. It is comfortably fast at
Harbor & Vine's size (51 slots, 15 people).

**Simulated.** Nothing.

**Production requires.** Measurement against a large site — 300 slots, 120
people — and, if needed, collapsing the per-person conflict context into one
query. `listChannels` and `listThreads` have the same shape: a query per row
for the last message, which is fine at two channels and wrong at two hundred
threads.

**Complexity.** Medium. **Priority.** Before scale.

### Every scheduling page is `force-dynamic`

**Implemented.** Correct and deliberate: a schedule is per-actor, per-tenant
and changes constantly.

**Simulated.** Nothing.

**Production requires.** Nothing urgent. When it matters, the win is caching
the *availability* computation per person per week, which is the expensive part
and changes rarely.

**Complexity.** Medium. **Priority.** When it earns it.
