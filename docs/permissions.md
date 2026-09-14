# Permissions

## Capabilities are code, not rows

Capability keys live in `src/server/authz/capabilities.ts` as typed constants.
A typo is a compile error, and the set can never drift from the code that
checks it. `role_capabilities` stores the string keys per organization.

48 capabilities are defined across seven groups. Capabilities whose feature
ships in a later slice carry `plannedSlice` — declared now so scheduling,
training, and messaging land **without an authorization retrofit**. Nothing in
the interface offers them.

## Scope semantics

```ts
can(actor, cap) // organization-wide
can(actor, cap, { locationId: 'x' }) // at location x
```

- An **org-scoped** grant satisfies both.
- A **location-scoped** grant satisfies only the second, and only for that
  exact location.
- **Asking without a location is the stronger question, not a wildcard.**

This is what makes "General Manager at Riverside, Server at Downtown"
expressible, and what stops a location manager from acting on a sibling
location of the same organization.

`locationScopable: false` capabilities (organization settings, billing,
permission management, separation, exports) can only ever be held org-wide. A
location grant carrying one is filtered out at resolution time _and_ refused
by `can()` — defence in depth against bad data.

## Self-access is ownership, not capability

An employee needs no capability to read or change their own record;
`isSelf(actor, employmentId)` governs it. This is why the Employee preset holds
**zero** capabilities, which is the correct default.

## Role presets

Seeded into each organization as editable rows. Every check in the codebase
asks for a capability, never a role name — including **Shift Lead**, which is
an ordinary preset with a granular capability set and location scope, with no
special-case branch anywhere.

| Role             | Default scope | Holds                                                                                                                                          |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner            | organization  | Every capability. The only role with `org.manage_roles`.                                                                                       |
| HR Administrator | organization  | People including sensitive fields, separation, audit, announcements, training assignment, people reporting.                                    |
| General Manager  | **location**  | Daily operations, scheduling, announcements, checklist verification, skill sign-off, local training progress. **Not** sensitive employee data. |
| Scheduler        | **location**  | Availability, schedules, templates, time off, swaps, open shifts.                                                                              |
| Training Manager | organization  | Authoring, publishing, assignment, skills, verification, training reporting.                                                                   |
| Shift Lead       | **location**  | Employee, plus checklist verification, handoffs, and announcement receipts.                                                                    |
| Employee         | organization  | Nothing. Self-access only.                                                                                                                     |

### Two deliberate withholdings

- **General Managers do not hold `people.view_sensitive`.** Date of birth,
  emergency contacts, and personal contact details are HR and Owner only.
- **`people.separate` is Owner and HR only**, and carries a two-person rule:
  the actor must hold the capability _and_ a second distinct approver holding
  it organization-wide must confirm. (The capability exists now; the workflow
  ships in Slice 2.)

## Human control over employment decisions

1. No automated adverse action exists in the codebase. The system surfaces
   overdue work; it never suspends, disciplines, or flags anyone for
   termination. No code path changes employment status without a named human.
2. `org.manage_roles` is Owner-only, so nobody can quietly widen their own
   access.
3. Every sensitive action writes an append-only audit event in the same
   transaction.

## Per-person checks are scoped to that person's location

A subtle rule, and the source of a whole family of bugs found during Slice 2:

- A question **about one person** (`getEmployment`, `listCredentials`,
  `getProgressForEmployment`, `completeStep`) is asked at **that person's home
  location**. Asking it organization-wide refuses a General Manager for their
  own staff, because their grant is location-scoped.
- A question **about a list** (`listEmployments`, `listProgress`,
  `listExpiringCredentials`) requires the capability **somewhere**
  (`canAtAnyLocation`), then narrows the rows to the locations the actor can
  actually reach. A location manager gets a working page containing only their
  own people, rather than an error because other sites exist.

Four services shipped with the org-wide form and were caught by tests that
signed in as a location manager. If you add a per-person read, scope it.

## Two-person rule for separation

Ending employment is a record with a lifecycle, not a status flip:

```
draft -> pending_approval -> approved -> completed
              |                  |
              +------------------+-- cancelled (reversible until completed)
```

