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

## Releasing to the demo

The demo tracks a dedicated release branch, `stakeholder-demo`, so merging work
into `main` never changes what stakeholders are looking at.

**How that is enforced.** Vercel's _Production Branch_ control is not available
on this account's dashboard, and the REST API and CLI do not expose it
(verified September 2026: `PATCH /v9/projects/:id` rejects every branch
property, and `POST /v9/projects/:id/link` accepts `productionBranch` but
ignores it). So the guard is an **Ignored Build Step** on `evercalm-demo`:

```sh
if [ "$VERCEL_GIT_COMMIT_REF" = "stakeholder-demo" ]; then exit 1; else echo "Skipping: $VERCEL_GIT_COMMIT_REF is not the stakeholder-demo release branch." && exit 0; fi
```

Vercel treats exit 0 as "skip this build" and exit 1 as "build it", so every
ref except `stakeholder-demo` is skipped. A push to `main` is CANCELED before
it builds, and the live deployment stays where it is.

### Releasing

1. The release lands on `main` first, as an ordinary approved commit.
2. **Only after explicit authorization from the product owner**, fast-forward
   the release branch to that exact commit:

   ```bash
   git fetch origin
   git branch -f stakeholder-demo <approved-sha>   # fast-forward only
   git push origin stakeholder-demo                # never --force
   ```

3. That push builds (the guard allows it), but as a **preview**: Vercel still
   considers `main` its production branch, so the public alias does not move on
   its own. Create the production deployment from the same ref, which carries
   the commit SHA in its metadata:

   ```bash
   curl -X POST "https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1" \
     -H "Authorization: Bearer $VERCEL_TOKEN" -H 'content-type: application/json' \
     -d '{"name":"evercalm-demo","project":"prj_XaqyxawCclDvJhbnv6o7MydJtcGg",
          "target":"production",
          "gitSource":{"type":"github","repoId":1367815947,"ref":"stakeholder-demo"}}'
   ```

   `vercel promote <preview-url>` is the alternative: it moves the alias to a
   build that already exists, without rebuilding.

4. Verify afterwards: `/api/health` (RLS enforced), `/api/ready` (expected
   migration and worker), a sign-in for one owner and one employee, and that
   the deployment's `githubCommitSha` is the approved commit.

Never rewrite `stakeholder-demo`: it is a pointer at an approved commit, and
its history must match `main`.

Any migration the release needs is applied to the demo database **before** the
deployment, as the migrator role, pending migrations only, never a reset or
reseed. See [Reset](#reset) for what is deliberately hard to do here.

> A CLI `vercel deploy --prod` bypasses the Ignored Build Step entirely, so it
> is not a guard against a mistaken deployment - it is a deliberate act. Use
> the git-sourced call above so the deployment records which commit it is.

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
