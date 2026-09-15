# Backup and restore

An untested backup is not a backup. The first restore drill is a launch
blocker, and it repeats quarterly.

## What to back up

Everything is in one PostgreSQL database: tenant data, identity, audit, the
billing history and support cases. There is no file storage yet (attachments
and photos are out of scope), so the database is the whole of the state.

## Required configuration

- Automated daily snapshots, retained 30 days.
- Point-in-time recovery (WAL archiving) with at least 7 days of history.
- Snapshots encrypted at rest, in a different region from the primary.
- The migration role's credentials are needed to restore; store them in the
  secret manager, not with the backups.

## Restore drill

1. Restore the latest snapshot to a **new** database instance. Never over
   production.
2. Recreate the roles if the platform does not restore them: `evercalm_app`
   must be NOSUPERUSER and NOBYPASSRLS.
3. Point a staging deployment at it with production-like environment
   variables but the console email provider and mock billing, so nothing is
   sent or charged.
4. Check `/api/health` (row-level security enforced) and `/api/ready`
   (migrations current).
5. Sign in as a test owner in a known organization and confirm recent records:
   the latest published schedule, an announcement, a support case.
6. Confirm isolation: run `npm run test:isolation` against the restored
   database.
7. Record the drill: date, snapshot time, time to restore, problems found.

## Restoring for real

Follow [incident response](incident-response.md). Decide the recovery point
with the incident lead, restore to a new instance, verify as in the drill,
then switch the application's `DATABASE_URL` and `MIGRATION_DATABASE_URL`.
Tell affected customers what window of changes, if any, was lost.
