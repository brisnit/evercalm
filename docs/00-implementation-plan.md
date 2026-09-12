# EverCalm — Discovery & Implementation Plan

**Status:** Awaiting approval. No implementation code has been written.
**Date:** 2026-09-12
**Author:** Technical lead (Claude)

> _"Every person knows what is happening, what is expected, what they have completed, and what comes next."_

---

## 1. Repository assessment

### What exists

| Path                                                    | Contents                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Brand Assets/ECL.png`                                  | Primary logo, 695×346, RGBA with real transparency. Wordmark: italic high-contrast serif "Ever" + heavy geometric sans "Calm." + hands/sun mark in a violet→pink gradient. |
| `Brand Assets/Screenshot 2026-09-12 at 12.32.35 AM.png` | Palette board, 1160×264: four swatches on a `#1E1E1E` ground.                                                                                                              |

Nothing else. **No** `package.json`, lockfile, `tsconfig`, `CLAUDE.md`, `README`, `.env.example`, CI config, or `.git` directory. This is a clean greenfield project, so the recommended architecture in the brief can be adopted without compromise.

### Exact brand values (sampled from the source pixels, not eyeballed)

| Token          | Hex                           | Role                            |
| -------------- | ----------------------------- | ------------------------------- |
| Ink            | `#040404`                     | Primary type, dark surfaces     |
| Violet         | `#7C24F5`                     | Primary action                  |
| Pink / Magenta | `#EA33A9`                     | Secondary accent                |
| Charcoal       | `#1E1E1E`                     | Dark section ground             |
| Mark gradient  | `#7C24F5 → #AC23D7 → #EA33A9` | Logo mark, sparingly in product |

### Local toolchain

| Tool                | Status                                                 |
| ------------------- | ------------------------------------------------------ |
| Node                | v24.16.0 ✅                                            |
| npm                 | 11.13.0 ✅                                             |
| pnpm / bun          | **Not installed**                                      |
| PostgreSQL (`psql`) | **Not installed**                                      |
| Docker              | **Not installed**                                      |
| git                 | Repo not initialised; no global `user.name` configured |

**Consequence:** we have no local database and no container runtime. Section 3 proposes how to resolve this; it needs your decision before Slice 1 can run migrations.

### Issues to fix early

1. `Screenshot 2026-09-12 at 12.32.35 AM.png` contains a **U+202F narrow no-break space**. This breaks naive shell globbing and some build tools. Recommend renaming assets to kebab-case (`brand-palette.png`).
2. **We have no vector logo.** A 695px PNG will look soft on retina and cannot be recoloured for dark surfaces. Requesting an SVG or AI/Figma source is the cheapest fix; otherwise I will rebuild the mark as hand-authored SVG and treat the wordmark as a fixed raster until vector arrives.
3. Git is not initialised. I will not run `git init`, commit, or push without your say-so.

---

## 2. Recommended MVP boundary

Your 16 MVP capabilities are the right target. My recommendation is to **keep all 16 and be aggressive about what sits outside them**, because the value of EverCalm is the _connection_ between subsystems — a scheduling-only or training-only v1 proves nothing the market hasn't already seen.

### In scope for Pilot v1

Organisations & locations · employment records · capability-based permissions with per-location scoping · invitations & onboarding · announcements with required acknowledgement · availability · schedule build/publish · open shifts · shift swaps · minimal time-off requests · course builder · learning paths · training player · quizzes · progress tracking · manager practical sign-off · checklist templates (pre-shift + side work) · checklist runs with exceptions and evidence · shift handoffs · five core reports · append-only audit log · two fully seeded tenants in different industries.

### Explicitly out of scope for v1 — and why

| Deferred                                                   | Rationale                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payroll, time clock, wage calculation, benefits            | Regulated, integration-heavy, and a different buyer conversation. Punching in is not EverCalm's promise.                                                                                                                                           |
| Applicant tracking                                         | Pre-hire; the loop starts at "invite the person you already hired."                                                                                                                                                                                |
| **Two-way messaging (DMs, group chat)**                    | The single largest surface in the brief. v1 ships announcements + acknowledgement receipts, which covers the actual pilot need ("did everyone see the note?"). Real-time chat is Phase 2. Ships as one-way so we do not half-build a chat product. |
| Document storage, e-signature, policy versioning           | Needs object storage, retention rules, and legal review. Phase 2. `announcement_receipts` covers v1 acknowledgement.                                                                                                                               |
| Incidents, coaching records, corrective action             | Highest-sensitivity data in the product. Deserves its own permission review, not a rushed slice. Phase 2.                                                                                                                                          |
| Certifications with expiry & recertification               | Phase 2. v1 bridges this with `skill_signoffs.expires_at` so the data is not lost.                                                                                                                                                                 |
| Stripe billing                                             | Phase 2. Pilots are not paying yet.                                                                                                                                                                                                                |
| **Support impersonation**                                  | Deliberately **absent in v1**. The safest impersonation is none. Phase 2 ships it with mandatory reason, time limit, owner notification, and full audit.                                                                                           |
| i18n / translation, AI features, native apps, integrations | Phase 3, per the brief.                                                                                                                                                                                                                            |

### Time-off: a deliberate exception

Time off is listed as Phase 2 work in the brief, but **scheduling conflict detection is dishonest without it** — a schedule that assigns someone who is on approved vacation destroys trust in the first week. v1 therefore includes a minimal request → approve/deny → blocks-assignment flow. No accrual balances, no PTO policy engine, no carry-over.

### Marketing site: recommended staging

The brief lists ~22 marketing pages. Building those before the product exists means shipping fabricated screenshots, which contradicts "no UI-only mock functionality."

**Recommendation:** ship a real 4-page site in Slice 1 (Home, Pricing, Contact/Demo, Security) so the domain is live and pilots can be booked, then build the full site after Slice 4 using genuine product screenshots. Presented as a decision in §11.

---

## 3. Proposed architecture

### Stack

