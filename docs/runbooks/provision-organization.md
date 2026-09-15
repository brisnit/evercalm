# Provisioning an organization

How a pilot customer's workspace is created in production. There is no
self-service signup, and the seed must never run against production.

## What it does

`npm run provision:organization` reads one JSON file and creates, only where
missing:

- the organization (found by slug) and its locations (found by name)
- the standard roles and their capabilities, from the code presets
- the default announcement categories
- a **manual pilot** subscription, active, with a "Pilot started" event
- an **owner invitation**: owner role, whole organization, every location,
  valid for 14 days, stored as a SHA-256 hash of a single-use token

It **never** creates a user, an account, a password, or any demo people,
schedules, courses, messages or onboarding. The owner opens the invitation
link and chooses their own password. Every change is recorded in the new
organization's audit log as "EverCalm provisioning".

## Safety

- **Dry run by default.** Without `--apply` everything runs in a transaction
  that is rolled back; the report is exactly what would happen. No link is
  printed in a dry run.
- **Idempotent.** Running the same file again changes nothing. A pending,
  unexpired owner invitation is left alone; pass `--reissue-invitation` to
  revoke it and print a new link. If the owner is already a member, no
  invitation is created.
- **No overwrites.** A slug that belongs to an organization with a different
  name is refused. Existing locations, industries and timezones are never
  changed; differences are reported as notes.
- **Runs as the migration role**, from a trusted machine or a protected
  workflow. `MIGRATION_DATABASE_URL` is never set on the web host.

## Steps

1. Copy [provision-organization.example.json](provision-organization.example.json)
   somewhere outside the repository and fill in the real values. Keep it out
   of git: it holds the owner's email address.

   | Field                   | Rule                                                    |
   | ----------------------- | ------------------------------------------------------- |
   | `organization.slug`     | Lowercase letters, digits and single hyphens; permanent |
   | `organization.industry` | A lowercase word, e.g. `restaurant`, `salon_spa`        |
   | `*.timezone`            | An IANA timezone, e.g. `America/Los_Angeles`            |
   | `locations`             | At least one; names unique                              |
   | `owner.email`           | The address the owner will sign in with                 |

2. Confirm migrations are current: `npm run db:migrate` against the same
   database (see [migrations and rollback](migrations-and-rollback.md)).
3. Dry run, and read the report. The first line names the database host.

   ```sh
   MIGRATION_DATABASE_URL=… APP_URL=https://<public origin> \
     npm run provision:organization -- --file ./customer.json
   ```

4. Apply:

   ```sh
   … npm run provision:organization -- --file ./customer.json --apply
   ```

5. The owner invitation link is printed **once**. Send it to the owner
   privately (not in a shared channel). It works once and expires in 14 days.
   Do not store it anywhere; if it is lost, run again with
   `--apply --reissue-invitation`.
6. When the owner has signed in, confirm on the team dashboard that the
   organization shows "Manual pilot" and an active subscription.

## If something goes wrong

The whole run is one transaction: an error changes nothing. Fix the file or
the database and run again.
