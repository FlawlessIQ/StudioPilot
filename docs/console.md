# StudioCue Console

The platform admin, at `/platform-admin`: the StudioCue team's CRM and
operations console. It replaced the eleven read-only pages that listed raw
documents (October 2026).

Every page is a table with saved views, filters, sorting, multi-select and
bulk actions, and every row opens a record or a drawer. Every change goes
through one audited command endpoint.

## Sections

| Rail | Route | What it is |
| --- | --- | --- |
| Home | `/platform-admin` | The morning check: MRR, trials ending, past due, inbox, failed jobs, and **Needs you**, every item that wants a person today |
| Studios | `/studios`, `/studios/[tenantId]` | Every studio as a CRM account. The record has Overview, Timeline, Team, Billing, Usage, Integrations, Feedback, Jobs, Notes, Audit |
| People | `/people`, `/people/[uid]` | Every account: studio staff, couples, crew, Console admins. Password reset, verification, sign out everywhere, disable |
| Inbox | `/inbox` | Feedback from studios, a thread per item: team replies by email, internal notes, studio replies threaded back in |
| Issues | `/issues`, `/issues/[id]` | Bugs and requests, each gathering every piece of feedback about it. Table or board |
| Tasks | `/tasks` | The team's follow-ups on studios, people and issues |
| Subscriptions | `/subscriptions` | Plan and billing state per studio, with the subscription actions |
| Discount codes | `/codes` | Stripe promotion codes, single or in batches, with signup links |
| Revenue | `/revenue` | MRR trend, money collected by month, signup cohorts, invoices |
| Jobs | `/jobs` | Failed background jobs grouped by cause, with what fixes each |
| Integrations | `/integrations` | Every studio's connected apps, and a studios × providers matrix |
| System health | `/health` | Queues against objectives, email delivery, webhooks, the Console's own rollup |
| Data requests | `/data-requests` | Exports and deletion requests; approve deletion once the export is done |
| Feature access | `/features` | Features held back per studio: off, some studios, or every studio |
| Audit log | `/audit` | What happened, who did it, in what role, and why |
| Support sessions | `/support` | Time-boxed, reasoned, read-only summaries of one studio |
| Settings | `/settings` | Console admins and roles, saved replies, health weights, tags, preferences |

Old routes redirect: `tenants`→`studios`, `users`→`people`,
`failed-jobs`→`jobs`, `feature-flags`→`features`, `audit-logs`→`audit`,
`system-health`→`health`, and `feedback?id=` → `inbox?id=` (team emails link
there).

## How it reads

The rail, ⌘K and the studio rows mount once in `app/platform-admin/layout.tsx`
(`components/console/console-frame.tsx`), so moving between pages keeps them.

A table needs one document per row, so the Console reads summary rows rather
than joining collections in the browser:

- `consoleStudios/{tenantId}`: one per studio, built by
  `functions/src/console/rollup.ts` from the tenant, subscription,
  memberships, projects, usage, audit and job records. It holds the plan, MRR,
  trial and renewal dates, setup (x of 6, the same six questions as setup),
  jobs, seats, last active and last sign-in, lifecycle stage and health.
- `consolePeople/{uid}`: one per account, from Firebase Auth (last sign-in,
  method, verified, disabled) and memberships.
- `consoleMetrics/{YYYY-MM-DD}`: the day's totals, for the Revenue trend.

`consoleRollupScheduler` rebuilds them every 15 minutes. A studio's record can
rebuild its own row on demand, and Studios → Refresh rebuilds all of them.
These rows are caches: nothing in them is the source of truth, and the rollup
never writes the fields the Console owns (tags).

Everything else is read live with listeners (`lib/console/live.ts`), so a
command's effect shows without a refresh.

## Lifecycle, health, MRR

All computed on the server (`functions/src/console/model.ts`), tested in
`tests/console-engines.test.ts`.

