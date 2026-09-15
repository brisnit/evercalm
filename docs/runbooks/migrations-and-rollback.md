# Migrations and rollback

## How migrations work

- Hand-written SQL in `drizzle/`, applied in filename order by
  `npm run db:migrate`, which runs as the **migration role**, never the
  runtime role.
- Each applied file is recorded in `evercalm_migrations` with a SHA-256
  checksum. A changed, already-applied file stops the run. Never edit an
  applied migration; add a new one.
- Every new tenant table needs `ENABLE ROW LEVEL SECURITY` and a
  `tenant_isolation` policy. The RLS coverage test fails CI otherwise.
- 0001 grants the runtime role everything on new tables by default. Append-only
  tables need an explicit `REVOKE UPDATE, DELETE`.
- `/api/ready` returns 503 until the newest migration the build expects
  (`EXPECTED_LATEST_MIGRATION`, kept in step by a unit test) is applied.

## Deploying a change

1. Confirm a recent backup and that point-in-time recovery is enabled.
2. Run the migration against staging restored from production, then the
   integration suite against it.
3. **Expand, then contract.** A deploy may add tables, columns (nullable or
   with defaults), indexes (`CONCURRENTLY` where large) and functions. It must
   not drop or rename anything the running version reads. Removal is a later
   deploy, after the old code is gone.
4. Apply the migration with the migration role.
5. Deploy the application. It becomes ready once readiness passes.
6. Watch error rates, `/api/ready` and the worker for 30 minutes.

## Rolling back

- **Application only** (the migration is additive): redeploy the previous
  build. Additive migrations are compatible with it by construction.
- **A migration must be undone**: write and apply a new forward migration
  that reverses it. Do not delete rows from `evercalm_migrations` or restore
  over a live database to "undo" a migration.
- **Data was damaged**: stop writes (put the host into maintenance), then use
  point-in-time recovery to a new database just before the migration, verify
  it, and switch the application to it. See [backup and restore](backup-and-restore.md).

## Security-definer functions

Functions such as `evercalm_user_memberships` and the `evercalm_staff_*`
family run with the owner's rights. Every one pins `search_path`, revokes
`EXECUTE` from `PUBLIC` and grants it only to `evercalm_app`. Review any change
to them as a security change.
