# EverCalm

Employee management and business operations for shift-based small and midsize
businesses.

> Every person knows what is happening, what is expected, what they have
> completed, and what comes next.

**Status: Slice 1 (Foundation) complete.** Authentication, multi-tenant
organizations and locations, the capability permission system, three-layer
tenant isolation, and the audit foundation are working end to end. Scheduling,
training, communication, and daily operations arrive in later slices and are
not built — nothing in the interface pretends otherwise.

## Quick start

```bash
npm install
npm run db:local        # real PostgreSQL under .pgdata/, no Docker needed
                        # leave running; then in another terminal:
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000>. Seeded accounts share the development password
`EverCalmDev!2026`:

| Email                    | Role                                 | Organization               |
| ------------------------ | ------------------------------------ | -------------------------- |
| `dana@harborvine.test`   | Owner                                | Harbor & Vine (restaurant) |
| `priya@harborvine.test`  | HR Administrator                     | Harbor & Vine              |
| `marcus@harborvine.test` | General Manager — **Riverside only** | Harbor & Vine              |
| `tess@harborvine.test`   | General Manager — **Downtown only**  | Harbor & Vine              |
| `jordan@harborvine.test` | Shift Lead — Riverside               | Harbor & Vine              |
| `sam@harborvine.test`    | Employee                             | Harbor & Vine              |
| `ana@lumensalon.test`    | Owner                                | Lumen Salon & Spa (salon)  |
| `kofi@lumensalon.test`   | General Manager — Pearl District     | Lumen Salon & Spa          |
| `riley@lumensalon.test`  | Employee                             | Lumen Salon & Spa          |

Sign in as Dana and then as Ana to see tenant isolation. Sign in as Marcus and
try `/app/settings/audit` to see server-side authorization.

## Commands

| Command                    | What it does                                   |
| -------------------------- | ---------------------------------------------- |
| `npm run dev`              | Development server                             |
| `npm run build`            | Production build                               |
| `npm run typecheck`        | `tsc --noEmit`                                 |
| `npm run lint`             | ESLint, including the isolation-boundary rules |
| `npm run test:unit`        | Unit tests                                     |
| `npm run test:integration` | Integration tests against real PostgreSQL      |
| `npm run test:e2e`         | Playwright, desktop and phone, with axe        |
| `npm run verify`           | typecheck → lint → all tests → build           |
| `npm run db:local`         | Local PostgreSQL with both roles               |
| `npm run db:migrate`       | Apply migrations as the privileged role        |
| `npm run db:seed`          | Seed both demo organizations                   |
| `npm run db:generate`      | Generate DDL from the Drizzle schema           |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 strict · PostgreSQL 17 ·
Drizzle with SQL migrations · Better Auth (argon2id) · Tailwind CSS 4 · Zod 4 ·
Vitest · Playwright + axe-core.

TypeScript is pinned to 6.0.3 because `typescript-eslint` peers cap at
`<6.1.0`; adopting TS 7 would mean losing type-aware linting, including the
rules that enforce the tenant-isolation boundary.

## Documentation

- [Architecture](docs/architecture.md) — modules, isolation, identity model
- [Permissions](docs/permissions.md) — capabilities, scoping, role presets
- [Design system](docs/design-system.md) — measured palette, type, accessibility
- [Database setup](docs/database-setup.md) — local and Neon, **including the
  two-role model that isolation depends on**
- [Implementation plan](docs/00-implementation-plan.md) — the approved plan

## Security posture

- Tenant isolation in three layers: PostgreSQL RLS, a tenant-scoped access
  layer, and composite tenant-aware foreign keys.
- The runtime database role is `NOSUPERUSER` / `NOBYPASSRLS`. Migrations run as
  a separate privileged role. The app asserts this at boot and `/api/health`
  returns `503` if it is not true.
- Cross-tenant access returns **404, never 403**.
- `audit_events` is append-only: `UPDATE` and `DELETE` are revoked from the
  runtime role.
- A generated test enumerates every tenant table and **fails CI if one lacks an
  RLS policy**, so a new table cannot quietly skip isolation.
- There is no support impersonation feature.

EverCalm organises HR workflows. It does not provide legal advice, and no
workflow here should be taken as a guarantee of compliance with any
jurisdiction's employment law.
