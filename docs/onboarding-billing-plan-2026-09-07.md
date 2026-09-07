# Onboarding billing plan — card-required, Stripe-driven trial (2026-09-07)

## Decision
A new studio must **complete Stripe Checkout (card on file) to start its trial.**
This replaces today's local, no-card trial. The trial becomes a *real Stripe
subscription in trial* — Stripe manages the 14 days, charges the card at trial
end (or the studio cancels), and webhooks drive status thereafter. This closes the
enforcement gap found on 2026-09-07 (a no-card `trialing` subscription never
expired because status only changes via a Stripe webhook that never fired, and the
entitlement/AI guards check `status` but never `currentPeriodEnd`).

Trade-off to accept: card-up-front raises signup friction and lowers top-of-funnel
conversion vs a "no credit card required" trial. That is the intended exchange for
real, enforceable trials and no free-forever tenants.

## Target flow
```
register (account)  →  onboarding (create workspace)  →  Stripe Checkout
   [existing]            [tenant + pending sub]           [card + 14-day trial]
                                                                │
                       app unlocked  ←  provision on return  ←──┘  (+ webhook backup)
```
1. **Register** — unchanged (Firebase account).
2. **Onboarding** — `tenantOnboardingCommand` still creates the tenant + membership,
   but the subscription is written in a **not-yet-usable** state
   (`status: "incomplete"`, `stripeSubscriptionId: null`, `checkoutRequired: true`).
   No entitlements are granted yet.
3. **Checkout** — onboarding immediately starts a Stripe Checkout session
   (`mode: subscription`, the selected plan's price, `subscription_data[trial_period_days]=14`,
   `payment_method_collection: "always"` so the card is required during the trial,
   `client_reference_id`/`subscription_data[metadata][tenantId]` = tenantId) and
   redirects the browser to it.
4. **Return + provision** — success URL returns to `/studio/welcome` (or `/studio`).
   The return handler **retrieves the session server-side**, confirms the
   subscription was created, and writes the real `subscriptions/{tenantId}`
   (stripeCustomerId, stripeSubscriptionId, stripePriceId, `status: "trialing"`,
   `currentPeriodEnd = trial_end`, entitlements from the plan, `checkoutRequired:false`).
   The `customer.subscription.created` **webhook is the backup** for the same write
   (idempotent on the Stripe event id), covering the race where the redirect lands
   before the webhook, or the user closes the tab before returning.
5. **App unlock** — the workspace is gated until the subscription is Stripe-backed and
   `status ∈ {trialing, active}`. Until then the app routes to "Finish setup — add a
   card to start your trial" (re-opens Checkout).

## States
`subscriptions/{tenantId}.status`:
- `incomplete` — tenant created, checkout not completed. **No access.**
- `trialing` — Stripe trial live (card on file). Full access. Set by session
  provision / webhook.
- `active` — trial converted (charged). Full access.
- `past_due` / `paused` — payment problem. Access refused by the guards.
- `canceled` — access refused.

Enforcement is now real: Stripe emits `customer.subscription.updated/deleted` and
`invoice.payment_failed`, the webhook writes the new status, and the guards refuse
anything outside `{trialing, active}`.

## Work by layer

### features/ (deterministic core)
- `features/subscriptions/` — add the `incomplete` status + a small pure helper
  `subscriptionGrantsAccess(status)` returning true only for `trialing`/`active`,
  used by both server guards and the app gate. (Removes the duplicated
  `["trialing","active"].includes(...)` literals in `entitlement-guard.ts` and
  `usage.ts`.)

### functions/ (commands + webhook)
- `functions/src/saas/onboarding.ts` — write the subscription as `incomplete` /
  `checkoutRequired: true`, **no entitlements**, instead of `trialing` with full
  entitlements. Return a signal that checkout is required (and optionally the
  Checkout URL, or let the client call the billing command).
