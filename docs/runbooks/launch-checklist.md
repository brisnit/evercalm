# Security and privacy launch checklist

Tick each item in the launch review. "Done" means verified in the environment
being launched, not in development.

## Isolation and access

- [ ] `/api/health` reports row-level security enforced (runtime role is NOSUPERUSER, NOBYPASSRLS).
- [ ] `npm run test:isolation` and the integration suite pass against staging.
- [ ] Every `evercalm_*` security-definer function: `search_path` pinned, `EXECUTE` revoked from `PUBLIC`.
- [ ] `platform_staff` contains only current EverCalm staff; the runtime role cannot write to it.
- [ ] `support_internal_notes`: runtime role has no privileges (`permission denied` on select).
- [ ] No support impersonation path exists (code review of `src/server/auth` and `src/app/(platform)`).

## Authentication and sessions

- [ ] `BETTER_AUTH_SECRET` is 32+ random bytes from the secret manager.
- [ ] `APP_URL` is the HTTPS origin; cookies are `Secure`, `HttpOnly`, `SameSite=Lax`.
- [ ] `E2E_RELAX_RATE_LIMIT` is unset (it is ignored in production regardless).
- [ ] Sign-in 5/min, sign-up 5/min, password reset 3/min per the test-locked rules.

## Abuse protection (reviewed for Slice 7 and Phase B)

| Surface                    | Protection                                                             | Gap to close before scale   |
| -------------------------- | ---------------------------------------------------------------------- | --------------------------- |
| Sign-in, reset             | Library rate limits, strict values test-locked, shared in the database | —                           |
| Report CSV export          | 20 per person per minute, shared in the database, audited              | —                           |
| Support case creation      | 5 per person per hour, in the database                                 | —                           |
| Billing webhook            | Signature required, 120/min shared, 16 KB body limit                   | —                           |
| Invitations, announcements | Capability-gated, audited                                              | Per-organization daily caps |
| Scheduled worker endpoint  | Bearer `CRON_SECRET`, constant-time, 404 otherwise, counts only        | —                           |

## Data protection

- [ ] Logs redact passwords, tokens, emails, phones, emergency contacts, dates of birth, addresses (see `src/lib/logger.ts`).
- [ ] Error tracker scrubs request bodies and cookies.
- [ ] CSV exports contain no internal ids, no sensitive HR fields, and neutralise spreadsheet formulas.
- [ ] Backups encrypted, cross-region, restore drill recorded.
- [ ] Retention defaults reviewed by qualified people ([data retention](data-retention.md)).
- [ ] Privacy notice and terms reviewed and published.

## Configuration

- [ ] Environment validates at boot; the console email provider, mock billing and placeholder senders are refused in production.
- [ ] `BILLING_PROVIDER=manual`; the Billing screen says billing is arranged with EverCalm.
- [ ] `MIGRATION_DATABASE_URL` is not set in any Vercel environment.
- [ ] `CRON_SECRET` is set; `GET /api/cron/worker` without it returns 404.
- [ ] `DATABASE_URL` uses the pooled endpoint; the seed has never run against production.
- [ ] `/api/ready` returns 200 and names no hosts, versions or secrets.
- [ ] Vercel Cron runs `/api/cron/worker` every minute; alerting on delayed worker and repeated `worker_runs` errors.
- [ ] Secret scan clean on the release commit.
