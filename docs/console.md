# StudioCue Console

The platform admin, at `/platform-admin`: the StudioCue team's CRM and
operations console. It replaced the eleven read-only pages that listed raw
documents (October 2026).

Every page is a table with saved views, filters, sorting, multi-select and
bulk actions, and every row opens a record or a drawer. Every change goes
through one audited command endpoint.

## Sections

The rail leads with growth and customers (Conor, 2026-10-07). **System** is
folded until opened, or while one of its pages is open; it shows a count when
something inside it waits.

| Rail | Route | What it is |
| --- | --- | --- |
| Home | `/platform-admin` | The morning check: MRR, signups, trial → paid, trials ending, past due, where the month's signups came from, and **Needs you**, every item that wants a person today |
| **Grow** · Pipeline | `/pipeline` | Photographers who might become studios: Book a demo requests and anyone added by hand, as a board or table, each with an owner and a next step |
| Grow · Sources | `/sources` | Where studios come from, by channel, referring studio, link and campaign, and which go on to pay. File a studio under a channel by hand |
| Grow · Referrals | `/referrals` | Studios referred with another studio's code, the one-off $100 credits, and the vendors invited |
| Grow · Discount codes | `/codes` | Stripe promotion codes, single or in batches, with signup links |
| **Customers** · Studios | `/studios`, `/studios/[tenantId]` | Every studio as a CRM account. The record has Overview, Timeline, Team, Billing, Usage, Integrations, Feedback, Jobs, Notes, Audit |
| Customers · Lifecycle | `/lifecycle` | Studios at risk with one play each, trials by days left, and who moved between stages |
| Customers · People | `/people`, `/people/[uid]` | Every account: studio staff, couples, crew, Console admins. Password reset, verification, sign out everywhere, disable |
| Customers · Inbox | `/inbox` | Feedback from studios, a thread per item: team replies by email, internal notes, studio replies threaded back in |
| Customers · Issues | `/issues`, `/issues/[id]` | Bugs and requests, each gathering every piece of feedback about it. Table or board |
| Customers · Tasks | `/tasks` | The team's follow-ups on studios, people and issues |
| **Money** · Revenue | `/revenue` | MRR trend, money collected by month, signup cohorts, invoices |
| Money · Subscriptions | `/subscriptions` | Plan and billing state per studio, with the subscription actions |
| **System** · Jobs | `/jobs` | Failed background jobs grouped by cause, with what fixes each |
| System · Integrations | `/integrations` | Every studio's connected apps, and a studios × providers matrix |
| System · System health | `/health` | Queues against objectives, email delivery, webhooks, the Console's own rollup |
| System · Data requests | `/data-requests` | Exports and deletion requests; approve deletion once the export is done |
| System · Feature access | `/features` | Features held back per studio: off, some studios, or every studio |
| System · Audit log | `/audit` | What happened, who did it, in what role, and why |
| System · Support sessions | `/support` | Time-boxed, reasoned, read-only summaries of one studio |
| System · Settings | `/settings` | Console admins and roles, saved replies, health weights, tags, preferences |

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

## Referrals

Added 2026-10-08 (Conor). It replaces Partners (2026-10-07), whose codes, payouts, 1099s and statement links are gone: no partner was ever created.

- **Every studio has a code.** It's made the first time anything asks for it (`ensureReferralCode`, `saas/referrals.ts`), from the studio's name (GRPRODUCTIONS). It lives in `saasReferralCodes/{CODE}` and `tenants/{id}.referralCode`, and shows with its link on the studio's Subscription page (Refer a studio, owners only).
- **The offer** is for the Studio plan, on a studio's first checkout, never with its own code:
  - 14 days free, then $75/month billed yearly for the first year ($900), or $100/month billed monthly for the first 12 months. After that, list price.
  - It isn't a Stripe promotion code. `billingCommand` looks the code up and applies one of two amount-off coupons made once (`saasSettings/referralProgram`): $600 off the annual price, or $50 off the monthly. Both last 12 months from checkout, which covers the first annual invoice (14 days in) but not its renewal. Not `duration: once`, which a trial's $0 first invoice would use up. A single coupon can't be both.
  - The code rides on the subscription's metadata, so the webhook records `saasReferrals/{tenantId}` only once Checkout completes. The first referrer keeps it.
- **The credit.** $100 per referred studio, once, on the referrer's Stripe customer balance, which comes off their next invoice. Conor, 2026-10-08: raised from $50, and paid only once the referral has been live three months.
  - Due three months after the referred studio's first paid invoice above $0 (`creditDueAt`), if it's still `active` and hasn't scheduled its cancellation.
  - `referralCreditScheduler` runs daily at 14:00 UTC. Canceled before then = forfeited; past due, or a referrer with no Stripe customer = held, looked at again the next day.
  - One balance credit per referral (`saasReferralCredits/{referred tenant}`, Stripe idempotency key to match), then a `billing_referral_credit` email.
