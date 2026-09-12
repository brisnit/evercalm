# Permissions

## Capabilities are code, not rows

Capability keys live in `src/server/authz/capabilities.ts` as typed constants.
A typo is a compile error, and the set can never drift from the code that
checks it. `role_capabilities` stores the string keys per organization.

45 capabilities are defined across seven groups. Capabilities whose feature
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