- **Lifecycle:** suspended, churned, signed up (no card), at risk (past due,
  or health under 50), stalled (trialing, no jobs, quiet 5 days), activated
  (trialing with jobs), setting up, paying.
- **Health:** starts at 100 and loses points per signal. Every deduction is
  shown with its reason on the studio's record. Weights are in Settings
  (`consoleSettings/health`).
- **MRR:** paying subscriptions only. Trials, comps, past due and suspended
  studios count nothing. A yearly price is spread over twelve months. Stripe's
  own unit amount is used when known, so an older price keeps its rate. An
  active discount comes off.
- **Last active:** a heartbeat in `features/auth/workspace-context.tsx` stamps
  `users/{uid}.lastActiveAt` at most once an hour. Firestore rules let a person
  write that one field on their own document.

## How it writes

One endpoint, `saasAdminCommand` (`functions/src/saas/admin.ts`), dispatches
every command from the registry in `functions/src/console/handlers`. For each
call it does the same steps in order:

1. App Check;
2. verified identity;
3. Console role from the token;
4. the handler's capability;
5. the input schema;
6. run;
7. one audit event per studio touched, carrying the admin's email, role and
   written reason.

The browser caller is `lib/console/command-client.ts`. A refusal returns a
code with copy in `lib/ai/friendly-error.ts`; `tests/error-copy-coverage.test.ts`
scans the handlers' `fail("CODE")` calls.

One endpoint is deliberate: every private function needs an invoker binding
and a relay entry, and fewer functions means fewer of those traps.

## Roles

The `platformAdmin: true` claim is still the gate every Firestore rule reads.
`platformRole` refines it:

| Role | Can |
| --- | --- |
| Owner | Everything, including admins, suspension and deletion approval |
| Operator | Studios, billing, discount codes, jobs, feature access |
| Support | Studios, people, the inbox, support sessions. No billing |
| Viewer | Read-only |

An admin with the claim and no role, as every admin set by hand before roles
existed, reads as Owner. Roles are managed in Settings (`setConsoleRole`, owner
only). It sets the claims, revokes the person's sessions so the change applies
at once, and mirrors the admin into `platformAdmins`.
`functions/src/console/roles.ts` is the authority;
`features/console/roles.ts` is the browser's copy for drawing buttons, and a
test keeps them identical.

## Billing

Stripe stays the record of anything Stripe bills. Commands change the Stripe
subscription, then read it back and write it exactly as the webhook would.
Only studios with no Stripe subscription (before the card, or comped locally)
are changed in Firestore alone. Card numbers never pass through: **Send
card-update link** emails the owner a link to their own subscription page,
where Stripe's portal takes the card.

| Command | With a Stripe subscription | Without |
| --- | --- | --- |
| `extendTrial` | moves `trial_end` (a paying studio gets free time) | `trialEndOverride`, honoured by their first Checkout instead of 14 days |
| `setComp` | 100% coupon on the subscription (`compMode: stripe_coupon`) | `status: active`, no card needed (`compMode: local`), optional end date |
| `changePlan` | swaps the price, prorated | updates plan and entitlements |
| `setCancelAtPeriodEnd` | cancel or resume at period end; never immediate from here | — |
| `applyDiscount` | puts a coupon on the subscription | `pendingCouponId`, applied at their first Checkout |

A local comp with an end date is ended by the rollup: the studio goes back to
"add a card". A comped studio that pays is no longer comped. The comp also no
longer breaks Checkout: the comp's far-future period end used to be passed to
Stripe as a trial end.

The Stripe account is shared with AdHelm and ScoreOps. Every Console call pins
`Stripe-Version` (`functions/src/console/stripe-admin.ts`). Every coupon is
limited to StudioCue's two products and tagged `metadata[app]=studiocue`, and
the Console only lists or applies codes carrying that tag.

The webhook now also records `invoice.paid`, `invoice.payment_failed` and
`invoice.finalized` into `saasInvoices` (for Revenue and the studio
timeline). A failed payment stamps `lastPaymentFailedAt` on the subscription.
Subscription events also carry the discount and Stripe's unit amount.