- **Vendor invites.** `vendorInviteScheduler` runs daily at 15:30 UTC over vendors changed in the last three days.
  - Who gets one: a vendor (planner, florist, DJ, band, videographer, hair and makeup, caterer, transportation, other; never venues, insurers or clients' contacts) on an upcoming booked job that isn't an imported, quiet one.
  - Which studios: trialing or active, with invites on (the default; the studio's Refer a studio card turns them off).
  - Once per address, ever (`vendorInvites/{sha256(email)}`). Never to an existing StudioCue user, a client of that studio, or anyone unsubscribed.
  - At most 10 per studio and 200 per run.
  - The email is StudioCue's letterhead, `tenantId: "platform"`, naming the studio, with a one-click unsubscribe header and link (`/api/public/unsubscribe` → `emailSuppressions`), which the sender checks again before sending.
- **Console → Grow → Referrals** is read-only: referred studios and their credit state, credits added, vendors invited and signups from them. Sources files these studios under **Studio referral**.

## Sources

Added 2026-10-07 (Conor): which channels and referrals bring studios in, and
which of those studios pay. Grow → Sources, plus a panel on Home.

- **Recorded at signup**, once, to `saasAttribution/{tenantId}` by
  `tenantOnboardingCommand` (staff-read, never studio-readable):
  - **The link.** `components/growth/attribution-capture.tsx` runs on every
    page and keeps, in the visitor's browser only, the first and latest page
    load that said anything: `utm_source/medium/campaign/content`, an outside
    referring site (host only), and `?code=`/`?ref=`. Nothing is kept for a
    browser sending Global Privacy Control. It reaches us only if they create
    a studio. Disclosed in the cookie notice (1.1).
  - **What they said.** "How did you hear about StudioCue?" on the
    create-your-studio step, optional, with "Who?" for a photographer or vendor.
  - The promotion code they carried.
  - A malformed record is dropped; it never stops a signup.
- **One channel per studio** (`features/console/sources.ts`): filed by hand,
  then another studio's referral code (`saasReferrals`, or a studio's code on the link),
  then what they said, then the link, then Direct. Studios from before
  2026-10-07 show as **Before tracking** until someone files them.
  - What they said beats the link because a link records the last click:
    someone told by another photographer often arrives by searching.
  - The page also shows the link on its own ("The link they arrived on").
- **Funnel.** Signed up → added a card (in a trial or beyond) → paying
  (`active`, `past_due`, `unpaid`, `paused`). Comped studios are left out of
  every rate.
- **Top referring studios** and **From vendor invites** count all time:
  studios referred, and how many pay.
- **File by hand.** Click a studio: the drawer shows everything recorded and
  lets staff (`crm.write`) file it under a channel with a detail
  (`setStudioSource`, audited). Clearing it goes back to what was recorded.
- **Tag your links.** Instagram bio, posts and ads should carry
  `?utm_source=instagram&utm_campaign=<name>` so they show by campaign.

## Pipeline

Added 2026-10-07 (Conor): selling StudioCue, before a studio exists.

- **Leads** are `saasLeads/{id}` (staff-read). Stages New → Contacted → Demo
  booked → Lost are set by a person (`createLead`, `updateLead`, `deleteLead`,
  `crm.write`, audited). Once the photographer signs up with the same email,
  `tenantOnboardingCommand` links the lead to the studio and the studio
  decides the stage: In trial, Won (paying or comped), Lost (canceled)
  (`features/console/pipeline.ts`).
- **Book a demo** is `studio-cue.com/demo` (marketing nav, hero and footer;
  hidden from the phone header, where Sign in stays). It posts to
  `app/api/public/demo` (a Next route, not a Function): App Check, a honeypot
  and five an hour per visitor. It files a New lead with "Reply and book the
  demo" due today, or reopens a Lost one with the same email. Nothing is sent
  to the address typed in.
- **Who hears.** System → Settings → Book a demo (`setGrowthSettings`,
  `consoleSettings/growth`): the address that gets a `platform_demo_requested`
  email (Reply-To the photographer) and an optional calendar link offered as
  "Pick a time" after the form. Unset, nobody is emailed and the request still
  shows on Pipeline, Home and the rail count.
- **Needs you.** A New lead, or a next step due today or earlier, counts on the
  rail and shows on Home.
- Notes on a lead use `consoleNotes` with `subjectKey` `lead:<id>`.

## Lifecycle

Added 2026-10-07. Customers → Lifecycle.

- **At risk**: stalled, at risk, or a Poor health score; comped, suspended and
  churned studios are left out. Payment trouble first, then trials ending
  within three days, then the lowest score. Each row has one play
  (`features/console/lifecycle.ts`): the biggest thing costing the studio
  points, what to do about it, the record tab to do it on, and a Task button
  that writes the task.
- **Trials**: every studio in a trial by days left, with setup, jobs and last
  activity.
- **Moves**: `consoleLifecycleEvents`, written by the rollup
  (`refreshStudioSummary`) when a studio's stage changes. Recorded from
  2026-10-07; a studio's first row is not a move.

