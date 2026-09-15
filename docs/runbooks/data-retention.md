# Data retention and account closure

EverCalm organizes HR records for its customers; it does not decide how long
the law requires them to be kept. Retention periods below are the product's
defaults and must be reviewed by qualified people for each jurisdiction before
launch.

## What the application never does

- Deletes a customer's operational history. Audit events, billing events,
  support case messages, onboarding and training records, shift task events
  and handoffs refuse `DELETE` (and most refuse `UPDATE`) for the runtime role.
- Removes an employee's record when they leave: separation marks them
  separated and ends their access.

## When a subscription ends

| Stage                                  | What happens                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Cancellation requested                 | Everything works until the end of the period (or trial).                        |
| Canceled (period ended)                | Administration is read-only: view and export. Employees keep their own records. |
| 90 days after cancellation             | The EverCalm team contacts the billing contact before any closure.              |
| Closure (a human decision, on request) | See below.                                                                      |

Suspension for non-payment is the same read-only mode, and is lifted by
payment.

## Exports before leaving

Owners and HR administrators export reports as CSV from Reports. A complete
data export (every table for the organization, as files) is not built yet;
until it is, the team produces one on request with the migration role, reviewed
by two people, delivered to the owner through the support case.

## Closing an account (manual, two people)

1. The owner asks through a support case, category "Data export or deletion".
2. Confirm the request with the billing contact by a second channel.
3. Produce and deliver the full export; the owner confirms receipt.
4. A second team member reviews, then deletes the organization with the
   migration role (`DELETE FROM organizations WHERE id = ...` cascades to every
   tenant table). Global `user` rows are deleted only for people with no
   employment left anywhere.
5. Record the closure on the case; the organization's audit log goes with it.
6. Backups age out under their normal retention; note the date it completes.