The Stripe account is shared with other products, and the endpoint receives
their invoices too. One is recorded only when it names a studio StudioCue has
(a `subscriptions` record for the tenant, or the customer id on one);
anything else is logged as `ignored` in `webhookEvents`.

MRR uses Stripe's own amount for the subscription when the webhook has
reported it, so a studio on an older price shows what it really pays. List
prices (`PLAN_LIST_PRICE_CENTS`, $150/$1,500 Studio and $299/$2,990
Multi-Brand) are the fallback and what a trial is worth.

`BILLING_MOCK_MODE=true` (the emulator) makes every billing command write what
Stripe would have, without calling it.

## Discount codes

A code is a Stripe promotion code over a coupon. Studios use it the way
Checkout already takes codes (`docs/saas-operations.md`, "Beta and promotion codes"):

- typed into Checkout's own field (`allow_promotion_codes`);
- arriving on a signup link, `/auth/register?code=FALL20`, which applies it at
  Checkout (`features/subscriptions/promotion-code.ts`).

A discount applied to one studio in the Console before they've added a card
(`pendingCouponId`) takes the place of either at their first Checkout.

The Console lists codes it created (`metadata[app]=studiocue`). A code made by
hand in the Stripe dashboard still works at Checkout. It only appears here if
it carries that metadata.

**Generate batch** makes up to 200 single-use codes over one coupon, for a show
or a mailing, downloadable as CSV with each code's signup link. Redemption
counts are synced from Stripe by the rollup and by **Sync** on the Codes page.

## Inbox and issues

Feedback keeps two states apart:

- `status` (received, planned, shipped, closed) is what the studio sees and
  what sends the planned and shipped emails.
- `triage` (new, waiting, linked, closed) is the team's working state.
  Feedback from before the Console derives it (`features/console/inbox.ts`).

A reply from the inbox is a `feedback_reply` email signed "The StudioCue
team". It is refused when the person asked not to be contacted. It is stored
in `feedbackMessages` with `visibleToSender: true`, so the studio sees it on
**Your feedback**. Internal notes are stored with `visibleToSender: false`,
which the rules never show to a studio.

The reply's Reply-To is a signed `feedback+<id>.<sig>@<inbound domain>`
address (`functions/src/feedback/reply-address.ts`). It needs
`INBOUND_REPLY_SIGNING_SECRET` and `SENDGRID_INBOUND_DOMAIN`; without them it
falls back to the team address. The SendGrid inbound dispatcher routes
`feedback+` to `sendgridInboundMessage`, which threads the studio's answer
onto the feedback and puts it back to New.

An issue gathers feedback. Moving it to Planned, In progress or Shipped moves
every linked piece of feedback and emails each person once per status
(`functions/src/feedback/status.ts`, shared with `setFeedbackStatus`). Won't do
and Duplicate close the feedback quietly. Merging moves the feedback and marks
the other issue a duplicate.

## Feature access

`featureFlags/{key}` holds the decision: off, some studios, or every studio.
The Console writes the result onto each studio's `tenantFeatures/{tenantId}`,
which is what the product already reads (`features/contracts/rollout.ts`). No
reader changed, and "every studio" also reaches studios created later, because
the rollup re-applies it.

Only features in the catalog (`functions/src/console/features.ts`, mirrored in
`features/console/feature-catalog.ts`) can be managed. The old flag
collection let anyone create a key that nothing read. A feature joins the
catalog in the same change that adds the code reading it. A feature nobody has
managed yet keeps its hand-set switches, and they are imported the first time
it changes here.

## Suspension

`suspendTenant` (owner only, studio name typed) sets `tenants.status` and
`subscriptions.suspendedAt`. `requireActiveSubscription`, which every studio
command already calls, refuses with `STUDIO_SUSPENDED`, and the studio app
shows "Your studio is paused". Couples' and crew portals stay up, so a
suspension never strands a wedding. Before the Console, suspension wrote only
the tenant's status, which nothing read.