- Filing changes **nothing**: no status change, no access change.
- The approver must hold organization-wide `people.separate` **and** be a
  different person from the requester. Enforced in the service _and_ by a
  database `CHECK` constraint.
- A stated reason of at least 10 characters is mandatory.
- The interface additionally requires typing the employee's name to confirm.
- Only `completeSeparation` ends employment and revokes grants. Everything
  before that is cancellable.
- Nobody may file their own separation.

Nothing in EverCalm creates or advances a separation. Every transition takes a
named human actor, and both humans are recorded in the audit trail.

## Bulk actions reuse the single-action capability

Importing a spreadsheet of people requires `people.invite` — the same
capability as adding one person — and template authoring requires
`onboarding.manage`. Neither has a capability of its own.

That is deliberate. A separate `people.import` would let an organization grant
somebody the ability to create four hundred employments without the ability to
create one, which nobody means to do, and it would make the permission matrix
answer a question about a screen rather than about an action. Volume is bounded
by rate limits, which is the right control for volume; capability is the
control for _kind_.

## Communication capabilities, and what overrides a preference

Slice 3 added five capabilities to the four declared in Slice 1:

| Capability                       | Location-scopable | What it allows                                  |
| -------------------------------- | ----------------- | ----------------------------------------------- |
| `announcement.create`            | yes               | Draft, edit, preview an audience, duplicate     |
| `announcement.publish`           | yes               | Publish, schedule, cancel, revise, sync         |
| `announcement.publish_urgent`    | yes               | Use the urgent priority                         |
| `announcement.publish_emergency` | yes               | Use emergency, which overrides every preference |
| `announcement.view_receipts`     | yes               | See who read and confirmed                      |
| `announcement.send_reminder`     | yes               | Nudge the outstanding                           |
| `announcement.archive`           | yes               | Retire an announcement                          |
| `notification.administer`        | **no**            | Inspect the delivery queue, retry failures      |
| `event.manage`                   | yes               | Create and edit events                          |

**Organization-wide publishing is not a separate capability.** Asking for
`announcement.publish` with no location is already the stronger question, and a
location grant cannot satisfy it — so an org-wide publisher is simply somebody
holding the capability at org scope. Adding a second capability would have
meant two places to get it wrong.

**Audience preview is not a separate capability either.** It requires
`announcement.create`: you can only preview an audience you would be allowed to
target, and the same `assertRulesWithinScope` runs on both paths.

### The delivery policy

Two questions, answered separately, by `deliveryPolicy()` in
`src/modules/comms/delivery-policy.ts` — the only place the rule lives:

- **May it reach somebody who switched this category off?**
  (`overrides_preferences`)
- **May it arrive during their quiet hours?** (`overrides_quiet_hours`)

| Priority      | Ordinary category (General, Training, Schedule…)    | Safety, HR or Emergency category                    |
| ------------- | --------------------------------------------------- | --------------------------------------------------- |
| Normal        | respects both                                       | **cannot be muted**; waits for quiet hours to end   |
| Important     | respects both                                       | **cannot be muted**; waits for quiet hours to end   |
| Urgent        | respects both                                       | **cannot be muted, and arrives during quiet hours** |
| **Emergency** | **cannot be muted, and arrives during quiet hours** | **cannot be muted, and arrives during quiet hours** |

**Requiring acknowledgement changes neither answer.** Until the Slice 3 review
it overrode both, which meant "please confirm you have read the new rota
process" would buzz a phone at 3am. Needing a confirmation is a reason to keep a
message visible — it is pinned at the top of the inbox and on the home screen
until confirmed, and the author sees who is outstanding — not a reason to
interrupt somebody's night. Its notification is held until their quiet hours
end, like anything else.

Every override is reachable only through explicit authorization:

- **Urgent** requires `announcement.publish_urgent`.
- **Emergency** requires `announcement.publish_emergency`, has its own
  differently worded confirmation, and is audited as
  `announcement.emergency_published`.