| Layer                  | Choice                                                        | Version verified 2026-09-12 |
| ---------------------- | ------------------------------------------------------------- | --------------------------- |
| Framework              | Next.js, App Router                                           | 16.3.5                      |
| UI runtime             | React                                                         | 19.3.0                      |
| Language               | TypeScript, `strict` + `noUncheckedIndexedAccess`             | **6.0.3** (see note)        |
| Database               | PostgreSQL 17                                                 | —                           |
| ORM                    | **Drizzle** + drizzle-kit                                     | 0.45.2 / 0.31.10            |
| Auth                   | **Better Auth**                                               | 1.7.4                       |
| Styling                | Tailwind CSS                                                  | 4.3.3                       |
| Components             | Radix primitives, shadcn-style, re-skinned to EverCalm tokens | —                           |
| Validation             | Zod                                                           | 4.6.2                       |
| Jobs                   | pg-boss (Postgres-backed)                                     | 12.31.0                     |
| Email                  | Resend + React Email                                          | 6.28.0                      |
| Object storage         | Cloudflare R2 (S3 API), presigned uploads                     | Slice 6                     |
| Unit/integration tests | Vitest                                                        | 5.0.0                       |
| E2E                    | Playwright + `@axe-core/playwright`                           | 1.63.0 / 4.13.0             |
| Logging                | pino, with redaction paths                                    | —                           |
| Errors                 | Sentry                                                        | 10.74.0                     |
| Analytics              | PostHog, documented event schema                              | 1.430.2                     |

### Three deviations from the brief, with reasoning

**1. Drizzle instead of Prisma.**
The brief allows either. Drizzle wins here for one decisive reason: **migrations are plain SQL files**, so Row-Level Security policies, `CHECK` constraints, partial indexes, and composite foreign keys live in version control alongside the schema. Prisma cannot express RLS in its schema language, which would force a parallel hand-managed migration track for the single most important security control in a multi-tenant HR product. Drizzle's SQL-first query builder is also a better fit for the scheduling conflict queries, which are genuinely relational. Cost: relation ergonomics are slightly more verbose than Prisma's. Worth it.

**2. Better Auth instead of Auth.js v5.**
Auth.js v5 has been `5.0.0-beta.32` for an extended period; betting the authentication layer of an HR product on a perpetual beta is poor risk management. Better Auth 1.7.4 is stable, TypeScript-native, has a first-class Drizzle adapter, and ships session management, email OTP, password reset, and 2FA.
**Important scoping decision:** we use Better Auth for **identity and sessions only** — users, credentials, sessions, verification tokens. We own organisations, employments, roles, and permissions in our own tables. Better Auth's organization plugin is deliberately _not_ used, because our model (a person holding different roles at different locations) is richer than its member model and fighting it would cost more than owning it. This also keeps the auth provider swappable behind a thin interface.

**3. TypeScript 6.0.3, not 7.0.2.**
TypeScript 7 (the native compiler) is the current `latest`, but `typescript-eslint@8.70.0` declares a peer range of `>=4.8.4 <6.1.0`. Adopting TS 7 today means **losing type-aware linting** — including the rules that will enforce our tenant-isolation boundary. TS 6.0.3 is stable and inside the supported range. Revisit when typescript-eslint ships TS 7 support.

### Login strategy

Employees are hourly shift workers opening this on a phone mid-shift. Emailing a magic link on _every_ login is real friction and often impossible on a restaurant floor.

- **Invitation acceptance:** single-use tokenised link (email or SMS-ready).
- **Ongoing login:** email + password (argon2id via `@node-rs/argon2`), with email OTP as the recovery path.
- **Session:** httpOnly, Secure, SameSite=Lax cookie; rotated on privilege change; idle + absolute expiry.
- Phone-number login and SSO: Phase 2/3.

### Application shape — modular monolith, single deploy

```
src/
  app/
    (marketing)/            # public, statically generated
    (auth)/                 # sign in, invite acceptance, recovery
    (app)/app/...           # company administration
    (me)/my/...             # employee, mobile-first
    (platform)/platform/... # EverCalm internal console (Phase 2)
    api/                    # webhooks, health, exports only
  modules/
    identity/  org/  people/  comms/  scheduling/  learning/
    operations/  reporting/  audit/  platform/
      schema.ts        # Drizzle tables for this module
      policy.ts        # capabilities this module defines
      service.ts       # business logic — the ONLY place that touches the db
      validators.ts    # Zod schemas
      actions.ts       # server actions, each opening with authorize()
      queries.ts       # read models for RSC
  server/
    db/            # tenant-scoped db handle; raw client is lint-banned elsewhere
    auth/          # Better Auth config + session → actor resolution
    authz/         # capability registry, can(), authorize()
    audit/         # append-only event writer
    jobs/          # pg-boss workers
  ui/              # design system: tokens, primitives, patterns
  lib/             # env (Zod-validated), dates/timezones, ids, errors
```

Marketing, admin, employee, and console are **route groups in one Next.js app**, not separate deployments. They share the design system and one auth session, marketing pages are statically generated so public traffic costs nothing, and there is a single CI pipeline. Splitting them would buy isolation we do not need at pilot scale.

