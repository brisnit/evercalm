# Database setup

EverCalm's tenant isolation depends on **two database roles with different
privileges**. Getting this wrong silently disables the primary security layer,
so the application asserts its own role at boot and `/api/health` reports
`503` if the runtime role can bypass Row-Level Security.

| Role                | Used by                                 | Privileges                                                                                                                                                            |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evercalm_migrator` | `npm run db:migrate`, `npm run db:seed` | Owns the schema. `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`. Exempt from tenant policies **only because it owns the tables**. Never serves a request. |
| `evercalm_app`      | The running application                 | Owns nothing. `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`. Fully subject to every policy.                                                              |

The role names are fixed: migration `0001_rls_and_grants.sql` grants to them by
name.

---

## Local development (no Docker, no account)

A real PostgreSQL cluster lives under `.pgdata/` (git-ignored). Four commands
manage its whole lifecycle:

| Command                   | What it does                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:local`        | Start. Initialises the cluster and both roles on first run. Stays in the foreground; already running is a no-op.                                                                |
| `npm run db:local:status` | Report running/stopped, the PID, and the port. Exits `3` when stopped, so it works in scripts.                                                                                  |
| `npm run db:local:stop`   | **Deterministic shutdown** via `pg_ctl -D .pgdata -m fast stop`. Targets this cluster by data directory — never a broad `pkill`, which would also kill an unrelated PostgreSQL. |
| `npm run db:local:reset`  | Stop, erase the cluster, and start over. Follow with migrate and seed.                                                                                                          |

Normal workflow:

```bash
npm run db:local          # terminal 1, leave running
npm run db:migrate        # terminal 2
npm run db:seed
npm run dev
```

Starting over from scratch:

```bash
npm run db:local:reset
npm run db:local          # re-initialises
npm run db:migrate && npm run db:seed
```

`npm run db:local` prints the two connection strings; they are already in
`.env.local`.

Integration tests need none of this — they boot their own throwaway instance
on a free port and tear it down afterwards.

### The browser suite has its own database, and cannot reach yours

The browser suite truncates and reseeds on every run. It therefore runs against
`evercalm_e2e`, a second database in the same local cluster, on its own dev
server (port 3100) and its own build directory (`.next-e2e`), so your own
server on port 3000 and your own data are untouched.

```bash
npm run db:e2e:setup      # once: create, migrate and mark evercalm_e2e
npm run test:e2e          # the suite, against evercalm_e2e on port 3100
npm run test:e2e -- training.spec --project=desktop
```

Two independent checks stand in front of anything destructive
(`src/server/db/e2e-guard.ts`):

1. **The name.** A connection string naming anything but `evercalm_e2e` is
   refused before a connection is opened.
2. **The marker.** The database must carry `evercalm:e2e`, set with
   `COMMENT ON DATABASE`. A database marked `evercalm:development`,
   `evercalm:stakeholder-demo` or `evercalm:production` is refused, and the
   message says which it found.

Both `npm run test:e2e` (in `globalSetup`, whether or not it reseeds) and
`npm run db:refresh` require both. `db:refresh` is therefore an
`evercalm_e2e`-only command: to start your own development data over, use
`npm run db:seed`, or `npm run db:local:reset` followed by migrate and seed.

This exists because a browser run once reseeded a developer's own database:
the connection string was inherited from the shell, and nothing checked it.
`tests/unit/e2e-guard.test.ts` proves the refusals, including `evercalm_dev`,
the stakeholder demo and production.

---

## Neon (shared development, preview, and later production)

**These steps need you.** They require account access and, for production,
billing decisions. Nothing here has been done, and no account has been created.

### 1. Create the project

1. Sign in at <https://console.neon.tech>.
2. **New Project** → name `evercalm`, PostgreSQL **17**, region closest to the
   pilot (`AWS us-west-2` for a Sacramento pilot).
3. Neon creates a default branch called `production`. **Rename it to `main`**
   so no branch is called production until one actually is.

### 2. Create one branch per environment

Neon branches are copy-on-write, so each gets an isolated database at no extra
storage cost.

| Branch       | Purpose                                     |
| ------------ | ------------------------------------------- |
| `main`       | Shared development                          |
| `preview`    | Parent for per-pull-request branches        |
| `production` | **Create only when we are ready to launch** |

Automated tests do **not** need a Neon branch: they boot a local PostgreSQL.

### 3. Create the two roles

Open the **SQL Editor** on each branch and run this **once per branch**.
Replace both passwords with values from a password manager.

The migrator does **not** need `CREATEDB`: the bootstrap superuser creates the
database and hands ownership over. No migration or seed operation creates a
database, and there is an integration test asserting the migrator cannot.

```sql
-- Privileged role: owns the schema, runs migrations, never serves requests.
CREATE ROLE evercalm_migrator WITH LOGIN PASSWORD '<MIGRATOR_PASSWORD>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Runtime role: fully subject to Row-Level Security.
CREATE ROLE evercalm_app WITH LOGIN PASSWORD '<APP_PASSWORD>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- The migrator owns the application database.
CREATE DATABASE evercalm OWNER evercalm_migrator;
```

Then connect **to the `evercalm` database** and run:

```sql
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO evercalm_app;
ALTER SCHEMA public OWNER TO evercalm_migrator;
```

> Neon's default `neondb_owner` role **can** bypass RLS. Do not use it as
> `DATABASE_URL`. The application refuses to start if you do.

### 4. Verify the roles before trusting them

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname IN ('evercalm_app', 'evercalm_migrator');
```

Both rows must read `f` for `rolsuper` and `rolbypassrls`. If either reads
`t`, stop — tenant isolation is not in effect.

### 5. Put the connection strings in the environment

Neon connection strings require TLS. Keep `?sslmode=require`.

```bash
DATABASE_URL=postgres://evercalm_app:<APP_PASSWORD>@<host>.neon.tech/evercalm?sslmode=require
MIGRATION_DATABASE_URL=postgres://evercalm_migrator:<MIGRATOR_PASSWORD>@<host>.neon.tech/evercalm?sslmode=require
```

Use the **pooled** host for `DATABASE_URL` and the **direct** host for
`MIGRATION_DATABASE_URL`. Neon's pooler must be in **transaction mode**:
tenant context is set with `SET LOCAL` inside a transaction, and session-mode
pooling would let that context outlive its transaction. There is an
integration test asserting the setting does not survive a commit.

### 6. Migrate and seed

```bash
npm run db:migrate
npm run db:seed     # shared development only - never against production
```

### 7. Confirm

```bash
curl -s localhost:3000/api/health
# {"status":"ok","database":{"connected":true,"role":"evercalm_app","rlsEnforced":true}}
```

`rlsEnforced: false` means the runtime role is privileged. Fix it before going
further.

---

## What still needs a decision

- Whether to create the `production` branch, and on which Neon plan.
- Where the production secrets live (Vercel environment variables, or a
  secret manager).
- Backup retention and the restore drill, which is a Slice 7 deliverable.

Nothing above has been purchased, created, or configured.
