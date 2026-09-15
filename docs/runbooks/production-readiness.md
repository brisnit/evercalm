# Production readiness

EverCalm runs end to end on a developer machine. These are the things that
do **not** exist yet, and what each needs before a real customer relies on it.
None of them may be set up without the product owner's explicit approval:
each involves an account, a cost, a domain or a secret.

## 1. Hosting and the database

- A managed PostgreSQL 16+ with point-in-time recovery (see
  [backup and restore](backup-and-restore.md)).
- Two database roles, exactly as in development: `evercalm_app` (NOSUPERUSER,
  NOBYPASSRLS, serves requests) and a migration role that owns the schema.
  The application refuses to start if its role can bypass row-level security.
- An application host for the Next.js server (Node 22). Set `APP_URL` to the
  public origin; session cookies become `Secure` automatically in production.
- `/api/health` for liveness and `/api/ready` for traffic readiness. Readiness
  fails until every migration this build expects is applied.

## 2. Background work (scheduling)

The worker publishes scheduled announcements, sends reminders and pre-shift
reminders, moves subscriptions through their lifecycle, and delivers
notifications. In development `npm run dev` starts it. In production:

- A scheduler (a platform cron or queue trigger) runs `npm run worker:once`
  every minute. Overlapping runs are safe: every unit of work is claimed with
  a conditional update or `FOR UPDATE SKIP LOCKED`.
- Alert when `/api/ready` reports `worker: "delayed"` or `"not_running"`, and
  when a `worker_runs` row records errors for several ticks in a row.

## 3. Email delivery

Development uses `EMAIL_PROVIDER=console`, which sends nothing and cannot
serve production (the environment check refuses it). Needed:

- A verified sending domain (SPF, DKIM, DMARC) on a domain the business owns.
  No domain has been chosen; none is assumed.
- A Resend account and `RESEND_API_KEY`, stored in the host's secret manager.
- `EMAIL_FROM` on that domain. A personal address must never be the sender.
- Bounce and complaint handling, so repeated failures stop being retried.

## 4. Billing

Only the mock provider exists and it cannot serve production. See
[billing provider](billing-provider.md) for the full list: provider account,
products and prices, webhook endpoint and secret, tax decisions, invoices.

## 5. Self-service signup

There is none. Workspaces are created with the team, by seed or by hand, and
people join by invitation. The website's calls to action say "Ask about a
pilot" and lead to the contact page for that reason. Before self-service
signup can be offered:

- A signup flow that creates an organization, its first location, the owner's
  employment and an owner role grant in one transaction, and starts a trial
  subscription.
- Email verification before the workspace is usable (needs email delivery).
- Abuse controls: rate limits per IP and per email domain, a CAPTCHA or
  equivalent, and a way for the EverCalm team to suspend a workspace.
- Terms of service and a privacy notice reviewed by qualified people.
- A decision on what a trial includes and what happens at its end (the
  billing policy already defines the states; see
  [permissions](../permissions.md#subscription-status)).

## 6. Error tracking and log retention

Logs are structured JSON with sensitive fields redacted. Production needs a
log destination with retention and access control, and an error tracker with
personally identifiable information scrubbing enabled.
