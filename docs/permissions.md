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
