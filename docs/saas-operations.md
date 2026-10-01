# SaaS Operations

Milestone 8 adds the commercial and operational control plane without making
plan names part of domain logic.

## Subscription boundary

Stripe Checkout creates subscriptions and Stripe Customer Portal manages
payment methods, cancellations, and invoices. StudioCue never stores card or
bank data. It stores only tenant-scoped customer, subscription, price, status,
billing-period, and cancellation references.

`billingCommand` requires App Check, a current Firebase identity, and an active
`studio_owner` membership for the requested tenant. The browser resolves the
tenant from that user's membership; no tenant ID is compiled into the live
client.

`stripeWebhook` verifies the timestamped HMAC over the raw body before parsing.
The provider event ID is a create-only idempotency key. Supported subscription
prices resolve to a plan and billing cadence by configured price IDs, never by
parsing human-readable price names.

Required secrets and values:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- monthly and yearly `STRIPE_PRICE_*` values for all three plans
- `NEXT_PUBLIC_BILLING_FUNCTIONS_URL`

Current public list prices are $150/$1,500 for Studio and $299/$2,990 for
Multi-Brand (Solo was retired 2026-08-25; Studio is the entry plan). Annual
prices represent ten months of the monthly price. Stripe price IDs are
immutable references: a pricing change creates new Stripe Price objects while
existing subscriptions retain their historical price until deliberately
migrated.

All production secrets belong in Secret Manager. Public function URLs are
configuration, not credentials.

### Beta and promotion codes

Every subscription Checkout session accepts Stripe promotion codes. There are
two ways in, and Stripe allows only one per session:

- **No code carried in** — the session sets `allow_promotion_codes=true`, so
  Stripe's Checkout page shows "Add promotion code". The card is still
  collected (`payment_method_collection=always`) and the 14-day trial still
  starts; a 100%-off code typed here means the card is saved and never charged.
- **Code carried in a signup link** — `/auth/register?code=BETA` remembers the
  code in the browser (`features/subscriptions/promotion-code.ts`) and sends it
  with `createCheckout`. `billingCommand` looks it up in Stripe
  (`GET /v1/promotion_codes?code=…&active=true`, then the coupon) and, if it
  is active, its coupon is valid, and it is neither expired nor used up,
  applies it with `discounts[0][promotion_code]`. If the coupon is **100% off
  with duration "forever"**, the session also switches to
  `payment_method_collection=if_required` and starts **no trial**: Stripe
  creates an `active` subscription with $0 invoices and never asks for a card.
  Any other code (50% off, 100% for 3 months) keeps the card and the trial. A
  code Stripe won't honour falls back silently to the "Add promotion code"
  field — a stale link never blocks signup.

A $0 subscription is treated exactly like a paid one: access is decided by
status alone (`subscriptionGrantsAccess`: `trialing | active`, mirrored in
`features/subscriptions/entitlements.ts`), and nothing in the app reads invoice
amounts or whether a card is on file. The subscription page reads "Active ·
Renews …". The webhook writes the same record it would for any studio.

If `STRIPE_SECRET_KEY` is a restricted key (`rk_…`), it needs **Read** on
*Promotion codes* and *Coupons* for the signup-link path; without it the lookup
fails and every code falls back to the Checkout field (which still works).

**Owner steps (Stripe dashboard) — do these in test mode first, then live:**

1. *Product catalog → Coupons → Create coupon.* Type "Percentage discount",
   100%, Duration **Forever** (for a free beta account). Leave "Apply to
   specific products" empty or pick the StudioCue products. Name it e.g.
   "StudioCue beta".
2. On the coupon, *Create promotion code.* Code e.g. `BETA2026` (letters,
   digits, `-`, `_`; case-insensitive). Set **Limit the number of times this
   code can be redeemed** to the number of testers, and optionally an expiry
   date and "Eligible for first-time order only".
3. In test mode, walk it: open
   `<staging-or-local-app>/auth/register?code=BETA2026`, sign up, pick a plan —
   Checkout should show the discount, $0 due, and no card form. The studio
   opens as "Active".
4. Repeat steps 1–2 in **live** mode (test-mode coupons don't exist in live).
5. Share either the link `https://studio-cue.com/auth/register?code=BETA2026`
   (applied automatically, no card) or just the code (tester types it on the
   Checkout page; card is collected but never charged).

**Revoking.** Archive the promotion code (*Coupons → the coupon → the code →
Archive*) to stop new signups using it; existing subscriptions keep their
discount. To end a tester's free access, open their subscription in Stripe and
remove the discount — their next invoice charges normally. Studios that signed
up without a card will go `past_due` at that point and the app gate locks until
they add one in the customer portal, so tell them first. Deleting the coupon
also stops new redemptions but does not remove it from existing subscriptions.

An alternative for the owner's own studios is `COMPED_OWNER_EMAILS`
(`functions/src/saas/onboarding.ts`), which skips Stripe entirely; promotion
codes are the path for anyone else.

## Entitlements and usage

The subscription snapshot embeds exact entitlements. Capability checks consume
values such as `maxInternalUsers`, `coiEnabled`, and
`advancedReportingEnabled`; they do not branch on `solo`, `studio`, or
`multi_brand`.

Usage records are tenant/month scoped. AI actions are checked and incremented
before model dispatch in trusted compute. Exhausted quotas return
`AI_MONTHLY_QUOTA_EXCEEDED`; AI cannot decide whether an overage is allowed.
SMS segments and API requests share the same extensible usage record.
Inbound COI extraction consumes quota atomically in the same transaction that
deduplicates the inbound event and queues AI work, so a webhook retry cannot
consume twice.

Plan changes replace the current entitlement snapshot only after verified
Stripe evidence. Historical workflow, price, package, schedule, and contract
snapshots remain immutable.

## Platform operations

`saasAdminCommand` requires the `platformAdmin` Firebase custom claim and App
Check. It supports:

- feature-flag updates;
- reasoned tenant suspension;
- 5–60 minute tenant-specific support grants;
- controlled reruns of failed or dead-letter provider jobs.

Every command appends an audit event. Support grants require an exact tenant ID
and business reason. A grant is authorization context, not user impersonation;
downstream support tooling must verify active, unexpired scope on every access.
Manual reruns reject nonfailed work, preserve job identity/input evidence, and
return work to the queue without manufacturing provider success.

## Health and observability

`operationsHealthScheduler` runs every 15 minutes with bounded retries and
writes normalized health snapshots. Platform administration exposes
subscription state, provider health, failed jobs, flags, audit events, support
access, and system health.

Production logs use correlation, tenant, provider-event, and automation-run
identifiers. Logs and Sentry events must exclude contracts, questionnaire
answers, access codes, OAuth tokens, and document bodies. Alert policies should
cover:

- webhook signature failures and sustained processing errors;
- dead-letter growth;
- reconciliation lag;
- provider disconnects;
- AI quota and provider-error spikes;
- scheduler failures;
- elevated HTTP 5xx rates.

Preview mode is explicit: when function URLs are omitted, UI actions disclose
that no Stripe, support, flag, or job record changed.