- `functions/src/saas/stripe.ts` `createCheckout` + `stripe-checkout.ts`
  `buildStripeCheckoutParams`:
  - For first checkout (no `customerId`), keep `customer_email` prefill (P11 done),
    set `subscription_data[trial_period_days]=14` (first trial) — the existing
    `trial_end` honouring (P10) still applies to re-checkouts.
  - Set `payment_method_collection: "always"` so a card is required despite the trial.
  - Pin `payment_method_types[0]=card` (folds in the deferred **P11-methods** fix).
  - Ensure `subscription_data[metadata][tenantId]` **and** `client_reference_id` are
    set so the webhook and the return handler both resolve the tenant.
- **New**: a `provisionCheckoutSession` path (command or the existing webhook +
  a return handler) that, given a completed session, upserts the subscription doc.
  The webhook already handles `customer.subscription.*` by `metadata.tenantId`;
  confirm the created subscription carries that metadata, then this "just works"
  as the backup. Add synchronous provisioning on the success return so unlock isn't
  webhook-latency-bound.
- Guards (`entitlement-guard.ts`, `usage.ts`) — switch to
  `subscriptionGrantsAccess(status)`. (No `currentPeriodEnd` hack needed once Stripe
  drives status — that was only required to patch the no-Stripe trial.)

### lib/ + app/ (routing + gate)
- `features/auth/onboarding-form.tsx` — on `tenantOnboardingCommand` success, instead
  of `router.replace("/studio")`, call the billing command to create the Checkout
  session and redirect to its URL.
- **App gate** (app-shell / a studio-route guard): if the active tenant's subscription
  is `incomplete` / not Stripe-backed, route to a "finish setup / add a card" screen
  that re-launches Checkout, rather than showing the workspace.
- Success (`/studio/welcome`) and cancel return pages: success provisions + welcomes;
  cancel explains the trial hasn't started and offers to resume Checkout.

## Edge cases to handle
- **Abandoned checkout** — tenant exists as `incomplete`; next login routes back to
  Checkout. Stripe sessions expire (~24h); create a fresh session on demand.
- **Redirect-before-webhook race** — success handler provisions synchronously from the
  retrieved session; webhook is the idempotent backup. Never double-write (guard on
  Stripe event/subscription id).
- **Back button / re-submit** — onboarding already guards double-submit; the gate makes
  re-entry idempotent (same tenant, resume checkout).
- **Card declines at trial end** — Stripe → `past_due` → webhook → guards refuse →
  UI prompts to update the card via the existing Customer Portal (`createPortal`).
- **Plan choice** — default to Studio; allow choosing monthly/annual in onboarding or
  keep the plan-switch on `/studio/subscription`. Decide before build.

## Decisions (resolved 2026-09-07)
1. **Gate the whole product.** Every sensitive command requires a `trialing`/`active`
   subscription — not just AI + the 3 premium capabilities. See "Whole-product gating".
2. **Default to Studio** at signup; tier changes later on `/studio/subscription`.
3. **Monthly** cadence — the trial converts to the Studio monthly price at day 14.

## Whole-product gating (from decision 1)
Add one shared gate and apply it at the top of every command endpoint, right after
identity + tenant-membership resolve and before any business work:

```
await requireActiveSubscription(db, tenantId);  // throws ACTIVE_SUBSCRIPTION_REQUIRED
```

- Backed by the same `subscriptionGrantsAccess(status)` helper (true only for
  `trialing`/`active`). `requireEntitlement` keeps its extra per-capability check on
  top for COI / custom workflows / advanced reporting.
- **Apply to every HTTP command function**, e.g. `crmCommand`, `proposalCommand`,
  `bookingCommand`, `planningCommand`, `aiScheduleCommand`, `postEventCommand`,
  crew commands, workflow commands, questionnaire/COI commands — grep
  `onRequest(` under `functions/src` for the full set and cover each.
- **Deliberate exceptions** (must NOT be gated, or the studio can never recover):
  `tenantOnboardingCommand` itself, the billing commands (`createCheckout` /
  `createPortal` / session provision), auth/email commands, and all client- and
  crew-facing endpoints (the couple and subcontractors are not the paying party —
  gating them would punish the studio's clients for the studio's billing state).
