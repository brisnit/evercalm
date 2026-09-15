# Customer support

Support happens on the EverCalm team dashboard at `/platform`. Staff accounts
are listed in `platform_staff` (added with the migration role; the application
cannot create them).

## What support can and cannot do

| Can                                                                                           | Cannot                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| See each organization's plan, subscription status and counts                                  | Sign in as, or act as, anyone in a customer organization |
| Read and reply to support cases, assign them, resolve and reopen                              | Read employee records, inboxes, messages or HR fields    |
| Write internal notes customers never see                                                      | See internal notes from the customer's side (nobody can) |
| Open diagnostics: delivery failures, background errors, activity counts (audited, 15 minutes) | Browse audit summaries or diagnostics silently           |
| Retry recent failed deliveries (support administrators, with a reason, audited)               | Change billing, delete anything                          |

This is deliberate. There is no impersonation, and adding it is a product and
security decision with the safeguards described in the implementation plan.

## Working a case

1. **Triage** the Open queue, most severe first. Assign it to yourself.
2. **Reply** within one business day (urgent: the same day). Set the status to
   "In progress" or "Waiting on customer". The case's author is notified.
3. **Diagnose** with what the customer tells you and the organization's
   diagnostics. Ask for page addresses and times; do not ask for passwords or
   screenshots of employee records.
4. **Record** what you found in an internal note, especially anything about
   infrastructure or other customers.
5. **Resolve** with a reply saying what was done. A customer update reopens a
   resolved case automatically.

## Common requests

- **"Someone did not get an email."** Open diagnostics. "No email address on
  file" is fixed by the customer on the person's profile. Provider errors can
  be retried by a support administrator.
- **"Times look an hour off."** Check which location and its timezone in the
  customer's settings; locations keep their own timezone.
- **"We want to cancel / export everything / close the account."** See
  [data retention](data-retention.md). Billing changes are the owner's, on the
  Billing screen.
- **"Can you log in and look?"** No. Ask what they see, where, and when.