**No microservices.** Module boundaries are enforced by lint rules (`no-restricted-imports` — modules talk through exported services, never by reaching into each other's `schema.ts`), which gives us the option to extract later without paying distributed-systems cost now.

### Where authorization lives

Every mutation is a **server action whose first statement is `authorize()`**. There is no code path where a mutation reaches the service layer without an actor and a capability check. Read models resolve through the same tenant-scoped db handle. The UI calls the _same_ `can()` to hide and disable controls — hiding is a courtesy, `authorize()` is the gate.

---

## 4. Proposed route map

### Public — `(marketing)`

`/` · `/product` · `/product/training` · `/product/scheduling` · `/product/hr-onboarding` · `/product/operations` · `/product/communication` · `/product/insights` · `/solutions` · `/solutions/restaurants` · `/solutions/retail` · `/solutions/salon-fitness` · `/solutions/hospitality` · `/solutions/field-service` · `/pricing` · `/resources` · `/resources/[slug]` · `/about` · `/contact` · `/demo` · `/security` · `/privacy` · `/terms`

### Auth — `(auth)`

`/signin` · `/forgot-password` · `/reset-password` · `/verify-email` · `/invite/[token]` · `/start` (self-serve workspace creation)

### Company administration — `(app)` at `/app`

| Route                                                                                                          | Purpose                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/app`                                                                                                         | Role-aware dashboard: what needs attention, what is due, what is at risk                                                                     |
| `/app/setup`                                                                                                   | Setup wizard — industry, locations, structure, templates, invitations                                                                        |
| `/app/people` · `/invite` · `/import` · `/[employmentId]`                                                      | Directory; detail tabs: profile, roles & access, schedule, training, checklists, history                                                     |
| `/app/announcements` · `/new` · `/[id]`                                                                        | Compose, target audiences, receipt & acknowledgement tracking                                                                                |
| `/app/schedule` · `/[weekOf]` · `/templates` · `/open-shifts` · `/requests` · `/availability` · `/events`      | Week grid, publishing, swap & time-off approvals, large-party events                                                                         |
| `/app/training` · `/courses` · `/courses/[id]/edit` · `/paths` · `/assignments` · `/verifications` · `/skills` | Authoring, assignment, practical sign-off queue                                                                                              |
| `/app/operations` · `/checklists` · `/checklists/[id]/edit` · `/runs` · `/runs/[id]` · `/log`                  | Checklist templates, live runs, verification, manager log & handoffs                                                                         |
| `/app/reports`                                                                                                 | Role readiness · training completion · schedule coverage · checklist completion · onboarding funnel                                          |
| `/app/settings`                                                                                                | Organisation · locations · departments & teams · job roles · stations · roles & permissions · notifications · industry templates · audit log |

### Employee — `(me)` at `/my`, mobile-first

`/my` (home) · `/my/shifts` · `/my/shifts/[id]` · `/my/availability` · `/my/time-off` · `/my/open-shifts` · `/my/swaps` · `/my/training` · `/my/training/[assignmentId]` (player) · `/my/skills` · `/my/inbox` · `/my/inbox/[id]` · `/my/tasks` (today's checklist runs) · `/my/tasks/[runId]` · `/my/onboarding` · `/my/profile`

`/my` is **not** a narrowed `/app`. It is a separate information architecture built around one question: _what do I do next?_

### Platform console — `(platform)` at `/platform` (Phase 2)

`/platform/tenants` · `/platform/tenants/[id]` · `/platform/support-sessions` · `/platform/flags` · `/platform/jobs` · `/platform/audit`. Separate authentication requirement and an explicit staff allowlist; not reachable with a customer session.

### A person who is both a manager and an employee

Holds access to both `/app` and `/my`, with a persistent switcher. A GM checking their own schedule uses `/my` like everyone else. Employees without any administrative capability are redirected away from `/app` server-side.

---

## 5. Proposed data model

### Conventions applied to every table

- **UUIDv7 primary keys** — time-ordered, so they index well and do not leak sequential counts.
- **`organization_id` on every tenant table**, denormalised onto child tables even where a parent already carries it. This is not redundancy; it is what makes RLS a single uniform policy and what makes the composite foreign keys below possible.
- **Composite foreign keys `(organization_id, id)`** on cross-table references, so a child row is _structurally incapable_ of pointing at another tenant's parent. Postgres rejects it before any application code runs.
- `timestamptz` everywhere. Per-location timezone. **`business_date` is a `date` column** computed in the location's timezone — a restaurant's "Tuesday" ends at 2am Wednesday, and this is the single most common source of scheduling bugs.
- `created_at` / `updated_at` on all tables; `archived_at` soft-delete only where history matters.

### Material changes from the entity list in the brief

| Brief                                      | Proposed                                                                                               | Why                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User` used as the person everywhere       | **`users` (global identity) + `employments` (tenant-scoped person)**                                   | A person may work for two EverCalm customers with the same email. Every org-scoped row references `employment_id`, never `user_id`. This is the backbone of tenant isolation.                                                                                                                                  |
| `Permission`, `RolePermission`, `UserRole` | `roles`, `role_capabilities`, **`role_grants`**                                                        | Capabilities are **code constants**, not rows — they cannot drift from the code that checks them, and a typo is a compile error. `role_grants` adds `scope` (`org` \| `location`), which the brief requires ("different responsibilities at different locations") but the original entity list cannot express. |
| `Task`                                     | Folded into `checklist_items` / `checklist_runs`                                                       | A standalone task table in v1 would duplicate checklists without a distinct use case. Extract later if ad-hoc tasks prove necessary.                                                                                                                                                                           |
| `Policy`, `Acknowledgement`                | v1 uses `announcement_receipts`; `policies` is Phase 2                                                 | Policy needs versioning and re-acknowledgement on change — a real feature, not a rename.                                                                                                                                                                                                                       |
| `Certification`                            | v1 bridges via `skill_signoffs.expires_at`; full model Phase 2                                         | Keeps expiry data from being lost without building renewal workflows yet.                                                                                                                                                                                                                                      |
| —                                          | **Added:** `xp_events`, `handoffs`, `events`, `industry_templates`, `open_shift_claims`, `shift_notes` | Required by workflows in the brief that had no corresponding entity.                                                                                                                                                                                                                                           |

### v1 tables by module

**Identity & tenancy**
`users` (global: email citext unique, name, password_hash, email_verified_at, locale) · `sessions`, `accounts`, `verifications` (Better Auth) · `organizations` (name, slug, industry, timezone, status) · `locations` (organization_id, name, timezone, address, status) · `employments` (**the tenant-scoped person**: organization_id, user_id, employee_number, status `invited|active|suspended|separated`, hired_on, separated_on, home_location_id, display_name, phone, pronouns, emergency contact — _sensitive fields flagged at the column level_) · `employment_locations` · `invitations` (token_hash, intended roles/locations/job roles, expires_at, accepted_at, revoked_at)

**Organisational structure**
`departments` · `teams` · `job_roles` (Server, Host, Stylist…) · `stations` (Bar, Host Stand, Chair 3…) · `employment_job_roles` (with `is_primary`)

**Permissions**
`roles` (org-owned or system preset) · `role_capabilities` · `role_grants` (employment_id, role_id, scope, location_id)

**Audit**
`audit_events` (organization_id, actor_employment_id, actor_type `user|system|support`, action, subject_type, subject_id, location_id, summary, metadata jsonb, ip, user_agent, created_at). **Append-only enforced at the database role level** — `UPDATE` and `DELETE` are revoked from the application role, so a compromised app cannot rewrite history.

**Communication (Slice 3)**
`announcements` (author, title, body, priority `normal|important|urgent`, requires_acknowledgement, publish_at, expires_at, status) · `announcement_audiences` (type `org|location|job_role|team|employment`, target_id) · `announcement_receipts` (materialised at publish: delivered_at, read_at, acknowledged_at) · `notifications` · `notification_preferences` (channel, category, quiet hours)

**Scheduling (Slice 4)**
`schedules` (location, week_start, status `draft|published`) · `shift_templates` · `shifts` (location, job_role, station, starts_at, ends_at, break_minutes, notes, status, is_open) · `shift_assignments` · `availability_rules` (recurring, with `preference: available|preferred|unavailable`) · `availability_exceptions` · `time_off_requests` · `shift_swap_requests` (`swap|giveaway`, claimant, approval state) · `open_shift_claims` · `events` (large parties, private events) · `shift_notes`

Conflict detection is a **pure service, not a table** — `detectConflicts(shift, employment)` returns typed `ScheduleConflict[]` with severity `block | warn`, covering: overlapping assignment · declared unavailability · approved time off · missing required job role · missing required skill sign-off · weekly hour ceiling · minimum rest between shifts. Pure functions mean it is exhaustively unit-testable without a database.

**Learning (Slice 5)**
`courses` (versioned, draft/published/archived) · `modules` · `lessons` (content_type `text|video|image|document|checklist|reflection`, content jsonb) · `assessments` · `assessment_questions` (`single|multi|true_false|scenario`) · `assessment_options` · `learning_paths` · `learning_path_items` (with unlock rules) · `skills` · `course_skills` · `assignments` (polymorphic over course/path; source `manual|role_rule|onboarding`; due_at, required, status) · `lesson_progress` · `assessment_attempts` · `assessment_responses` · `skill_signoffs` (verifier, method `observation|demonstration`, evidence, status `requested|verified|rejected|revoked`, expires_at)

**Gamification that cannot be farmed**
`xp_events` (employment_id, source_type, source_id, points, **`idempotency_key` UNIQUE**). XP is awarded _only_ on: first completion of a lesson that also met a minimum dwell threshold, first _passing_ assessment attempt, a manager skill sign-off, and a verified checklist run. Because every award carries a unique idempotency key derived from its source, replaying a lesson or retaking a passed quiz awards nothing. Level is a pure function of total XP from a published table. Role-readiness percentage is **computed, never stored**, so it cannot drift.

**Shift operations (Slice 6)**
`checklist_templates` (kind `pre_shift|side_work|opening|closing|inspection|handoff`; scope by location / job role / station) · `checklist_sections` · `checklist_items` (response_type `check|text|number|photo|select`, required, requires_evidence, requires_manager_verification) · `checklist_runs` (**stores `template_version`** so editing a template never rewrites history; business_date, status `pending|in_progress|submitted|verified|exception|missed`) · `checklist_responses` (status `done|skipped|blocked|na`, note, evidence_url) · `handoffs` (unresolved work passed to the next shift; doubles as manager log)

**Templates**
`industry_templates` (platform-level, versioned jsonb). Applying a template **copies** rows into the tenant — it never references the template live — so a customer can edit anything without breaking on template updates, and restaurant vocabulary can never leak into a salon's data.

---

## 6. Role and permission matrix

### How permissions actually work

Capabilities are **string constants declared in code**, grouped by namespace. Roles are presets that grant sets of capabilities. Grants are **scoped**:

```ts
can(actor, 'schedule.publish', { locationId })
```

passes if the actor holds an **org-scoped** grant carrying that capability, _or_ a **location-scoped** grant for that specific location. This is what lets someone be General Manager at Riverside and a Server at Downtown.

**Self-access is ownership, not capability.** An employee does not need `availability.manage` to edit their own availability — every self-scoped action checks `isSelf(actor, employmentId)`. This keeps the Employee preset genuinely near-empty, which is the correct default.

**Cross-tenant access returns 404, never 403.** A 403 confirms the record exists. That is an information leak.

### Capability matrix (v1)

Legend: ● full · ◐ own/team scope only · ○ none

| Capability                                                                                                                | Owner | HR Admin |  GM*  | Scheduler* | Training Mgr | Employee |
| ------------------------------------------------------------------------------------------------------------------------- | :---: | :------: | :---: | :--------: | :----------: | :------: |
| `org.view` / `org.update`                                                                                                 |   ●   |    ◐     |   ○   |     ○      |      ○       |    ○     |
| `org.manage_locations` / `manage_structure`                                                                               |   ●   |    ○     |   ○   |     ○      |      ○       |    ○     |
| **`org.manage_roles`** (grant permissions)                                                                                |   ●   |    ○     |   ○   |     ○      |      ○       |    ○     |
| `org.view_audit`                                                                                                          |   ●   |    ●     |   ○   |     ○      |      ○       |    ○     |
| `people.view`                                                                                                             |   ●   |    ●     |   ●   |     ●      |      ●       |    ○     |
| **`people.view_sensitive`** (emergency contact, DOB, docs)                                                                |   ●   |    ●     | **○** |     ○      |      ○       |    ○     |
| `people.invite` / `people.update`                                                                                         |   ●   |    ●     |   ●   |     ○      |      ○       |    ○     |
| `people.manage_employment`                                                                                                |   ●   |    ●     |   ◐   |     ○      |      ○       |    ○     |
| **`people.separate`** (offboarding)                                                                                       |   ●   |    ●     |   ○   |     ○      |      ○       |    ○     |
| `people.export`                                                                                                           |   ●   |    ●     |   ○   |     ○      |      ○       |    ○     |
| `announcement.create` / `.publish`                                                                                        |   ●   |    ●     |   ●   |     ○      |      ●       |    ○     |
| `announcement.publish_urgent`                                                                                             |   ●   |    ●     |   ●   |     ○      |      ○       |    ○     |
| `announcement.view_receipts`                                                                                              |   ●   |    ●     |   ●   |     ○      |      ◐       |    ○     |
| `schedule.view_all`                                                                                                       |   ●   |    ●     |   ●   |     ●      |      ○       |    ○     |
| `schedule.draft` / `.assign` / `.manage_templates`                                                                        |   ●   |    ○     |   ●   |     ●      |      ○       |    ○     |
| **`schedule.publish`**                                                                                                    |   ●   |    ○     |   ●   |     ●      |      ○       |    ○     |
| `availability.view_team` / `.override`                                                                                    |   ●   |    ○     |   ●   |     ●      |      ○       |    ○     |
| `timeoff.decide`                                                                                                          |   ●   |    ●     |   ●   |     ●      |      ○       |    ○     |
| `swap.decide` / `openshift.post` / `openshift.decide`                                                                     |   ●   |    ○     |   ●   |     ●      |      ○       |    ○     |
| `training.author` / `.publish`                                                                                            |   ●   |    ○     |   ○   |     ○      |      ●       |    ○     |
| `training.assign` / `.waive`                                                                                              |   ●   |    ●     |   ●   |     ○      |      ●       |    ○     |
| `training.view_progress_team`                                                                                             |   ●   |    ●     |   ●   |     ○      |      ●       |    ○     |
| `training.view_progress_org`                                                                                              |   ●   |    ●     |   ○   |     ○      |      ●       |    ○     |
| `skill.define` / `skill.revoke`                                                                                           |   ●   |    ○     |   ○   |     ○      |      ●       |    ○     |
| **`skill.verify`** (practical sign-off)                                                                                   |   ●   |    ○     |   ●   |     ○      |      ●       |    ○     |
| `checklist.author` / `.publish`                                                                                           |   ●   |    ○     |   ◐   |     ○      |      ○       |    ○     |
| `checklist.view_runs` / **`.verify`** / `.reopen`                                                                         |   ●   |    ○     |   ●   |     ○      |      ○       |    ○     |
| `handoff.create` / `.resolve`                                                                                             |   ●   |    ○     |   ●   |     ○      |      ○       |    ○     |
| `report.operations` / `report.training`                                                                                   |   ●   |    ◐     |   ◐   |     ○      |      ◐       |    ○     |
| `report.people`                                                                                                           |   ●   |    ●     |   ○   |     ○      |      ○       |    ○     |
| `billing.manage` _(Phase 2)_                                                                                              |   ●   |    ○     |   ○   |     ○      |      ○       |    ○     |
| **Self actions** (own availability, training, swaps, checklists, profile, time-off requests, skill verification requests) |   ●   |    ●     |   ●   |     ●      |      ●       |    ●     |

\* GM and Scheduler grants are **location-scoped by default**. An owner may grant either org-wide.

### Human control over employment decisions — enforced, not aspirational

1. **`people.separate` requires a two-person rule.** The actor must hold the capability _and_ a second, distinct approver holding org-scoped `people.separate` must confirm. Recorded as two audit events with two named humans.
2. **No automated adverse action exists in the codebase.** The system surfaces overdue training and missed checklists; it never suspends, disciplines, or flags a person for termination. There is no code path that changes employment status without a named human actor.
3. **`org.manage_roles` is Owner-only.** Nobody can quietly widen their own access.
4. Every sensitive action writes an append-only audit event before the transaction commits.

### One addition I recommend

A seventh preset: **Shift Lead** — Employee, plus `checklist.verify`, `handoff.create`, and `announcement.view_receipts` at their location. Nearly every pilot restaurant has a keyholder who is not a manager, and without this they will hand out the GM role, which grants far too much. Small to build, large in real-world safety.

---

## 7. Vertical slice implementation plan

Every slice ships the full stack — schema, migration, seed, isolation, authorization, validation, UI, responsive behaviour, empty/loading/error states, audit events, tests, docs. **A slice is not done because the page renders.**

### Slice 1 — Foundation · L (8–10 focused days)

Project scaffold · design tokens from the brand palette · shared component library · CI · Zod-validated env · Better Auth (password + email OTP recovery) · organisations · locations · **tenant isolation (RLS + tenant db handle + composite FKs)** · capability engine · audit foundation · minimal 4-page marketing site · two seeded organisations.
**Demoable:** sign in as the owner of each of two orgs, switch location, hit a permission-denied page, read a real audit log, and watch the cross-tenant isolation suite pass.

### Slice 2 — People & onboarding · M (5–7 days)

Invitations (send, accept, expire, revoke) · employee profiles with sensitive-field gating · employment records · job roles & stations · role grants UI · location assignment · CSV import with a validation preview · company setup wizard · onboarding status computation.

### Slice 3 — Communication · M (4–5 days)

Announcement composer · audience targeting (org/location/job role/team/person) · employee inbox · read receipts · required acknowledgement · notification preferences with quiet hours · email delivery via pg-boss + Resend.

### Slice 4 — Scheduling · XL (10–12 days)

Availability (recurring + exceptions) · minimal time off · shift templates · week grid with drag assignment · **conflict detection** · draft → publish with change notifications · open shifts & claims · shift swaps end-to-end with manager approval · employee schedule views · calendar export (`.ics`).

### Slice 5 — Learning · XL (12–14 days)

Course builder (modules, lessons, mixed content) · learning paths with prerequisites · assignment rules (role, location, individual, onboarding) · mobile training player with resume · assessments and scoring · attempt limits · progress tracking · skill definitions · **manager practical verification queue** · XP with idempotent awards · role-readiness computation.

### Slice 6 — Shift operations · L (7–9 days)

Checklist template builder (pre-shift, side work, opening, closing) scoped by role/station/location · run generation from published shifts · mobile run experience · exceptions and blocked items · **evidence uploads (R2, presigned, validated)** · handoffs to the next shift · manager verification · shift closure.

### Slice 7 — Administration & launch readiness · L (7–9 days)

Five core reports · full marketing site with real screenshots · read-only platform tenant directory · audit review UI · accessibility audit and fixes · security review · performance budgets · backup/restore runbook · pilot data setup.

**Total: ≈ 55–70 focused engineering days.** Slices 4 and 5 carry the most risk and should not be compressed.

---

## 8. Testing strategy

### Unit — Vitest, no database

The permission engine (every capability × every role × every scope) · schedule conflict detection · assessment scoring · XP idempotency · **business-date arithmetic across timezones and DST boundaries** · audience resolution.

### Integration — Vitest against real PostgreSQL

Not a mock. Each server action is exercised as **three actors**:

1. A permitted actor → succeeds.
2. An unprivileged actor in the _same_ tenant → denied.
3. An actor in a _different_ tenant → **404, not 403**.

A shared `expectTenantIsolation()` helper makes case 3 one line per action, so there is no excuse to skip it.

### The isolation test that cannot be forgotten

A generated suite **reflects over the Drizzle schema at test time**, enumerates every table carrying `organization_id`, and asserts that querying it as the application role with a mismatched `app.organization_id` returns zero rows. Adding a new tenant table without an RLS policy therefore **fails CI automatically**. This is the single most valuable test in the codebase.

### End-to-end — Playwright

The six critical journeys from the brief: company setup · employee onboarding · training lifecycle · scheduling and shift swap · shift execution · employee separation. Each runs in a desktop project and — for employee flows — an **iPhone-sized mobile project**. `@axe-core/playwright` scans every key screen. Console errors fail the test.

### CI gates (all required to merge)

`typecheck` → `lint` → `unit` → `integration` (Postgres service container) → `build` → `e2e` → `axe`.

### On coverage

No percentage mandate — coverage percentages reward testing trivial code. The rule instead: **every capability has a denial test, and every tenant table has an isolation test.** Both are mechanically verifiable.

---

## 9. Security and tenant isolation strategy

### Isolation in three independent layers

Any one layer failing does not expose data.

1. **PostgreSQL Row-Level Security** on every tenant table, keyed on `organization_id`, applied via `SET LOCAL app.organization_id` inside the request transaction. The application connects as a role that is **not superuser and not `BYPASSRLS`** — so even raw SQL injected into the app cannot cross tenants.
2. **A tenant-scoped db handle.** The only exported accessor requires a resolved session context. The raw Drizzle client is importable only inside `src/server/db/` — enforced by an ESLint `no-restricted-imports` rule, so a violation fails CI rather than review.
3. **Composite foreign keys `(organization_id, id)`.** A cross-tenant reference is rejected by the database schema itself, before any code runs.

### Additional controls

| Area                 | Control                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization        | Server-enforced in every action via `authorize()`; UI visibility uses the same function but is never the gate                         |
| Sessions             | httpOnly · Secure · SameSite=Lax · rotated on privilege change · idle + absolute expiry                                               |
| CSRF                 | Server Action origin verification; double-submit tokens on route handlers                                                             |
| Rate limiting        | Sign-in, password reset, invite acceptance, announcement publish, upload requests                                                     |
| Uploads              | Presigned PUT · content-type allowlist · size cap · server-side re-validation of magic bytes · non-executable bucket · no public ACLs |
| Secrets              | Environment only, validated by a Zod `env.ts` that **fails at boot** on a missing or malformed variable                               |
| Logging              | pino with explicit redaction paths; **no employee PII, no emergency contacts, no HR notes in logs or analytics events**               |
| Audit                | Append-only; `UPDATE`/`DELETE` revoked from the application role at the database level                                                |
| Encryption           | TLS in transit; encryption at rest at the database and object-store layer                                                             |
| Backups              | Daily automated with PITR; **a restore drill is a Slice 7 deliverable, not a document** — an untested backup is not a backup          |
| Retention & deletion | Modelled in v1 (`archived_at`, separation flow); tenant export/delete workflow Phase 2                                                |

### Support impersonation — deliberately absent in v1

No EverCalm staff member can enter a customer account in v1, because no such code path will exist. When it ships in Phase 2 it carries, non-negotiably: a mandatory written reason · a hard time limit · read-only by default · owner notification on start · a persistent banner in the impersonated session · and every request tagged with a `support_access_session_id` in the audit trail. Silent entry will never be possible.

### Compliance posture

EverCalm **organises** HR workflows; it does not provide legal advice and no screen will claim a workflow guarantees compliance. Jurisdiction-specific content (policies, retention periods, break rules) is configurable data reviewed by the customer's own qualified people — never hard-coded assertions from us.

---

## 10. Design system direction

### Palette, contrast-audited against WCAG 2.2 AA

I measured every brand colour rather than assuming. The results **constrain the design**, so they are stated up front:

| Token                    | Hex       |               On white | Verdict                                                     |
| ------------------------ | --------- | ---------------------: | ----------------------------------------------------------- |
| `ink`                    | `#040404` |                20.50:1 | AAA — body and headings                                     |
| `violet-600` **primary** | `#7C24F5` |                 6.13:1 | **AA — safe for text and as a button fill with white type** |
| `pink-500` brand         | `#EA33A9` |             **3.79:1** | **FAILS AA for normal text**                                |
| `pink-700`               | `#B8177F` |                 6.06:1 | AA — use for pink _text_                                    |
| `violet-700`             | `#6B17DB` |                 7.58:1 | AAA — hover/active                                          |
| `violet-300`             | `#A56BFF` | 4.88:1 _(on charcoal)_ | AA — violet on dark surfaces                                |
| `pink-300`               | `#F27ACA` | 6.68:1 _(on charcoal)_ | AA — pink on dark surfaces                                  |
| `muted`                  | `#5A5766` |                 7.02:1 | AAA — secondary text                                        |
| `success`                | `#146C43` |                 6.45:1 | AA                                                          |
| `warning`                | `#8C5200` |                 6.32:1 | AA                                                          |
| `danger`                 | `#C02626` |                 5.92:1 | AA                                                          |
| `info`                   | `#1D4FD8` |                 6.64:1 | AA                                                          |

**Three rules this produces, encoded as lint-checked tokens:**

1. **Brand pink `#EA33A9` is never used for small text on white.** It is for large display type (≥24px), fills, borders, icons, and gradients. Pink text uses `pink-700`.
2. **Brand violet `#7C24F5` fails on charcoal (2.72:1).** Dark surfaces use `violet-300`. The naive "just use the brand colour everywhere" approach would have broken the dark sections shown in your own palette board.
3. The brand cyan/blue accents mentioned in the brief resolve to `info #1D4FD8`; `#00C2E0` (2.14:1) is decorative-only — fills and illustration, never text or an icon that carries meaning alone.

### Type

The logo's own pairing drives this: an italic high-contrast serif ("Ever") against a heavy geometric sans ("Calm.").

- **Display / marketing headlines:** Plus Jakarta Sans ExtraBold, tight tracking — echoes "Calm."
- **Editorial accent:** Fraunces Italic — echoes "Ever". **Marketing only**, used on one phrase per page at most. It is a seasoning, not a body font.
- **Product UI and body:** Inter, with tabular numerals for every schedule, score, and count.

Two families in the product, three on marketing. Not more.

### Surface language

Rounded (12px cards, 10px controls, 20px+ marketing panels) · borders carry structure, shadows are limited to two elevations · white and `#FAFAFB` grounds with `#1E1E1E` charcoal sections for marketing contrast moments · the violet→pink gradient reserved for **three uses only**: the primary marketing CTA, one hero accent, and progress rings. Gradient everywhere is the fastest way to look generic.

### Explicitly banned (from the brief, enforced in review)

Beige/sage palettes · tiny eyebrow text · decorative dots and dashes with no meaning · walls of identical-weight cards · low-contrast buttons · ambiguous clickability · gratuitous gradients · vanity-metric dashboards. **Every number on a dashboard must be something a person can act on.**

### Accessibility baseline — WCAG 2.2 AA

Visible focus rings on a 2px offset · full keyboard operation including the schedule grid · semantic landmarks and headings · labelled controls with useful validation messages · 44px minimum touch targets on employee screens · `prefers-reduced-motion` honoured · **no meaning conveyed by colour alone** (shift states carry an icon and a label, not just a hue) · designed empty, loading, and error states for every view · confirmation on destructive actions with undo where practical.

### Slice 1 deliverables

`docs/design-system.md` plus a live internal `/design` route rendering every token, component, and state — including error and disabled — so drift is visible rather than theoretical.

---

## 11. Key assumptions and open questions

### Assumptions I am proceeding on unless corrected

1. Responsive PWA first; no native apps in v1.
2. English only in v1; content architecture stays translation-ready.
3. US-centric defaults (dates, week starting Sunday, timezones) — configurable per organisation.
4. Pilot organisations are 1–5 locations and 25–150 employees. Not designing for 10,000-employee enterprises yet.
5. Employees have smartphones with email access; SMS is an abstraction we can add later.
6. EverCalm is not a system of record for payroll, and no one will attempt to calculate wages from it.
7. No PHI, so HIPAA is out of scope for v1 (this changes if clinics become a pilot target).
8. Self-serve signup exists but pilots are onboarded hands-on.
9. You own the EverCalm mark and the fonts chosen will be open-licence (Google Fonts).

### Questions that need your answer

| #   | Question                                                                                                                       | My default if you don't answer                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | **Database hosting** — you have no local Postgres or Docker. Neon (serverless, free tier, branch-per-PR) is my recommendation. | Neon for dev + preview; **I will not create any account or purchase anything without your explicit go-ahead.** |
| 2   | **Do you have a vector logo?** SVG/AI/Figma source.                                                                            | I rebuild the mark as hand-authored SVG and treat the wordmark as raster until vector arrives.                 |
| 3   | **Marketing site timing** — 4 real pages now and the full ~22 after Slice 4, or all 22 up front?                               | 4 now, full site in Slice 7 with genuine screenshots.                                                          |
| 4   | **Do you have a named pilot company?** Their actual vocabulary should shape the seed data.                                     | I seed a plausible independent two-location restaurant.                                                        |
| 5   | **Should I add the Shift Lead role preset?**                                                                                   | Yes — add it.                                                                                                  |
| 6   | **Two-way messaging in v1?** It is the largest single scope item I have deferred.                                              | Deferred to Phase 2; announcements + acknowledgement ship in v1.                                               |
| 7   | **Git** — initialise a repo, and do you want a GitHub remote?                                                                  | I initialise nothing until you say so.                                                                         |
| 8   | **Domain and email sending domain** for Resend.                                                                                | Dev uses a sandbox sender; no DNS changes made.                                                                |
| 9   | **Deployment target** — Vercel assumed.                                                                                        | Nothing deployed without permission.                                                                           |
| 10  | Any regulated jurisdictions in the pilot (California scheduling law, predictive scheduling ordinances)?                        | Generic defaults; no compliance claims made anywhere in the UI.                                                |

### Technical risks

| Risk                                                                     | Severity | Mitigation                                                                                                                                          |
| ------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timezone and business-date bugs** in scheduling                        | High     | Location-level timezones from day one; `business_date` as an explicit column; DST-boundary unit tests in Slice 1, before any scheduling code exists |
| Restaurant vocabulary leaking into the core                              | High     | Second tenant in a different industry seeded in **Slice 2, not Slice 7**; templates copy rather than reference                                      |
| Scheduling UI complexity (drag, conflicts, mobile)                       | High     | Conflict detection is a pure, fully-tested service; the grid is a thin renderer over it                                                             |
| Course builder scope creep                                               | Medium   | Five content types in v1; branching scenarios and flashcards are Phase 2                                                                            |
| RLS + connection pooling (`SET LOCAL` leaking across pooled connections) | **High** | Transaction-scoped `SET LOCAL` only; a test asserts the setting does not survive the transaction; pooler configured in transaction mode             |
| Gamification farming                                                     | Medium   | Idempotency keys on every XP award; dwell-time and pass requirements                                                                                |
| Better Auth is a younger library                                         | Medium   | Confined behind our own session interface; swappable without touching business logic                                                                |

---

## 12. Sequence and relative effort

| Order | Slice                    | Effort |      Days | Gates the work that follows                                      |
| ----- | ------------------------ | ------ | --------: | ---------------------------------------------------------------- |
| 1     | Foundation               | L      |      8–10 | **Everything.** Isolation and permissions cannot be retrofitted. |
| 2     | People & onboarding      | M      |       5–7 | Every subsequent slice needs real employees to act on            |
| 3     | Communication            | M      |       4–5 | Notification infrastructure used by slices 4–6                   |
| 4     | Scheduling               | XL     |     10–12 | Checklist runs are generated from published shifts               |
| 5     | Learning                 | XL     |     12–14 | Role-readiness feeds scheduling eligibility                      |
| 6     | Shift operations         | L      |       7–9 | Closes the daily loop                                            |
| 7     | Admin & launch readiness | L      |       7–9 | Pilot-ready                                                      |
|       | **Total**                |        | **55–70** |                                                                  |

Slices 4 and 5 are the genuinely hard ones. If time pressure appears, the correct response is to cut _features within_ a slice (fewer content types, fewer report views) rather than to cut the definition of done.

---

## 13. Recommended first pilot industry

### Primary: independent full-service restaurants, 1–3 locations, 25–80 employees

1. **Highest pain density.** Turnover routinely exceeds 75%, so onboarding and training are continuous rather than annual — EverCalm's core loop runs every single week instead of once a quarter.
2. **Every subsystem gets exercised daily.** Pre-shift meetings, side work, the 86 list, large parties, shift swaps, and food-safety certification are all real daily behaviour, not features we would have to convince anyone to adopt.
3. **Short sales cycle.** The buyer is the owner or GM. No procurement, no security questionnaire, no IT department.
4. **The brief's examples are already restaurant-shaped**, so the domain vocabulary is well understood.

**The risk** is exactly the one you flagged: restaurant assumptions calcifying into the core.

### Mitigation — seed tenant #2 in Slice 2, not Slice 7

**Recommended second industry: a two-location hair salon and spa.** It is the sharpest available stress test:

- **Different vocabulary** — chairs and booths rather than stations; a service menu rather than an 86 list.
- **Different scheduling shape** — appointment-driven, which forces us to prove that `shift` and `service appointment` are genuinely separable concepts rather than one hard-coded assumption.
- **State licensure is real.** Cosmetology licences expire on fixed dates with legal consequence, which pressure-tests certification expiry as a first-class concept instead of a restaurant-flavoured afterthought.
- Structurally similar enough (hourly, multi-location, shift-based) that it is honest, different enough that hard-coding shows immediately.

Boutique fitness is a reasonable alternative if you have a warmer contact there; the class-scheduling model stresses the same seam.

---

## 14. The exact first slice I would build after approval

### Slice 1 — Foundation

Nothing in EverCalm can be retrofitted with tenant isolation or a permission model. Slice 1 builds the spine and proves it with tests.

**1. Project and tooling**
Next.js 16.3.5 App Router · TypeScript 6.0.3 strict + `noUncheckedIndexedAccess` · Tailwind 4 · ESLint with the module-boundary and raw-db-import restrictions · Prettier · `src/lib/env.ts` (Zod, fails at boot) · GitHub Actions CI running typecheck → lint → unit → integration → build → e2e → axe.

**2. Design system**
Brand tokens as CSS custom properties with the contrast-audited scales from §10 · Inter + Plus Jakarta Sans + Fraunces · primitives: Button, Input, Select, Checkbox, Radio, Dialog, Sheet, Toast, Table, Badge, Avatar, Tabs, EmptyState, ErrorState, Skeleton · every one keyboard-accessible with a visible focus ring · a live `/design` route rendering every component in every state.

**3. Database and isolation**
Drizzle schema for `users`, `organizations`, `locations`, `employments`, `employment_locations`, `roles`, `role_capabilities`, `role_grants`, `audit_events` · SQL migrations that include **RLS policies on every tenant table** · an application database role that is neither superuser nor `BYPASSRLS` · the tenant-scoped db handle · composite `(organization_id, id)` foreign keys · `UPDATE`/`DELETE` revoked on `audit_events`.

**4. Authentication**
Better Auth with the Drizzle adapter · email + password (argon2id) · email verification · password reset · email OTP recovery · session → actor resolution that loads employments and grants once per request · rate limiting on all auth endpoints.

**5. Permission engine**
The capability registry as typed constants · the six role presets from §6 (plus Shift Lead if approved) · `can()` and `authorize()` with org/location scope resolution · a permission-denied page · server-side redirect of employee-only users away from `/app`.

**6. Audit foundation**
`recordAuditEvent()` participating in the caller's transaction · wired into sign-in, organisation and location changes, and role grants · a read-only audit view at `/app/settings/audit`.

**7. Application shell**
Role-aware `/app` shell with navigation filtered by real capabilities · location switcher · `/my` shell · the four marketing pages (Home, Pricing, Contact/Demo, Security) built on the real design system.

**8. Seed data**
Two complete organisations — the restaurant and the salon — each with locations, an owner, and a small set of employments and grants, in an idempotent, re-runnable seed.

**9. Tests**
Unit: capability resolution across every role × scope, and DST-boundary business-date math. Integration: three-actor tests on every Slice 1 action, plus the **generated RLS suite that enumerates the schema and fails when a new tenant table lacks a policy**, plus a test proving `SET LOCAL` does not survive its transaction. E2E: sign in as each org's owner, confirm each sees only their own data, confirm an unprivileged user is denied, with an axe scan on every screen.

### Acceptance criteria for Slice 1

- [ ] Two seeded organisations exist; each owner signs in and sees only their own organisation.
- [ ] A user from org A receives **404**, not 403, for every org B resource.
- [ ] The generated RLS suite passes and **fails** when a tenant table without a policy is introduced.
- [ ] Navigation renders from real capabilities, and the server denies a forged request to a hidden route.
- [ ] The audit log shows real entries from real actions.
- [ ] `/design` renders every component and state; axe reports no violations on any Slice 1 screen.
- [ ] Full keyboard operation of the shell and marketing pages; visible focus throughout.
- [ ] `next build` succeeds; the whole CI pipeline is green.
- [ ] Zero console errors in the Playwright run.
- [ ] `docs/design-system.md`, `docs/architecture.md`, `docs/permissions.md`, and `README.md` are written.
- [ ] **No button anywhere suggests functionality that does not exist.**

---

## Standing commitments

1. Nothing is committed, pushed, or deployed without your explicit permission.
2. No service is purchased, and no account is created, without asking first.
3. After each slice I report all fifteen items from the brief, including **actual test output** — never a claim of success without the run behind it.
4. Nothing is called complete because the page renders.
