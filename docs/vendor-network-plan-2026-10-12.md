# Vendor network: capture every wedding's vendors, offer them StudioCue

**Status: Phases 0–4 built 2026-10-13 on Conor's go-ahead with every
recommendation (D1–D6 as below). Phase 0 landed with the planner (e8cd9a3e).
Not yet deployed; counsel on controller use is still owed before the offer
and the database are relied on (see "Legal and privacy").**

What changed from the plan as written:

- **Readiness**: no new checkpoint. The vendor team panel already says where
  the couple's list stands ("listed 6", "no other vendors", "asked, due when
  the details lock"), the lock-day sign-off enforces D3, and a checkpoint
  would break the vendor trades' burden budget (4 checks, tests/vendor-burden).
- **The couple's save** goes through the portal route (`server/vendors/couple-team.ts`,
  the shot list's pattern), not `planningCommand`: the route already checks
  the client and the job before any handler runs.
- **A planning studio's couple is never asked**: the planner builds the team,
  and a month-of couple lists theirs on the Final details form.
- **The offer's code is claimed once**, by one studio, rather than bound to
  the address it was sent to: a DJ who signs up from another inbox still
  gets it, and the code doesn't go round.
- **The sweep's invites carry the offer too**, so a vendor-plan vendor who
  never gets a timeline still hears it once.
- **The email offer is once ever** (the first time StudioCue writes to the
  address); later timelines carry none. The share page shows it each visit.

## The idea in one paragraph

Every wedding a StudioCue studio works has four to ten other vendors on it: a
DJ, a planner, hair, makeup, a florist, a videographer, a photographer. Today
StudioCue barely knows they exist: the couple types "Planner or coordinator"
into a free-text field, and the studio sometimes adds a vendor record by hand.
We ask the **couple** for their vendor team in the portal, before the final
schedule goes out, and position it as what it really is: **everyone working the
day needs the same schedule and needs to be able to reach each other.** The
studio gets a complete contact sheet for free. Each vendor gets their part of
the schedule. A vendor who doesn't run on StudioCue gets an offer. StudioCue
gets a growing, cross-studio database of working wedding vendors, by trade and
region, for marketing and business development.

The couple's reason, the studio's reason and our reason all point the same way.
That is what makes this worth building first, ahead of any paid acquisition.

## What already exists (build on it, don't fork it)

| Piece | Where | State |
|---|---|---|
| Studio vendor directory | `vendors` (`features/vendors/schema.ts`) | Live. Linked to jobs only by `projectIds`. |
| **Per-job vendor team** | `projectVendors/{projectId}_{entryId}`, `features/vendors/team.ts`, `functions/src/planning/vendor-team.ts` | **Built on branch `planner-journey` (95ae3e82), walked in the emulator, not on main, not deployed.** Status, arrival, contact snapshot, contact sheet print, crew projection without money. |
| Timeline to every vendor in one press | `sendTimelineToVendorTeam` + `vendor_timeline` email (same branch) | Branch only. |
| Vendor's read-only run of show | `/share/[token]`, `scheduleShares`, `features/schedules/vendor-share.ts` | Live since da108da. View + confirm. |
| Final details lock + couple sign-off | `functions/src/planning/final-details.ts`, `detailSignoffs` | Live. Lock day = 28 days out by default. |
| A dated ask in the couple's portal | Shot list upload: `features/planning/shot-list.ts`, `functions/src/planning/shot-list-upload.ts`, `app/client/shot-list`, Today inbox | Live. **The pattern to copy.** |
| Vendor invites (once ever, per address) | `functions/src/saas/vendor-invites.ts`, `vendorInvites/{sha256}`, `emailSuppressions` | Live. Daily sweep of studio-entered vendors on booked jobs. Live trades only. |
| Vendor Pro plan | $100/mo, $1,000/yr since 2026-10-14 (was $75 / $750), `STRIPE_PRICE_VENDOR_*` | Live. Every code (the vendor offer, studio and partner codes) gives 50% off for 12 months: $50/mo or $500 the first year (2026-10-14). |
| Referral codes, partner codes, attribution | `saasReferralCodes`, `saasReferrals`, `saasAttribution`, Console Sources + Partners (2d2a845f) | Live. |

So the per-job record, the vendor send and the share page are done or nearly
done. What's missing is the **couple as the source**, the **final schedule
gate**, the **vendor offer**, and the **cross-studio database**.

## The flow

1. **Couple, ~6 months out** (with the planning form, `tenants.planningTimeline`):
   portal shows "Your vendor team — so everyone working your day has the same
   schedule and can reach each other." One screen: a row per vendor (kind,
   business, name, email, phone). Prefilled with anything the studio already
   added and anything the couple wrote in a form. Or one tap: "No other
   vendors" / "The venue handles it". ~2 minutes.
2. **Studio**: nothing to do. Today shows "Maya & Sam added 6 vendors". The
   job's vendor team panel fills in. The studio can fix or add rows.
