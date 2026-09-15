# Incident response

## Severity

| Level | Means                                                                        | Response               |
| ----- | ---------------------------------------------------------------------------- | ---------------------- |
| SEV 1 | Data exposed across tenants, sign-in broken for everyone, or data loss       | Immediately, all hands |
| SEV 2 | A core flow broken for many customers: publishing, onboarding, notifications | Within 1 hour          |
| SEV 3 | Degraded or broken for some: slow reports, one organization's worker errors  | Next business day      |

## First 15 minutes

1. Name an incident lead. One person decides; everyone else reports to them.
2. Open an incident note with times, what is known, and what was done.
3. Check `/api/health` and `/api/ready`, error rates, and the latest
   `worker_runs` rows on the EverCalm team dashboard.
4. If data may be exposed across tenants: treat as SEV 1. Stop the exposure
   first (maintenance mode, disable the route, revoke the role's grants),
   then investigate.

## Common situations

- **Worker not running.** Nothing is lost: all background work is rows in the
  database. Restart the scheduler; the next ticks catch up. Customers see
  "Delayed" on their system status page meanwhile.
- **Email provider outage.** Deliveries retry with backoff and then fail with a
  reason. When the provider recovers, a support administrator retries recent
  failures from the organization's diagnostics (audited), or owners retry from
  System status.
- **Bad deploy.** Roll back the application (see
  [migrations and rollback](migrations-and-rollback.md)).
- **Suspected account compromise.** Revoke the user's sessions (delete their
  `session` rows with the migration role), have the owner remove role grants,
  review the organization's audit log.

## Communication

- Tell affected organizations through their support cases or the billing
  contact, in plain words: what happened, what it affected, what they should
  do, and when the next update is.
- A personal-data breach may have legal notification deadlines. Involve
  qualified legal advice before stating anything about obligations.

## Afterwards

Within five business days: a written review with the timeline, cause, what
detected it, and the changes that stop it recurring. No blame.
