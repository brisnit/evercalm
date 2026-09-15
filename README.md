# EverCalm

Employee management and business operations for shift-based small and midsize
businesses.

> Every person knows what is happening, what is expected, what they have
> completed, and what comes next.

**Status: Slices 1–5 approved. Slice 6 built and awaiting review.**

- **Slice 1 — Foundation.** Authentication, multi-tenant organizations and
  locations, capability permissions with location scope, three-layer tenant
  isolation, and append-only audit.
- **Slice 2 — People & onboarding.** Company setup, organizational structure,
  values and standards, secure invitations, the employee directory, employee
  profiles, professional credentials with expiry, and the full set of
  employment change workflows including a two-person separation rule.
  Onboarding checklists are authored in the browser and **versioned**: a
  published version is immutable, editing creates a new draft, and each
  assignment is pinned to the version the person was actually given. People can
  also be added in bulk from a spreadsheet, with a preview that writes nothing,
  per-row reasons for anything rejected, and invitations only when the
  administrator asks for them.

- **Slice 3 — Announcements & communication.** Announcement authoring with
  drafts, scheduling, expiry, archiving and auditable corrections; explicit
  audience targeting by location, department, job role, team, work position or
  named person, with a human-readable summary and a real count before anything
  is sent; a mobile-first employee inbox; separate read and acknowledgement
  tracking, where **opening is never confirming**; receipt reporting scoped to
  the locations a manager is responsible for; reminders; an internal
  notification queue with per-person preferences, quiet hours and idempotent
  delivery; and a small event record that announcements can point at.
- **Slice 4 — Scheduling & shift management.** Shift templates, a week board
  per location with staffing totals and conflict detection, publication that
  notifies only the people whose shifts changed, availability, time off with
  approval, open shifts and claims, and colleague-agreed swaps with manager
  approval. Location-scoped permissions, location-timezone times, audit history,
  and restaurant and salon demo schedules.
- **Slice 5 — Training.** Course authoring with reading, checklist,
  knowledge-check and practical lessons; an employee-view preview; **versioned
  publication**, where a published version can never change and every
  assignment keeps the version it was given; assignment to people or a job role
  at a location with due dates; a phone-first training player that always says
  what is done, what is next and how far there is to go; server-scored
  knowledge checks with attempt limits; manager practical sign-off that nobody
  can give themselves; and progress reporting scoped to the locations a manager
  looks after. Onboarding checklists link to published courses: starting
  onboarding assigns the course pinned to a version, and the checklist step
  completes when the course does. Quiet moments of progress, no points, badges
  or leaderboards.

- **Slice 6 — Shift operations.** Versioned operational templates for
  pre-shift, opening, side work, station setup, shift duties, closing and
  handoffs, targeted by location, job role and station, with timing relative
  to the shift, required and optional tasks, shared tasks and manager
  verification. Publishing a schedule gives each shift its work exactly once;
  swaps, claims, reassignment, time changes and cancellations move or retire
  open work without rewriting finished work. A phone-first shift workspace for
  employees, an operational board that puts what needs a manager first, and
  location handoffs with acknowledgement and resolution. Restaurant and salon
  demo days.

Two-way messaging is
deliberately absent: the architecture supports it, and no half-built chat is
exposed.

## Quick start

```bash
npm install
npm run db:local        # real PostgreSQL under .pgdata/, no Docker needed
                        # leave running; then in another terminal:
npm run db:migrate
npm run db:seed
npm run dev             # web server + background worker
```

Open <http://localhost:3000>. Seeded accounts share the development password
`EverCalmDev!2026`:

| Email                    | Role                                 | Organization               |
| ------------------------ | ------------------------------------ | -------------------------- |
| `dana@harborvine.test`   | Owner                                | Harbor & Vine (restaurant) |
| `priya@harborvine.test`  | HR Administrator                     | Harbor & Vine              |
| `marcus@harborvine.test` | General Manager — **Riverside only** | Harbor & Vine              |
| `tess@harborvine.test`   | General Manager — **Downtown only**  | Harbor & Vine              |
| `omar@harborvine.test`   | Scheduler — **Riverside only**       | Harbor & Vine              |
| `jordan@harborvine.test` | Shift Lead — Riverside               | Harbor & Vine              |
| `sam@harborvine.test`    | Employee                             | Harbor & Vine              |
| `ana@lumensalon.test`    | Owner                                | Lumen Salon & Spa (salon)  |
| `kofi@lumensalon.test`   | General Manager — Pearl District     | Lumen Salon & Spa          |
| `yuki@lumensalon.test`   | Training Manager                     | Lumen Salon & Spa          |
| `elodie@lumensalon.test` | Employee — new stylist, in training  | Lumen Salon & Spa          |
| `riley@lumensalon.test`  | Employee                             | Lumen Salon & Spa          |

Sign in as Dana and then as Ana to see tenant isolation. Sign in as Marcus and
try `/app/settings/audit` to see server-side authorization.

## Commands

| Command                    | What it does                                   |
| -------------------------- | ---------------------------------------------- |
| `npm run dev`              | Development server and background worker       |
| `npm run dev:web`          | Development server only                        |
| `npm run worker`           | Background worker alone (Ctrl+C to stop)       |
| `npm run worker:once`      | One worker tick, then exit                     |
| `npm run worker:status`    | Is the worker running; when did it last tick   |
| `npm run worker:stop`      | Stop the running worker gracefully             |
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
- Announcement bodies are never HTML. They are stored as text, parsed into a
  typed tree, and rendered as React elements, so there is no
  `dangerouslySetInnerHTML` in any communication surface and injection is
  impossible by construction rather than filtered.
- Delivery records carry a title, a short preview and a pointer — never message
  content, and never anything about a person beyond their employment id.
- No external email is sent. The provider is development-safe and the real one
  still refuses to start without an approved sending domain.
- Uploaded spreadsheets are treated as hostile input: the tenant is always taken
  from the session and never from the file, confirmation re-validates from the
  raw bytes rather than trusting the preview, and any cell we export that begins
  `=`, `+`, `-` or `@` is neutralised so our own error report cannot become a
  spreadsheet formula attack.

### Known advisories

`npm audit` reports 4 moderate advisories, all one chain: `esbuild` →
`@esbuild-kit/*` → `drizzle-kit`, reaching us as a dependency of `better-auth`.
The vulnerability is in **esbuild's development server**, which lets any website
read responses from it. Nothing in this chain runs in production — `drizzle-kit`
is a schema CLI and esbuild's serve mode is never started — so the advisories do
not affect a deployed EverCalm. There is no non-breaking fix: `npm audit fix
--force` changes the `better-auth` major version. Re-check when `better-auth`
updates its own dependency.

EverCalm organises HR workflows. It does not provide legal advice, and no
workflow here should be taken as a guarantee of compliance with any
jurisdiction's employment law.
