# Production readiness

EverCalm runs end to end on a developer machine, and the code for a
production pilot on Vercel exists. What does not exist is any production
account, domain or secret. None of them may be set up without the product
owner's explicit approval: each involves an account, a cost, a domain or a
secret.

## 1. Hosting and the database

- **Application host: Vercel** (Node.js runtime). Set `APP_URL` to the public
  HTTPS origin; session cookies become `Secure` automatically. No domain has
  been chosen and none is assumed.
- **Managed PostgreSQL 16+** with point-in-time recovery (see
  [backup and restore](backup-and-restore.md)), in the same region as the
  Vercel functions.
- **Two roles, exactly as in development.** `evercalm_app` (NOSUPERUSER,
  NOBYPASSRLS) serves requests; a migration role owns the schema. The
  application refuses to start if its role can bypass row-level security.
- **Connections.** `DATABASE_URL` is the provider's **pooled**
  (transaction-mode) endpoint for `evercalm_app`. Tenant context is `SET LOCAL`
  inside each transaction, which is safe with transaction pooling. Each
  function instance keeps a small pool: 3 connections by default on Vercel,
  released after 5 seconds idle; `DATABASE_POOL_MAX` overrides it.
- **`MIGRATION_DATABASE_URL` is never set on Vercel.** Migrations and
  provisioning run from a trusted machine or a protected workflow, using the
  **direct** endpoint. See [migrations and rollback](migrations-and-rollback.md).
- `/api/health` for liveness and `/api/ready` for traffic readiness. Readiness
  fails until every migration this build expects is applied.

### Vercel environment variables (Production)

| Variable             | Value                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| `APP_URL`            | The public HTTPS origin                                                    |
| `DATABASE_URL`       | Pooled endpoint, `evercalm_app` role, `sslmode=require`                    |
| `BETTER_AUTH_SECRET` | 32+ random bytes (`openssl rand -base64 32`)                               |
| `EMAIL_PROVIDER`     | `resend`                                                                   |
| `EMAIL_FROM`         | A sender on the verified domain, e.g. `EverCalm <notifications@…>`         |
| `RESEND_API_KEY`     | From Resend, sending access only                                           |
| `BILLING_PROVIDER`   | `manual`                                                                   |
| `CRON_SECRET`        | 32+ random characters (`openssl rand -hex 32`)                             |
| `LOG_LEVEL`          | `info`                                                                     |
| `DATABASE_POOL_MAX`  | Optional                                                                   |
| Never                | `MIGRATION_DATABASE_URL`, `MOCK_BILLING_WEBHOOK_SECRET`, `E2E_*`, `TEST_*` |

The environment check fails the server at boot with any of these missing or
invalid; a build succeeds without email and billing configuration, but no
production server serves traffic with a placeholder.

## 2. Background work (scheduling)

The worker publishes scheduled announcements, sends reminders and pre-shift
reminders, moves provider-managed subscriptions through their lifecycle, and
delivers notifications.

- **On Vercel:** `vercel.json` schedules `GET /api/cron/worker` every minute.
  Vercel sends `Authorization: Bearer <CRON_SECRET>`; the endpoint compares it
  in constant time and answers **404** to anything else, including every
  request when `CRON_SECRET` is unset. Each call runs one tick with a
  40-second deadline (the function may run 60): organizations not reached stay
  due for the next minute. The response contains counts only. Per-minute cron
  schedules require a paid Vercel plan; on a plan that allows less, work is
  simply picked up less often.
- **Elsewhere:** a scheduler runs `npm run worker:once` every minute.
- Overlapping runs are safe: every unit of work is claimed with a conditional
  update or `FOR UPDATE SKIP LOCKED`, and each email carries an idempotency key.
- Alert when `/api/ready` reports `worker: "delayed"` or `"not_running"`, and
  when `worker_runs` records errors for several ticks in a row.

## 3. Email delivery

`EMAIL_PROVIDER=resend` is implemented: one HTTPS call per message, an
`Idempotency-Key` per notification claim, permanent refusals (bad address,
unverified sender, invalid key) fail the notification with a reason instead of
retrying, and rate limits, server errors and timeouts retry. Error text never
quotes Resend's response, which can contain the recipient. Needed:

- A verified sending domain (SPF, DKIM, DMARC) on a domain the business owns.
- A Resend account and `RESEND_API_KEY`, in Vercel's encrypted environment.
- `EMAIL_FROM` on that domain. A personal address must never be the sender;
  the environment check refuses placeholder and `.test`/`.example` senders.
- Bounce and complaint handling (Resend webhooks) is not built yet; until it
  is, watch delivery failures on the team dashboard.

## 4. Billing

`BILLING_PROVIDER=manual`: a pilot with no payment provider, billing arranged
directly with EverCalm, status changed only by EverCalm support administrators
with a recorded reason. See [billing providers](billing-provider.md), which
also lists what a real payment provider will need.

## 5. Organizations and signup

There is no self-service signup. Each pilot organization is provisioned with
`npm run provision:organization` from a trusted machine: organization,
locations, standard roles, a manual pilot subscription and a single-use owner
invitation. It never creates passwords or demo data. See
[provisioning an organization](provision-organization.md).

Never run `npm run db:seed` against production: the seed creates demonstration
people with a shared development password.

Before self-service signup can be offered:

- A signup flow that creates the organization, first location, the owner's
  employment and role grant in one transaction.
- Email verification before the workspace is usable.
- Abuse controls: rate limits per IP and per email domain, a CAPTCHA or
  equivalent, and a way for the EverCalm team to suspend a workspace.
- Terms of service and a privacy notice reviewed by qualified people.

## 6. Rate limits

Sign-in, sign-up and password reset limits (Better Auth, `rate_limit` table)
and application limits (report exports, the billing webhook;
`app_rate_limits`) are stored in the database, so every instance shares them.
The worker prunes old application windows.

## 7. Error tracking and log retention

Logs are structured JSON with sensitive fields redacted. Production needs a
log destination with retention and access control (Vercel's log drains or
equivalent), and an error tracker with personally identifiable information
scrubbing enabled.
