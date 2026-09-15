# Stakeholder demo

A separate, public deployment of the fictional organizations (Harbor & Vine,
Lumen Salon & Spa) for stakeholders to explore. It is not customer production.

## Separation

|                        | Stakeholder demo                                                | Customer production                          |
| ---------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| Vercel project         | `evercalm-demo`                                                 | `evercalm` (builds skipped until configured) |
| URL                    | https://evercalm-demo.vercel.app                                | not live                                     |
| Database               | Neon Free `evercalm-stakeholder-demo`, database `evercalm_demo` | none yet                                     |
| `EVERCALM_ENVIRONMENT` | `stakeholder-demo`                                              | unset                                        |

The reset command refuses unless `EVERCALM_ENVIRONMENT=stakeholder-demo`, the
connection host equals `DEMO_DATABASE_HOST`, and the database carries the
`evercalm:stakeholder-demo` marker; a database marked `evercalm:production` is
always refused (`src/server/db/demo-guard.ts`).

## What the demo does differently

- Every page shows a "Stakeholder Demo" bar.
- `EMAIL_PROVIDER=disabled`: no email notifications are created; nothing is sent.
- `BILLING_PROVIDER=manual`: nothing is charged.
- Refused on the server: invitations (send, resend, revoke, accept), confirming a
  people import, changing employment status, granting or revoking roles,
  separations, billing contact/plan/cancellation, EverCalm staff billing status
  and delivery retries, customer delivery retries, and creating locations.
- Everyday work — schedules, requests, tasks, announcements, training — works,
  and a reset restores the data.

## Secrets (never in Git, chat, logs or documents)

All under `~/.evercalm-demo/` on the operator's machine, owner-only:

| File                       | Holds                                                         |
| -------------------------- | ------------------------------------------------------------- |
| `neon-owner.env`           | Neon owner connection (setup only)                            |
| `demo-roles.env`           | migrator and runtime connection strings, `DEMO_DATABASE_HOST` |
| `vercel-demo-secrets.env`  | `BETTER_AUTH_SECRET`, `CRON_SECRET`                           |
| `stakeholder-accounts.txt` | customer demo accounts and passwords                          |
| `staff-accounts.txt`       | EverCalm staff accounts — never shared publicly               |

Store these in a password manager, then keep the folder or delete it.
`MIGRATION_DATABASE_URL` is never put in Vercel.

## Reset

```sh
set -a; . ~/.evercalm-demo/demo-roles.env; set +a
EVERCALM_ENVIRONMENT=stakeholder-demo npm run db:migrate
EVERCALM_ENVIRONMENT=stakeholder-demo npm run demo:environment -- reset
```

A reset truncates the demo database, reseeds it and **issues new passwords**,
rewriting the two account files. Signed-in sessions end. Hand the new customer
passwords over again.

## First-time setup (already done)

`npm run demo:environment -- setup` creates `evercalm_migrator` and
`evercalm_app` (no superuser, role or database creation, or RLS bypass), the
`evercalm_demo` database owned by the migrator, and the demo marker.