3. **Lock day (4 weeks out)**: the couple's final details sign-off now includes
   the vendor list. They confirm it with the rest. Chased like the rest.
4. **Final schedule published**: the PDF and every vendor's share page carry
   "Who's working this day" (business, contact, phone, arrival). The studio
   presses one button, preselected, to send each vendor their part.
5. **Vendor**: gets the schedule email and link. If their trade has a
   StudioCue journey and they are not a subscriber, the email and the share
   page carry the offer: "[Studio] runs this wedding on StudioCue. Run your own
   DJ bookings on it — [discount] because you worked this one."
6. **StudioCue**: every booked vendor with an email lands in the platform
   vendor database (business contact details only — never the couple, never
   the wedding). Console → Grow → Vendors shows them by trade and region,
   weddings seen, studios seen, offer state, signed up.

## Phases

### Phase 0 — Land the vendor team (≈ 1 day)

- Rebase `planner-journey` (95ae3e82) onto main; it adds `projectVendors`,
  the panel, the contact sheet and the one-press send.
- Gates, then **deploy all functions** (`email-templates.ts` is shared — the
  render worker trap) and the app. Run the freshness script.
- The branch belongs to another session (cfe42ea2). **Check `ListAgents` and
  message it before touching the branch.**
- `vendorTeam` stays "quiet" for studios; the couple ask below is what fills
  it for every trade.

### Phase 1 — The couple adds their vendors (≈ 3–4 days)

Copies the shot list upload, end to end.

- **Core** `features/vendors/couple-team.ts`: the ask's schema (kind,
  company, contact name, email, phone; email *or* phone required), the "none"
  answer, dedupe (same email or same normalized phone on one job = one row),
  and `vendorAskOpens(eventDate, planningTimeline)` / `vendorAskDue` (lock day).
- **Prefill**: existing team entries, plus free-text answers the couple
  already gave (`planner`, `videographer`, `florist` fields in the starter
  form; `job-facts.ts` vendor facts). A prefilled row is a suggestion until the
  couple saves.
- **Command** `submitVendorTeam` in `planningCommand`, client role, portal
  relationship check (step 4 of the trust order), rate-limited. Writes
  `projectVendors` entries with **`source: "couple"`** and status `booked`.
  Matches the studio directory by email within the tenant; otherwise creates
  a `vendors` record flagged `addedByClient`. Never touches another tenant's
  data.
- **Guards** (the six from ADR 0005): no ask on imported, paused, cancelled,
  on-hold, archived or past jobs. A row whose email is the couple's or one of
  the studio's crew is refused (one address, one role).
- **Portal**: `app/client/vendors`, mobile-first compact rows + a sheet per
  vendor (never expanded cards). A home card while open; reminders ride the
  planning-form reminders, not a new email series.
- **Studio**: Today item when the couple saves; job vendor team panel shows a
  "Added by the couple" tag. Cue can read the team (job facts).
- **Words**: `tradeVocab()` throughout. A DJ studio's couple is asked about
  their photographer like any other vendor.
- **Planner-led weddings** (`timelineAuthority: "planner"`): the planner is
  prefilled at the top; the studio can mark "The planner handles vendors",
  which closes the ask.

### Phase 2 — The final schedule needs it (≈ 2–3 days)

- **Sign-off**: the lock-day snapshot (`FinalDetailsSnapshot`) gains `vendors`
  (kind, company, contact); it is part of the hash the couple confirms. An
  open vendor ask on lock day is folded into the sign-off rather than chased
  separately.
- **Readiness**: a soft check, "Vendor contacts in" — answered, or "none".
  **Never booking-gate evidence** (vendor-coordination-model guardrail).
- **Publish**: the run-of-show publish warns, never blocks: "2 vendors have no
  email — they won't get the schedule." The studio can always send.
- **Contact sheet on the schedule**: "Who's working this day" on the PDF, on
  each vendor's share page, and on the crew day sheet (crew projection
  already strips money). Only booked vendors are listed. The couple's own
  number appears only as the day-of contact they chose.
- **Send**: after publish, "Send each vendor their part" is the preselected
  next action (`sendTimelineToVendorTeam`). The studio presses it — AI
  prepares, human approves.

### Phase 3 — The offer (≈ 3–4 days)

- **Who gets it**: the vendor's trade has a live journey
  (`vendorTypeIsLive`: today DJ, makeup, hair; videographer/photographer get
  the existing Studio-plan referral), they are **not a subscriber** (no
  owner/admin membership of a trialing or active tenant — a couple or crew
  login is not a subscriber), not suppressed, the studio hasn't turned
  invites off (`vendorInvitesEnabled`), not a test address.
- **Where**: a block at the foot of the `vendor_timeline` email and on the
  share page. The email stays transactional first (the schedule is the
  point); an "offers" unsubscribe stops the offer, never the schedule.
- **Once ever**: the timeline email writes `vendorInvites/{sha256}`, so the
  daily invite sweep never sends a second, separate pitch. The sweep becomes
  the fallback for vendors who never get a timeline (studio-entered, no send).
  The share page keeps showing the offer each time they open it.
