# Autopay spike: instalments that collect themselves (2026-09-15)

**Question:** can a couple save a payment method at booking so the final balance
(and any instalments) are charged on their due date, without the studio chasing?

**Answer:** yes through QuickBooks Payments, with a scheduler we own and one
extra OAuth scope. **Built on 2026-09-15** (see "What was built" below); it
cannot be verified end to end until a studio has an approved QuickBooks Payments
merchant account and StudioCue's Intuit app is approved for the payments scope.

## What exists today

- QuickBooks Online is connected with the **accounting** scope only
  (`functions/src/integrations/oauth.ts`: `com.intuit.quickbooks.accounting`).
- The retainer and final invoices are created in QuickBooks; the couple pays on
  QuickBooks' hosted invoice page (`InvoiceLink`); status syncs back and the
  booking sequence reacts to "paid" (`functions/src/booking/orchestration.ts`).
- The final invoice is raised ~28 days before the event; the "final balance
  summary" message is approve-to-send, and can now be switched to automatic via
  the trust dial (`features/messaging/trust-dial.ts`).

So the couple is always *asked* to pay; nothing pays *for* them.

## What QuickBooks Payments offers

- **Tokens** — card details go from the browser straight to Intuit and come back
  as a one-time token (15-minute life). StudioCue never touches the card number,
  which keeps us out of PCI scope beyond SAQ-A-style handling.
- **Cards (customer wallet)** — a token can be saved to a customer's wallet and
  retrieved later by card id.
- **Charges** — a saved card can be charged for an amount.
- **No scheduling** — the API does not charge on a schedule; the integrator runs
  the schedule.
- **Not linked to invoices** — a charge is a Payments object; marking the QBO
  invoice paid needs a `Payment` recorded against it through the Accounting API.
- Requires the **`com.intuit.quickbooks.payment`** scope and a QuickBooks
  Payments merchant account on the studio's company.

Sources: Intuit Developer — "What you can do with the QuickBooks Payments API";
Intuit Developer Community blog — "Recurring Billing with the QuickBooks Payments API".

## Recommended design (when a pilot studio has QuickBooks Payments)

1. **Consent at deposit.** On the portal's deposit step, offer "Save this card for
   the final balance" with the amount and due date shown. Tokenise with Intuit's
   client library; send only the token to a new `savePaymentMethod` portal
   command, which stores the card in the Intuit wallet and records
   `paymentMethods/{id}` (last4, brand, expiry, consent text + timestamp + IP) on
   the project. Never store card data.
2. **Scheduler.** A daily scheduled function finds final/instalment invoices due
   today with an active saved method and consent, and queues
   `charge_saved_card` provider jobs (idempotency key = invoice id + due date).
3. **Charge and reconcile.** The job creates the Payments charge, then records a
   QBO `Payment` against the invoice. The existing reconcile/webhook path marks
   the invoice paid, and the final-balance evidence follows.
4. **Failure path.** A declined charge sends the couple the hosted invoice link
   (today's flow) and surfaces one Today item for the studio. Retry once after
   three days; never loop.
5. **Couple controls.** The portal shows the saved card and a "remove card"
   action; removing it returns to pay-by-link.
6. **Scope upgrade.** Add `com.intuit.quickbooks.payment` to the QuickBooks OAuth
   request; existing connections must reconnect to grant it. Detect the missing
   scope and keep pay-by-link.

## Alternative

Stripe (client payments via Connect) supports saved payment methods and
off-session charges natively, but adds a second money system beside QuickBooks
for studios that already reconcile there. Prefer QuickBooks Payments for studios
on QuickBooks; revisit Stripe only for studios without it.

## What the studio (or a pilot) must provide to build and verify

- A QuickBooks company with QuickBooks Payments enabled (sandbox for development,
  a real merchant account for the pilot).
- Re-authorising the QuickBooks connection with the payments scope.

## What was built (2026-09-15)

- **Rules** — `functions/src/billing/autopay-core.ts` (charge timing, one retry
  after 3 days, max 2 attempts, failure codes, consent wording) and
  `features/billing/autopay.ts` (studio setup state). Tests: `tests/autopay.test.ts`.
- **Permission** — `integrationOAuth` accepts `payments: true` for QuickBooks and
  adds `com.intuit.quickbooks.payment`; the connection records the scopes it
  actually requested. Normal QuickBooks connects are unchanged.
- **Studio** — Integrations → Autopay (`components/integrations/autopay-settings.tsx`)
  leads with "You need QuickBooks Payments first" and how to apply, then three
  steps: connect QuickBooks, reconnect for payments, offer autopay
  (`setAutopay` command; refuses without the payments scope). Invoices shows a
  one-line pointer (`autopay-hint.tsx`) until autopay is on.
- **Couple** — payments page card (`components/client/client-autopay.tsx`),
  offered once a deposit invoice exists. Card details are tokenised in the
  browser directly with Intuit; the portal route (`autopay_status`, `save_card`,
  `remove_card`) stores the server-written consent text, amount, date, IP and
  user agent on `paymentMethods/{id}` and an audit event.
- **Jobs** — `save_quickbooks_card` (Intuit wallet `createFromToken`),
  `remove_quickbooks_card`, `charge_saved_card` (Payments charge with Request-Id
  idempotency, then a QBO `Payment` linked to the invoice, then the existing
  reconcile job). Records in `autopayCharges/{jobId}`.
- **Scheduler** — `autopayScheduler`, daily 15:00 UTC.
- **Emails** — `autopay_charged` (receipt) and `autopay_charge_failed` (with the
  invoice link; says whether a retry is coming). Studio notifications on declines
  and on "QuickBooks Payments isn't active".
- **Config** — `QUICKBOOKS_PAYMENTS_TOKEN_URL` (app, default production tokens
  endpoint) and `QUICKBOOKS_PAYMENTS_BASE_URL` (functions, optional override;
  sandbox is inferred from a sandbox accounting base URL).

### Still to verify with Intuit sandbox / a pilot

- That Intuit's tokens endpoint accepts the browser request (CORS) from
  studio-cue.com. If not, tokenise through Intuit's JS library instead.
- The charge → Payment → reconcile path against a real sandbox company.
- Intuit app approval for the payments scope in production.
