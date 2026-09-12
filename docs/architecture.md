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

## The one sanctioned cross-tenant read

Listing which organizations a user belongs to must happen _before_ a tenant
context exists. Migration `0002` provides a `SECURITY DEFINER` function that
takes one user id and returns only that user's memberships. It has a pinned
`search_path` and cannot be used to enumerate a tenant's employees.

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