- **Which categories cannot be muted** is an organization setting stored on
  the category row (`overrides_preferences`: Safety, HR and Emergency by
  default), never a per-message checkbox — a checkbox everybody ticks makes the
  preference meaningless.

So an author cannot wake people by ticking a box, and nobody can do it by
habit. Nothing is ever dropped: a held notification is delivered when the
window ends, and a muted one is still in the inbox and recorded as
`suppressed`.

The same policy applies to manual reminders and to the worker's automatic
"due soon" and "overdue" reminders. It is tested as a pure function
(`tests/unit/comms-behaviour.test.ts`) and through real publishes against a
person in quiet hours (`tests/integration/notifications.test.ts`, "who may be
interrupted").

### Reading somebody else's messages

`notification.administer` is for the delivery QUEUE — what is stuck, what
failed, what needs retrying. It does **not** grant reading a named employee's
in-app feed or inbox: both are self-access only. Debugging delivery is not a
reason to read somebody's messages. Preferences and quiet hours _are_ covered
by the capability, because changing them on request is a support action rather
than surveillance.

### Receipts narrow rather than refuse

Every communication read follows the list rule in the section above: ask
`canAtAnyLocation`, then narrow. A location manager gets their own slice of an
organization-wide report and the screen says `partialView` in words, rather
than an error because other locations exist. Four services shipped with the
org-wide form during Slice 3 and were caught by tests signing in as a General
Manager — the same family of bugs as Slice 2, so the rule is now applied
through one documented helper, `authorizeSomewhere`.

## Scheduling capabilities

All location-scopable. A General Manager or Scheduler granted at Riverside
manages Riverside and nothing at Downtown.

| Capability                  | Allows                                               | Owner | HR Admin | General Manager | Scheduler |
| --------------------------- | ---------------------------------------------------- | :---: | :------: | :-------------: | :-------: |
| `schedule.view_all`         | See the week board, shifts, templates                |  org  |    —     |    location     | location  |
| `schedule.draft`            | Add, edit, assign, cancel shifts; apply templates    |  org  |    —     |    location     | location  |
| `schedule.publish`          | Publish a week or its changes, which notifies people |  org  |    —     |    location     | location  |
| `schedule.manage_templates` | Create, edit, archive shift templates                |  org  |    —     |    location     | location  |
| `availability.view_team`    | Read the team's declared availability                |  org  |    —     |    location     | location  |
| `timeoff.decide`            | Approve or deny time off for people at the location  |  org  |   org    |    location     | location  |
| `openshift.manage`          | Offer open shifts and decide who gets them           |  org  |    —     |    location     | location  |
| `swap.decide`               | Approve or deny swaps both colleagues have agreed to |  org  |    —     |    location     | location  |

Employees, Shift Leads and Training Managers hold none of these. Their
scheduling is self-access, which needs no capability: seeing their own
published shifts, declaring availability, requesting and cancelling their own
time off, asking for an open shift at their own locations, asking a named
colleague to take or trade a shift, and answering a colleague's request.

Rules that hold regardless of role:

- **Outside scope is not found.** A Downtown manager asking for a Riverside
  shift gets 404, not 403. HR, who may decide time off but not build schedules,
  is told they lack permission for the week board and is sent to Requests.
- **Nobody decides their own request.** A manager who also works shifts asks
  like anyone else; their own time off, claim, or a swap they are part of must
  be decided by someone else.
- **Availability belongs to the person.** Managers read it; only the person can
  change it, so a conflict warning always reflects what they actually said.
- **A colleague agrees before a manager approves.** No swap reaches a manager,
  and no shift reaches anyone's schedule, without the receiving person saying
  yes.

## Enforcement

Every mutation is a server action whose first act is resolving the actor from
the **session** — never from client input — followed by `authorize()`. Hiding a
control in the interface is a courtesy; there is a browser test that navigates
directly to a hidden route and asserts the server still refuses.

## Test coverage

- Every role × every capability it does **not** hold is asserted refused
  (`tests/unit/can.test.ts`), so "every capability has a denial test" is
  mechanical rather than aspirational.
- Location scoping is proved against real seeded data in
  `tests/integration/location-scope.test.ts`.