## Data and rules

New collections, all `read: isPlatformAdmin()`, `write: false`:

- `consoleStudios`, `consolePeople`, `consoleNotes`, `consoleTasks`
- `consoleSettings`, `consoleMetrics`, `consoleReplies`
- `platformAdmins`, `issues`, `saasInvoices`, `saasDiscounts`

`feedbackMessages` is also readable by the person the feedback came from, for
replies only (`visibleToSender == true`). Tests:
`tests/firestore-rules-console.test.ts`.

New composite indexes are in `firestore.indexes.json`.

## Deploying

- Functions first. `saasAdminCommand`, `billingCommand`, `stripeWebhook`,
  `feedbackCommand` and `sendgridInboundMessage` changed. The new
  `consoleRollupScheduler` is listed in
  `scripts/configure-production-function-invokers.sh`. Two new templates,
  `platform_message` and `feedback_reply`, live in the shared templates, so
  `operationsTaskWorker` must be redeployed: run the freshness script
  afterwards.
- `stripeWebhook` now binds `STRIPE_SECRET_KEY` and needs the
  `invoice.paid`, `invoice.payment_failed` and `invoice.finalized` events
  enabled on the Stripe webhook endpoint.
- `firebase deploy --only firestore:rules,firestore:indexes` for the new rules
  and indexes.
- After the first deploy, open Studios and choose Refresh to build the rows
  rather than waiting 15 minutes.

## Running it locally

The usual emulator recipe works. With `BILLING_MOCK_MODE=true` in
`functions/.env.local`, every billing command runs without Stripe. Studios →
**Build the rows now** fills an empty Console.

## Not built

- **Deployed-function freshness** isn't visible in the Console. The service
  account would need Cloud Functions read access.
  `scripts/verify-deployed-function-freshness.sh` remains the check.
- **"View as studio"** is not built; support sessions stay read-only summaries
  (`docs/security.md` prohibits routine impersonation).
- **Bulk announcements to studios** are not built. One-to-one email from a
  record is; bulk product mail needs unsubscribe handling first.

## Partners

Added 2026-10-07 (Conor and GR Productions). Vendors such as DJs, hair and makeup artists, planners and venues sell StudioCue to the studios they work with. Later the same program runs the other way: photographers selling to DJs and to hair and makeup, once those journeys exist.

- **Codes.** Billing → Partners → Add partner creates the partner (`saasPartners`) and their Stripe promotion code. Every code points at one shared coupon (`saasSettings/partnerProgram`):
  - 40% off for 12 months on both plans. That covers the 14-day trial and the first annual invoice, so year 1 of Studio is $900 instead of $1,500. Renewal is at full price.
  - Codes are tagged `metadata[kind]=partner`.
  - They're mirrored into `saasDiscounts`, so Discount codes lists them and can deactivate them.
- **Annual only.** Checkout puts any studio using a partner code on the yearly price (`ResolvedPromotion.annualOnly` in `saas/stripe-checkout.ts`). A Stripe coupon can be limited to a product, not to a price.
- **Tracking.**
  - The Stripe webhook writes `saasReferrals/{tenantId}` when a subscription first carries a partner code. The first partner keeps the studio.
  - The referral counts when that studio's first invoice is paid with an amount above zero (`saas/partner-referrals.ts`). A studio that cancels in its trial earns nothing.
- **Commission.** $100 a paid studio. At ten, every one is worth $200, so the first ten earn $2,000 (`features/console/partners.ts`).
  - Payouts are recorded on the partner's drawer (`saasPartnerPayouts`), never sent from the Console.
  - Owed = earned − paid out.
- **Access.** Owners and operators (`partners.write`). Everything is staff-read in the rules and written only by `saasAdminCommand` and the webhook.
