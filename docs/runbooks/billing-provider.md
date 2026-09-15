# Connecting a billing provider

The billing foundation is complete except for money. Subscriptions, plans,
states, the history, the owner's screens, idempotent event handling and the
webhook endpoint all exist and are tested. What does not exist is any
connection to a payment provider: `BILLING_PROVIDER=mock` is the only value,
it charges nothing, and the environment check refuses it in production.

## What the code expects

`src/modules/billing/provider.ts` defines `BillingProvider`. A real provider
implements:

| Member               | Responsibility                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`               | Stored on the subscription (`subscriptions.provider`; widen its check constraint)                                                                                                           |
| `live`               | `true`. The billing screen stops saying payments are not connected.                                                                                                                         |
| `simulationsEnabled` | `false`.                                                                                                                                                                                    |
| `verifyWebhook`      | Verify the provider's signature over the RAW body, in constant time, and map the event to `payment_succeeded`, `payment_failed` or `payment_method_added`. Return `null` for anything else. |

Then add, in the same module family:

1. **Checkout / payment method collection.** A server action that asks the
   provider for a hosted checkout or setup session for the organization and
   redirects the owner there. Store `provider_customer_ref` and
   `provider_subscription_ref` when the provider confirms them.
2. **Plan changes and cancellation.** `changePlan`, `requestCancellation` and
   `withdrawCancellation` currently record the change locally. With a real
   provider they must call the provider first and record the change when the
   provider confirms it (through the webhook), so the two cannot drift.
3. **Quantity.** The worker keeps `subscriptions.quantity` equal to active
   employees. Report it to the provider as the subscription quantity, at most
   once per billing period change, if pricing is per employee.

## Webhooks

- Endpoint: `POST /api/billing/webhook` on the production origin. Register it
  with the provider for payment succeeded, payment failed, payment method
  attached, subscription updated and subscription deleted events.
- Secret: the provider's signing secret, in the host's secret manager, read
  from a new environment variable. Never commit it; never log it.
- Idempotency: the provider's event id becomes the billing event's
  idempotency key (`provider:<name>:<event id>`), unique per organization. A
  retried delivery returns 200 with `duplicate: true` and changes nothing.
- Failures return 5xx so the provider retries. Anything unverifiable returns 404.
- Rate limited per instance (120 per minute); raise if the provider batches.

## Provider account setup (requires approval: it is an account and a cost)

1. Create the provider account under the business's legal entity.
2. Create one product per plan (`pilot`, `essentials`, `multi_location`) and
   monthly prices. Pricing is not decided; the plans screen shows no prices
   until it is.
3. Decide tax collection and invoice settings with an accountant.
4. Configure the customer portal (update card, download invoices).
5. Add live and test signing secrets to the host's secret manager.
6. Run a test-mode checkout, a failed payment and a cancellation against a
   staging workspace and confirm each appears in the billing history.

## Policy that already applies

Trial, active, past due (14-day grace), suspended and canceled behave as
described in [permissions](../permissions.md#subscription-status). Suspension
makes administration read-only; employees keep access to their own records.
Changing that policy is a product decision, not a provider setting.