- **Guard:** a source-scanning ratchet test (like `tests/functions-relay-allowlist`)
  asserting every studio command endpoint calls `requireActiveSubscription`, with an
  explicit allow-list of the exceptions above — so a newly added command can't
  silently ship ungated.
- Note: gating client/crew endpoints is out of scope by design; a lapsed studio
  blocks the *studio's* own actions, while already-delivered client portals keep
  working (revisit only if you want to freeze client access on non-payment).

## Stripe facts (verified via CLI, live acct_1SI7vM… "FlawlessIQ", 2026-09-07)
Products already exist and are correctly named (the line item shows "StudioCue Studio"):
- **StudioCue Studio** `prod_Uxv7AAYfa2d35V` — monthly `price_1U8nZQLGQiWq4P2Mw4Me70Zc` ($250),
  annual `price_1U8nZWLGQiWq4P2MiZMiX8bn` ($2,500). **Default = Studio monthly.**
- **StudioCue Multi-Brand** `prod_Uxv87FSWAbRKLd` — monthly `price_1TxzIQLGQiWq4P2MLGaD3bLy`
  ($399), annual `price_1TxzIQLGQiWq4P2MMrnKnyoK` ($3,990).
- StudioCue Solo `prod_Uxv7UhstYhaUIl` — inactive (retired).

Code already reads `STRIPE_PRICE_STUDIO_MONTHLY` etc.; the deployed value resolves to the
active $250 monthly price, so **no price-config change is needed** — onboarding just calls
`createCheckout(plan=studio, cadence=monthly)`.

**Item 2 (statement descriptor) — DECIDED 2026-09-07: accept as-is.** No code change.
Stripe subscription-mode Checkout takes no per-session statement descriptor, and the
account descriptor (`FLAWLESSIQ`) is shared. The checkout line item already reads
"StudioCue Studio" (what the buyer sees they're buying); only the merchant/statement
name stays FlawlessIQ. Revisit only if a separate Stripe account is ever warranted.

**Branding reality (P9):** the merchant/business name (`FlawlessIQ`) and statement
descriptor (`FLAWLESSIQ`) are **account-level**, shared with AdHelm/ScoreOps — they can't be
renamed to StudioCue without relabelling those products. Levers: (a) set a per-subscription
statement descriptor "STUDIOCUE" on StudioCue subscriptions (small code add, fold in here);
(b) product/line-item already says "StudioCue Studio" ✓; (c) a true "StudioCue" merchant name
needs a separate Stripe account — deferred, Conor's call.

## Testing
- **Stripe test clock** in a test/staging Stripe account to simulate day-14 conversion
  and card-decline → `past_due`, verifying the webhook + guards.
- e2e: onboarding → Checkout (test card) → return → workspace unlocked; abandon →
  gated → resume.
- Unit/guard: `subscriptionGrantsAccess` truth table; onboarding writes `incomplete`
  with no entitlements; checkout params set trial + `payment_method_collection:always`
  + card-only + `metadata.tenantId`.
- Rules tests: an `incomplete`/non-Stripe subscription cannot perform guarded work.

## Migration
No real customers yet (per CLAUDE.md), so no production migration. Any leftover
local-trial fixtures are throwaway. Ship behind the normal gate (typecheck, tests,
lint, build, functions build) and the deploy protocol (functions first + invoker
script + explicit App Hosting rollout, verified on the commit).

## Relationship to the deferred plan
- Folds in **P11-methods** (card-only checkout) as part of the checkout params change.
- **P9** (Stripe public name = StudioCue) should land first — it's now the *first*
  screen every new studio sees.
- **P19** (durable client sign-in) is unrelated to studio billing and stays separate.
- The read-time `currentPeriodEnd` stopgap from the 2026-09-07 finding is **not needed**
  if this ships, because Stripe drives status — but ship a guard test asserting a
  non-Stripe / `incomplete` subscription is refused, so the old gap can't silently
  return.
```