- **The code**: a per-vendor offer code in `saasReferralCodes` (`offerFor:
  emailHash`, `referrerTenantId`, `projectId`). Link =
  `/auth/register?trade=<t>&plan=vendor&code=<CODE>&utm_source=vendor_offer`.
- **Checkout**: `billingCommand` accepts a code on the vendor plan and applies a
  new lazily made vendor coupon (ids beside the studio ones in
  `saasSettings/referralProgram`). **12-month duration, never `once`** (the
  trial's $0 invoice spends a `once` coupon — 81ebcf4b).
- **Attribution**: `saasReferrals` `via: "vendor_offer"`; a new Sources
  channel so Console funnels count it; the platform vendor row is marked
  signed up. Referring studio credit per D2.
- **Subscriber vendors** get no offer. (Later: their own StudioCue job
  receives the timeline — "connected vendors", out of scope here.)

### Phase 4 — The vendor database in the Console (≈ 2–3 days)

- **`platformVendors/{sha256(email)}`**, Admin-only (no browser read; Console
  reads through its handlers). Business contact only: trade, company,
  contact name, email, phone, website, region (state/metro from the venue
  address), first/last seen, weddings seen, studios seen (count), sources
  (couple / studio / planner), offer sent/viewed/claimed, signed-up tenant,
  suppressed. **No couple names, dates or venues.**
- Written by a Firestore trigger on `projectVendors` writes (booked + email),
  so studio-entered and couple-entered vendors both count. Idempotent upsert.
- **Console → Grow → Vendors**: table-first (like Studios), filters by
  trade / region / offer state / signed up, a drawer with the history, CSV
  export behind `crm.write`. Top planners and DJs become partner codes in one
  click (Partners, 2d2a845f).
- **Potential customers**: photographers and videographers captured on DJ,
  hair and makeup studios' weddings are Studio-plan prospects; florists,
  caterers and the rest are held until they have a journey.
- **Backfill**: `scripts/backfill-platform-vendors.mts` from existing
  `vendors` + `projectVendors`, dry run by default, `--prod` to write.

### Later, not in this plan

- Connected vendors (a subscriber's own job receives the timeline and
  updates).
- Offers for florists, caterers, officiants — when those trades exist.
- The planner offer — when the planner trade goes live (planner N10).

## Decisions for Conor

| # | Question | Recommendation |
|---|---|---|
| D1 | The vendor discount | **$50/mo for the first 12 months, or $500 for the first year** (vs $75 / $750). 14-day trial as today. Clean numbers, a third off. |
| D2 | Does the studio whose wedding brought the vendor get credit? | **Yes, the same $100 bill credit** after the vendor's 3 months paying. Gives studios a reason to push couples to fill it in. |
| D3 | Must the couple answer? | **Yes, to confirm final details** — list vendors or tap "No other vendors". The studio can always publish and send without it. |
| D4 | When does the ask open? | **With the planning form** (6 months by default), **due on lock day** (4 weeks). |
| D5 | Vendor schedule emails | **One press, preselected**, after publish. Not automatic. |
| D6 | Capture florists, caterers etc. now, with no offer? | **Yes.** Capture every kind now; offer when a journey exists. |

## Legal and privacy (owed before Phase 3 and 4 ship)

- **Controller use.** Vendor contacts come from studios' couples; StudioCue
  using them for its own marketing makes StudioCue a controller of that data.
  The same open counsel question as vendor invites (studio-referrals), now
  wider: a cross-studio database. Privacy policy + DPA wording, and probably
  the owner notice the policy itself requires for a material change.
- **Couple notice** on the ask: "We'll share your schedule with these vendors
  and list them on it so they can reach each other."
- **Vendor notice** in every offer: who gave us their details (the studio,
  for this wedding), unsubscribe from offers.
- **CAN-SPAM**: transactional primary purpose, the offer secondary, a working
  opt-out, the footer address.

## Burden check

- Couple: **one screen, ~2 minutes**, inside asks they already get. No new
  email series.
- Studio: **zero new steps.** One existing press (send to vendors) becomes
  the default next action.
- Vendor: **nothing to do** to get the schedule; the offer is optional.
- Fits the photographer journey's budget; for vendor trades it replaces no
  existing ask and adds no setup.

## Traps to remember

- Shared `email-templates.ts` → the render worker (`operationsTaskWorker`)
  must redeploy; verify the bundle.
- Every new email type with a link passes the email-links guard;
  `vendor_timeline` is already in `VENDOR_EMAIL_TYPES` on the branch.
- New Console page and portal page: layout-integrity guard at 1024, 1280 and
  phone width; screenshot on prod at desktop and phone.
- US English, `tradeVocab()` words, the job-kind-copy pins.
- New functions → the invoker script allowlist in the same change.
- Walk it on prod with a real couple email and a real vendor inbox (a
  plus-address), through to a vendor checkout with the coupon.
