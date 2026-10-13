# Wedding planner journey: research and plan

Conor, 2026-10-12: "we did the addition of the dj, make up and hair studio
journeys, but i forgot to add a wedding planner journey … research what would
be required … then fit it into a studiocue flow that uses the features we have
already, similar to what we did with the other journeys. plan this out before
execution."

**Status: decisions taken 2026-10-12 (below). Phase 1 (the vendor team) and
Phase 2 (the planner trade and journey) are built on a branch and walked in
the emulator — see "Phase 1 status" and "Phase 2 status" under Phases. Neither
is deployed or walked on prod.**
The DJ, makeup and hair plan this follows is `docs/vendor-journeys-plan.md`.
Sources are at the end.

## The short version

- **Same spine.** A planner runs inquiry → discovery call → proposal →
  agreement and deposit → planning → final month → the day → review. Every
  one of those is already a StudioCue step. Like DJs and beauty, nothing is
  delivered afterwards, so the journey ends at the review.
- **One thing is genuinely new: the vendor team.** A planner owns none of the
  vendor contracts but answers for all of them. Every planner source comes
  back to one record: who is booked, how to reach them, when they arrive,
  what is still owed, and whether they have the latest timeline. StudioCue
  already has vendor records, the run-of-show share and vendor confirmations.
  It has no per-job list of a wedding's vendors with a status for each.
- **Tiers are per job, not per studio.** Full planning, partial planning and
  month-of coordination share the final month, the day and the review. The
  tier decides only when the job starts and how much of the planning phase is
  switched on. That is a field on the package, not three journeys.
- **What stays out:** guest lists, RSVPs, seating, floor plans, design boards,
  and paying vendors on the couple's behalf. Planners run those in Aisle
  Planner, AllSeated or Google Sheets. StudioCue is the office side of a
  planning business plus the vendor hub, which is the one thing those tools
  do badly: per-vendor timelines, changes reaching every vendor, and confirmed
  arrival times.

## What planners do (research summary)

### Tiers

| | Full planning | Partial planning | Month-of coordination |
|---|---|---|---|
| Booked | 12–18 months out | 3–6 months out, venue already booked | Booked any time; **work starts 4–8 weeks out** |
| Meetings | 2–3 a month, or unlimited | 1–2 a month | 2–3 in total |
| Vendor sourcing | Everything, venue included | Remaining vendors only | None (referral list at most) |
| Design | Full | Mood board | None |
| Budget | Yes | Yes | No |
| Typical fee | $4,000–$10,000+ (Zola); TWPLA $4,500 (≤25 guests) to $10,500+ (301+) | $1,500–$6,000 (Zola/Joy) | $800–$3,000 (Zola); TWPLA $950–$2,650+ |

- **Pricing:** flat fee is most common. Some charge 10–20% of the budget, a
  flat fee plus a percentage, or hours against a retainer.
- **Guest count, not tier, drives the price and the staff.** TWPLA: one
  assistant up to 75 guests, two to 125, three to 200, four to 300.
- **Add-ons:** rehearsal dinner ($250–$800), welcome party or brunch
  ($300–$1,000 each), overtime ($75–$200/hr), extra assistants, travel
  beyond 25–35 miles, seating chart and escort cards.

### Sales path and contract

- Inquiry → pricing guide and call link → **discovery call** → one proposal
  (package, contract, invoice) → signature and retainer → welcome
  questionnaire and kickoff call.
- **How a planner's contract differs:**
  - Scope by tier: meetings, prep hours, hours on the day, assistants,
    walkthroughs and rehearsal hours.
  - The couple contracts with and pays every vendor directly. The planner is
    not liable for vendor failures and not bound by vendor contracts.
  - The couple must share every vendor contract promptly.
  - Commissions or referral fees disclosed (or "none").
  - Staff meals after 6 hours, overtime, travel.
  - Exclusions such as returning tuxedos and clean-up.
- **Payment:** about 50% retainer, then 3–4 installments, paid in full at
  least 30 days before (Legal Paige). Some take 50% and the balance 4 weeks
  out.

### After booking

- **Full and partial:** a monthly task outline, budget, vendor sourcing and
  contract review, design, floor plan and seating, then the final month.
- **Every tier, the final 4–6 weeks:**
  - The venue walkthrough with the couple and the venue coordinator.
  - The master timeline.
  - Each vendor gets their cut of the timeline, the floor plan and load-in.
  - Vendor COIs and venue rules are collected for the venue.
  - Every vendor's arrival, start and strike times are confirmed.
  - The balances the couple still owes each vendor are listed.
  - The final timeline goes out in the week of the wedding.
- **Month-of** starts at this point. The couple hands over their vendor
  contacts and contracts, venue rules, ceremony order, the décor they're
  bringing, key people and getting-ready locations.

### The day and after

- **The day:**
  - The rehearsal (1–2 hours), usually the day before.
  - A lead planner plus assistants scaled to guest count.
  - Running the timeline and cueing vendors.
  - An emergency kit.
  - Handing out vendor balances and tip envelopes.
  - Breakdown and pack-out.
- **After:** a thank-you and testimonial ask about a week later, any overage
  invoice, and the vendor credit list (for publication and for every
  vendor's Instagram).
- **Insurance:** many venues require the planner's own COI, usually $1M per
  occurrence / $2M aggregate, with the venue as additional insured.

### What planners complain about

- Work scattered across email threads, spreadsheets and documents.
- Timeline changes that never reach a vendor. The photographer arrives late
  because nobody passed on the new ceremony time.
- Every vendor needing their own version of the timeline.
- General CRMs (HoneyBook, Dubsado) with no timelines. Planning tools (Aisle
  Planner) with a learning curve and weak email and payments.
- **Unknown:** whether couples use client portals. No source said either way.
  Ask the pilot planner.

## Persona

**Claire, *Wren & Co. Events*.**
- **The business:** books full and partial planning plus a lot of month-of
  coordination, with two assistant coordinators on Saturdays.
- **What she sells:** full planning $7,500, month-of $2,200, plus $45/hr per
  extra assistant.
- **Her stack today:** HoneyBook for contracts and payments, Aisle Planner
  for timelines and checklists, and a Google Sheet per wedding for vendors
  and balances.
- **Her worst day:** the florist arrived at the old load-in time because the
  ceremony moved and only half the vendors got the new PDF.

## The journey, fitted to StudioCue

Built the way the DJ, makeup and hair journeys were. The trade changes the
words, which steps apply and the starter content. Screens never branch on the
trade.

| # | StudioCue step → planner label | The couple | Claire | When | Tiers |
|---|---|---|---|---|---|
| 1 | Inquiry | Date, venue (booked yet?), guest count, budget, the tier they want, vendors already booked | On Today; Cue drafts the reply with her pricing guide and call link | Any time | All |
| 2 | Consultation → **Discovery call** | 30–45 minute call | Notes tier, guest count, vibe | Before the proposal (required, as for photographers) | All |
| 3 | Proposal | Picks a tier package plus add-ons: extra assistant (per person), rehearsal dinner, welcome party, brunch, extra hour, travel | Sends it | Same week | All |
| 4 | Agreement + deposit → **Booked** (one link, as vendors have) | Both sign; pay the deposit | — | At booking | All |
| 5 | **NEW: Vendor team** | Fills in the vendors they've booked, or nothing (Claire books them) | Adds and books vendors; the step is done when every category the wedding needs is booked | Full/partial: from booking. Month-of: the intake, 8 weeks out | All |
| 6 | Details form → **Final details** | Getting ready, key people, ceremony order, décor they're bringing, venue rules, final guest count. Vendors are **prefilled** from the vendor team for the couple to correct | Chases until done | Due 4 weeks out; month-of sends it 8 weeks out | All |
| 7 | **NEW meeting: Venue walkthrough** | Attends at the venue | Books it through the meeting link | 4–6 weeks out | All |
| 8 | Run of show → **Master timeline** | Reads it (no approval step) | "Lay out the day", with **every vendor's arrival and load-in drawn from the vendor team** | 4–6 weeks out | All |
| 9 | **NEW: Vendors confirmed** | — | One press sends every vendor their own cut of the timeline. Each vendor confirms from the link (exists today). Republishing re-sends to anyone with an older version. "7 of 9 confirmed" | 4–6 weeks out, then week of | All |
| 10 | Crew → **Assistants confirmed** | — | Offers the day to assistant coordinators (C1, C2) | When the package includes assistants | Optional |
| 11 | Insurance → **Insurance to venue** | — | Sends her COI (existing COI flow); ticks off vendor COIs on the vendor team | When the venue asks | Optional |
| 12 | Final balance | Pays | — | **30 days before** | All |
| 13 | Day before → **Rehearsal** | Rehearsal time and who comes (from Final details) | Day-before email; kit list = emergency kit **plus "payments and tips to hand out"**, drawn from the vendor team | Day before | All |
| 14 | Event day → **"We ran it"** | The wedding | Runs the timeline; the assistants' day sheet has the vendor contact sheet | The day | All |
| 15 | Review | Leaves a review | Optional: sends the couple and every vendor the **vendor credit list** | ~1 week after | All |

**Full and partial planning** add one thing in the background, not a step:
a **planning checklist** of dated tasks set relative to the wedding date
("Book the photographer, 10 months out"). The tasks surface on Today when
they're due, like the hair stylist's extension order does.

### The burden check

The vendor journeys have a test-enforced budget (`tests/vendor-burden.test.ts`:
vendors 8 steps, 5 asks, 4 checks, 4 setup; photographers 15, 9, 12, 7). A
planner sells planning, so it sits between them. The planner budget the tests
would pin:

| | Planner | Photographer | DJ / beauty |
|---|---|---|---|
| Journey steps | **≤ 12** (rehearsal folds into the day before, the timeline folds into vendors confirmed, inquiry reply folds as for vendors) | 15 | 8 |
| Client asks | **6**: call, accept + sign, deposit, final details, walkthrough, balance | 9 | 5 |
| Readiness checks | **5**: booked, vendor team complete, final details in, vendors confirmed, balance paid | 12 | 4 |
| Setup questions | **≤ 5** | 7 | 4 |

## What's reused vs what's new

**Reused as is, or relabelled:**
- Trades: `tradeVocab`, `tradeProfile`, `LIGHT_JOURNEY`, `journeyFor`,
  `shapeForProfile`.
- No-delivery moves (EVENT_COMPLETE → REVIEW_REQUESTED).
- Inquiry form per trade (`defaultInquiryFormFor`, with `askBudget` turned on).
- Consultation booking link and purposes.
- Packages with per-person and per-hour add-ons (`unitLabel`).
- One-link agreement and deposit; the starter agreement per trade
  (`starterAgreementFor`); Schedule A parts per trade.
- Recommended forms, `dueDaysBeforeEvent`, the details lock and the job-fact
  prefill (`job-facts.ts` already maps planner and vendor facts).
- "Lay out the day" (`day-plan.ts`) and the run-of-show editor, PDF, crew day
  sheet and client view.
- The vendor share (`scheduleShares`, `/share/[token]`, `/api/share-ack`,
  `refreshRunOfShowShares`, `staleVendorShareCount` on publish).
- The COI flow, crew offers and coverage roles, the final-balance scheduler
  (`balanceDueDaysBefore`).
- Fixed-id dated tasks on Today (extensions pattern); workflow templates with
  `dueDateRule` relative to the event date (the schema exists, the UI doesn't).
- The review ask after the day; Console trade filter; vendor invites by type.

**New:**

| # | Piece | Size | Notes |
|---|---|---|---|
| N1 | **Vendor team** (per-job vendor roster, with the light budget) | L | Today a vendor is linked to jobs only through `vendors.projectIds`, with no per-job state. New `projectVendors/{projectId}_{vendorId}` (tenant-scoped, server-write): category, status (needed / considering / booked / declined), arrival, load-in and strike times, contract received, COI received, balance due and date, tip, notes. Commands through `planningCommand`. A "Vendor team" panel on the job, mobile-compact. Built for every trade but shown by default only to planners (a photographer can list a wedding's vendors too). The light budget (decision 4): `projects.budgetCents`, prefilled from the inquiry, and booked vendors' costs totalled against it. |
| N2 | Vendor on a run-of-show line + "send to every vendor" | M | `vendorContactIds` exists on lines and the share already filters per vendor, but the editor has no vendor picker. Add the picker and arrival lines drawn from the vendor team. Add a bulk share to every booked vendor with an email. The "Vendors confirmed" step reads acknowledgements against the current version. |
| N3 | Planner trade foundation | M | `planner` in `TRADES` (not live yet) with vocab, profile and the mirror. A coverage role **coordinator** (track C1, C2): the crew-label regex currently falls through to P. A plan, the copy guard, the journey shape, `balanceDueDaysBefore: 30`, the burden budget test. |
| N4 | Planning scope on the package | S–M | `planningScope: full | partial | coordination` on planner packages, copied to the job on acceptance. Coordination sends Final details 8 weeks out and starts the vendor team as an intake; full and partial get the checklist. |
| N5 | Meeting purposes | S–M | Add `walkthrough` (and a generic `planning_meeting`) to the consultation purposes in both copies. Each purpose needs its own length (`trialMinutes` set the precedent). Every sales-call site already asks `isSalesConsultation`, so new purposes are safe. |
| N6 | Starter content | M | Example packages (three tiers by guest band, plus add-ons); a planner starter agreement (scope, the couple pays vendors directly, not liable for vendors, commission disclosure, meals, overtime, travel); Schedule A planner parts; the planner inquiry form; the **Final details** recommended form, with the vendor section prefilled from the vendor team. |
| N7 | Day and after | S–M | The emergency kit (`kitChecklist`); a printable vendor contact sheet and a "payments and tips to hand out" list from the vendor team; a "Send vendor credits" email after the review ask. |
| N8 | Planning checklist (full/partial) | M | Starter dated tasks per tier through workflow templates' `dueDateRule` (relative to the event date), surfacing on Today when due. Includes a minimal editor for the task name and the months out. |
| N9 | **Payment plan (installments)** | L, cross-trade | StudioCue bills only deposit + final balance (`invoiceKind` retainer/final/adjustment; `paymentScheduleFor` returns one or two lines). Planners take a retainer plus 3–4 installments; DJs and photographers ask for payment plans too. Touches proposals, invoices, the schedulers, QuickBooks and own invoicing. **In scope (decision 2)**, every trade. |
| N10 | Launch | S–M | `/planner` landing page; `LIVE_TRADES`; `VENDOR_TYPE_TRADES.planner = ["planner"]`. Every photographer who has listed a planner on a job becomes an invite, using the existing invite and sweep. Help guides; Cue's `tradeInstruction`; the pilot. |

## Phases

Each phase keeps photographers, DJs and beauty exactly as they are. Each ends
with the full gates, functions first, the freshness and invoker scripts, an
explicit rollout checked against the commit, and a walk on prod on a test
tenant at desktop and phone width.

1. **Vendor team** (N1, N2) — ≈ 5–7 days. Useful on its own: a photographer
   can track a wedding's vendors and send them the timeline in one press.
   - **Done when:** on a FlawlessIQ wedding, three vendors are added, two get
     their timeline in one press and confirm from the email link, and the job
     reads "2 of 3 confirmed". Republishing re-sends to both.
2. **Planner trade and journey** (N3–N7) — ≈ 7–9 days. A planner studio is
   made in the emulator through real onboarding, and its wedding runs from
   inquiry to review within the burden budget.
   - **Done when:** a month-of wedding and a full-planning wedding are walked
     on prod on a `?trade=planner` test studio. The month-of job sends Final
     details 8 weeks out; the full one starts at booking.
3. **Planning checklist** (N8) — ≈ 3–4 days.
4. **Payment plan** (N9) — ≈ 6–8 days, across every trade (decision 2). A
   studio offers a plan on a package or a proposal: deposit, then N
   installments on dates, the last one the balance. Each installment is an
   invoice through the same billing paths (QuickBooks, Stripe, own
   invoicing), chased by the same reminders.
5. **Launch** (N10) — ≈ 2–3 days, then the pilot.

### Phase 1 status (2026-10-12)

Built (N1 + N2) and walked in the emulator; not deployed. Every trade is
`vendorTeam: "quiet"`, so photographers, DJs, makeup and hair look as before
until a studio presses "Add a vendor" (the burden tests did not move).

**The record**
- `projectVendors/{projectId}_{entryId}` — tenant-scoped, server-write-only.
  Category (the vendor `type` list, which gained `photographer`, `officiant`,
  `bakery` and `rentals`), role label, status needed / considering / booked /
  declined, arrival / load-in / strike (`HH:MM`), contract and COI received,
  `costCents`, `balanceDueCents` + `balanceDueDate`, `tipCents`, notes, and a
  snapshot of the vendor's company / contact / email / phone (so a
  coordinator, who can't list the whole directory, still sees who it is).
  One entry per (job, vendor), enforced in the command's transaction, which
  also writes `projects.vendorTeamUpdatedAt` so two adds take turns.
- Someone new joins the directory (`vendors`), with the job in `projectIds`;
  declining or removing takes the job out of `projectIds`, and removing
  revokes their timeline link for that job.
- `projects.budgetCents` (+ `budgetSource`, `budgetSetAt`): the light budget.
  Prefilled once from the lead's `budgetRange` only for a trade whose
  inquiry asks the whole wedding's budget (`vendorTeam: "default"`, the
  planner) — every trade today asks for its own ("Photographer budget"), so
  nothing is prefilled yet. The parse takes one amount; ranges and open ends
  are left for the studio.
- `crewVendorContacts/{projectId}`: the crew's projection (company, contact,
  phone, arrival / load-in) — never the money. Rebuilt on every team write
  and when a vendor's directory details change (`updateVendor`).
- Rules: `projectVendors` read by owner / admin, or a coordinator on the job;
  `crewVendorContacts` also by staff and crew on the job; both write-false.
  No composite index (both queries are two equalities).

**Commands** (`planningCommand`, owner / admin / coordinator on the job):
`addVendorTeamEntry`, `updateVendorTeamEntry`, `removeVendorTeamEntry`,
`setProjectBudget`, `sendTimelineToVendorTeam` —
`functions/src/planning/vendor-team.ts`, spliced into the command union in
`functions/src/planning/commands.ts`. Idempotency keys, audit events.

**Send the timeline** needs a published run of show. For each booked vendor
with an email: a first link (scope `vendor`; `full` for a planner or
videographer), the update to anyone on an older version, nothing to anyone
already current. One `vendor_timeline` email per (vendor, version), id
`vendor_timeline_{shareId}_v{version}`, `audience: "vendor"`,
`soleRecipient: true`, held while billing is lapsed (not on the delivered
list). Template in `functions/src/communications/email-templates.ts`
(`VENDOR_EMAIL_TYPES`): "{Studio} sent you the timeline for {couple}'s
wedding on {date}" / "Updated timeline: …", button "View and confirm".

**Screens**
- Job page: `components/vendors/vendor-team-panel.tsx` under the crew panel
  (both layouts) — budget line, "Sent to N · N confirmed · N has an older
  version", the send button with a confirm that names who gets what, compact
  rows (four then "Show more" on phones), the add / edit sheet
  (`vendor-team-sheet.tsx`) and the budget sheet.
- Run-of-show editor (`components/planning/ai-schedule-generator.tsx`): a
  vendor chip row on each line (writes `vendorContactIds`), and "Add vendor
  arrivals" — one `crew`-visibility line per booked vendor with a time,
  tagged to them, ids `vendor_arrival_{entryId}` so re-running updates;
  `flowEnds` treats them as moments that end nobody's block.
- `/studio/projects/[id]/vendors/print`: the printable contact sheet, with
  the balances and tips to hand out.
- Crew day sheet: a "Vendors" section with Call buttons
  (`components/crew/crew-vendor-contacts.tsx`), kept offline like the rest.
- Cue: `vendor_team` mounts the panel (`VendorTeamCard`).

**Deterministic core**: `features/vendors/team.ts` — `vendorTeamProgress`
(booked / needed counts, confirmed-on-current-version, budget totals,
`teamComplete`, `allConfirmed`) for Phase 2's "Vendor team" and "Vendors
confirmed" steps; `timelineStateFor`, `budgetLine`, `timelineSummary`,
`vendorTeamVisibility`, `vendorArrivalLines`. Tests:
`tests/vendor-team.test.ts`, `tests/firestore-rules-vendor-team.test.ts`.

**Walked in the emulator (2026-10-12)** on the seeded Maya & Theo Johnson
wedding (a photographer studio): the quiet "Add a vendor" before any
vendor; The Foundry from the directory (considering), Petal & Stem as
someone new (booked, $4,200, $1,200 still owed, $100 tip) and a cake still
needed; budget $35,000 → "$4,200 of $35,000 booked"; "Add vendor arrivals"
pressed twice made one line; published v5; one press sent Petal & Stem
their link (mock email "Alder & Muse sent you the timeline for Maya & Theo
Johnson's wedding on August 15, 2026"); no second send offered; the share
page showed their arrival and they confirmed; The Foundry booked;
republished v6 → "Sent to 1 · 0 confirmed · 1 has an older version"; one
press sent the update to Petal & Stem and a first link to The Foundry,
three emails in all; the crew member's day sheet listed both vendors with
Call. Layout audit clean at 1024, 1280 and 390 on the job, the print page
and the editor. **Not yet walked on prod** (the plan's "done when").

**Deploy notes**: rules first (`firestore.rules` gains two collections; the
app's reads are refused until they are live, and a quiet trade's job then
looks as before). Functions changed: `planningCommand` (commands +
`vendor-team.ts`) and the email renderer `operationsTaskWorker` (new
`vendor_timeline` template) — check it with the freshness script. No new
function export.

**Deferred**
- Journey steps and readiness checks (Phase 2 reads `vendorTeamProgress`). Done in Phase 2.
- Budget prefill at inquiry → job conversion (Phase 2, with the planner's
  inquiry form asking the wedding's budget). Done in Phase 2.
- Inviting a photographer listed on a DJ's or planner's team to StudioCue
  (`photographer` is not in `VENDOR_TYPE_TRADES`).
- "Payments and tips to hand out" on the day-before kit list (N7). Done in Phase 2.

### Phase 2 status (2026-10-12)

Built (N3–N7) in `288625f3` and walked in the emulator; not deployed. The
photographer, DJ, makeup and hair journeys are byte-for-byte as before
(`tests/fixtures/journey-before-planner.json`, made from `95ae3e82`).

**The trade**: `planner` is in `TRADES` (both copies), not in `LIVE_TRADES`,
so only `?trade=planner` reaches it. Its vocabulary covers the discovery call,
Final details, master timeline, retainer and the emergency kit. Its profile
has no delivery, requires the call, books through one link and sets
`vendorTeam: "default"`. The balance falls due 30 days before. The walkthrough
is 60 minutes. It is on the vendor plan. Final details go 3 months out,
automatically, with the lock 14 days out and no final call. Coverage role
`coordinator`, crew track C1/C2, PDF chip colors for C.

**Tiers**: `planningScope` (full / partial / coordination) on the package,
its snapshot and the job (`features/planning/planning-scope.ts` + mirror).
Month-of sends Final details 8 weeks out, and its vendor team starts at that
intake. Full and partial work the team from booking.
`planningChecklistApplies` is the Phase 3 hook.

**Journey**: 11 steps. The "Vendor team", "Venue walkthrough" and "Vendors
confirmed" steps show for a trade whose profile asks for them; the master
timeline folds into "Vendors confirmed". 6 client asks, 5 checks, 5 setup
questions, pinned in `tests/vendor-burden.test.ts`. Today and readiness read
the same team progress. Readiness recomputes on `projectVendors` and
`scheduleShares` writes (two new trigger exports,
`readinessOnProjectVendorWritten` and `readinessOnScheduleShareWritten`). The
invoker script discovers event triggers by itself, so it needs no new names.

**Walkthrough**: a consultation purpose `walkthrough` (both copies) with its
own length and window, an invite and card on the job, and its own email. It is
never the sales call, the final call or the trial. A planner's lock sends no
sign-off, because the walkthrough settles the details.

**Starter content**: example packages per tier, extras, a plain-English
planner agreement (counsel review owed), and Schedule A planner parts. Also
the inquiry form with the wedding's budget, now prefilled onto the job at
conversion. The Final details form has a vendor section, prefilled from the
team and read back into it.

**Day and after**: payments and tips to hand out (`features/vendors/hand-out.ts`
+ mirror) appear on the day's step and in the assistants' reminder, **ordered
by arrival time** like the contact sheet, so envelopes go out as vendors walk
in. The day step opens the contact sheet. "Send vendor credits"
(`sendVendorCredits`) runs once, only after the day, and never for a quiet job.
Cue gets a trade instruction and glossary terms. The final-bill run now reads
44 days ahead (a planner's window); every other trade still bills at its own
28.

**Walked in the emulator (2026-10-12)**: `scripts/uat/planner-journey-walk.mts`,
**43 of 43 pass**. It runs through the real onboarding, command functions, app
routes (couple's portal, vendor confirm) and schedulers. Only the clock and
the mock QuickBooks connection are written by hand.
- Setup: the studio is made through onboarding (trade planner, vendor plan).
  The timeline is 3 months / auto / 14 days / no final call. Final details is
  the only seeded form. There are 5 checks. The inquiry form asks venue, tier,
  vendors and budget.
- Month-of: the inquiry becomes a job with a $35,000 budget. The discovery call
  is booked from the link, then proposal (with an extra assistant at $450 a
  person), accepted, signed, retainer paid and BOOKED. The tier is on the job
  and the snapshot, and the schedule says "Retainer". There are no Final
  details at booking, and the team "comes in with the final details, eight
  weeks out". Nothing goes at nine weeks. The Final details go at eight. The
  couple returns three vendors, who join the team as booked: "All 3 vendors
  booked", and readiness counts the check. The walkthrough is booked from its
  own link (60-minute openings) and the job stays BOOKED. Arrivals are drawn
  from the team, the master timeline is published and sent to three vendors in
  one press, and one confirms: "1 of 3 confirmed · waiting on 2". The
  assistants' reminder carries the kit and the envelopes in arrival order. The
  day step reads "3 envelopes to hand out, $2,450" and opens the contact
  sheet. No lock sign-off is sent. Post-production is refused, the job goes to
  review, and the vendor credits go once with the studio first.
- Full planning: booked on Full, with the vendor team as the next step from
  booking. "1 of 2 booked · 1 still to find". The Final details wait until
  three months out, then go with the vendor section prefilled from the team.
  The balance is billed 44 days out, due 30 days before.

**What the walk found**
- Fixed: the envelopes in the assistants' reminder came out in Firestore
  document order, which is effectively random. `paymentsToHandOut` now orders
  by arrival (then load-in, then when they joined the team), in both copies,
  with a test.
- Harness only: an add-on must be offered on the package before a proposal
  can take it. Readiness never writes a checkpoint's status; it scores the job
  from evidence, so the walk reads the evidence and the score.
- Open, not fixed: in the month-of walk, "Venue walkthrough", "Vendors
  confirmed" and "Final balance" stay unticked after the review. The walk
  compressed the clock: the walkthrough slot is still in the future, only 1 of
  3 vendors confirmed, and the balance was never billed. A real job would tick
  them, but past-the-day steps left open are worth a look on prod.

**Deploy notes**: functions first, all of them. The shared trades, email
templates (renderer `operationsTaskWorker`), planning, booking, intake,
invoice scheduler and readiness modules all changed, plus two new trigger
exports. Run the freshness script after. The PDF service changed
(`cloud-run/pdf/run_of_show.py`, chip colors for C). No rules change in this
phase beyond Phase 1's. **Not yet walked on prod** (the plan's "done when").

## Decisions

Conor, 2026-10-12:

1. **Price: the $75 vendor Pro plan**, like DJ, makeup and hair. Assistants
   are crew, not seats.
2. **Payment plan: built in this project** (Phase 4), as a shared feature for
   every trade, not planners only.
3. **Vendor team: available to every trade, quiet.** Planners see it by
   default; other trades reach it through "Add a vendor", so nothing new
   appears unasked.
4. **Budget: a light one.** The job keeps the couple's budget (prefilled from
   the inquiry's budget range), and the vendor team totals booked vendors'
   costs against it: "$18,400 of $35,000 booked". No categories, no
   allocations, no budget tool.

Taken as recommended unless Conor says otherwise:

5. **Tiers** are a field on the package (`planningScope`), copied to the job.
6. **Out of scope for v1:** guest list, seating, floor plan, design boards,
   paying vendors for the couple, commission tracking.
7. **Pilot planner:** to find, ideally from Gabe's network and doing month-of
   coordination.

## Questions for the pilot planner

1. Which tier do you sell most, and when does a month-of job really start?
2. Do your couples use a client portal, or do they live in email?
3. Who keeps the vendor list: you, the couple, or both?
4. Do you hand out vendor balances and tips on the day? From what list?
5. Does the venue ask for your COI, and do you collect vendors' COIs for it?
6. Would you send every vendor their own timeline from here, replacing the
   PDF you send now?

## Sources

- Zola, wedding coordinator cost: https://zola.com/expert-advice/how-much-do-wedding-coordinators-cost
- Joy, cost of a wedding planner: https://withjoy.com/blog/cost-of-wedding-planner/
- The Knot, planner pricing: https://www.theknot.com/content/how-much-do-wedding-planners-charge
- The Wedding Planner LA 2024–25 pricing sheet: https://static1.squarespace.com/static/5c95b685f8135a2d9adfb4c4/t/660c61226a21ef6ec204db48/1712087330422/TWPLA_Pricing_Sheet_2024-2025+(2).pdf
- The Wedding Planner LA blog (coordinator questions): https://www.theweddingplannerla.com/blog/wedding-coordinator-questions
- The Traveling Planner, services: https://www.thetravelingplanner.com/services
- Diamonds & Details, services: https://diamondsanddetails.com/services
- byAmanda, month-of coordination: http://www.byamandaevents.com/phase-3-month-of-coordination
- Angela Proffitt sample contract: https://angelaproffitt.com/wp-content/uploads/2018/08/SampleContract.pdf
- The Legal Paige, planner pricing and contract: https://thelegalpaige.com/blogs/blog/wedding-planners-here-s-what-to-charge-how-to-get-paid and https://thelegalpaige.com/products/wedding-planning-contract
- Weinberg Legal, planner contracts: https://www.weinberglegal.com/blog/wedding-planner-contract
- Kelsey Gray Events, planning contracts: https://kelseygrayevents.com/what-to-look-for-in-your-wedding-planning-contract/
- The Contract Shop, wedding contract clauses: https://thecontractshop.com/blogs/posts/11-clauses-you-should-include-in-wedding-contracts
- ABC Wedding Planners pricing guide: https://www.abcweddingplanners.com/notebook/wedding-planning-package-pricing-guide-and-template
- Studio Gail, planner client workflow: https://studiogail.co/wedding-planners-client-workflow-honeybook/
- Southern Productions, planning process and walkthrough: https://southernproductions.net/2019/03/wedding-planning-process-for-planners/ and https://southernproductions.net/2020/09/how-to-conduct-a-final-venue-walk-through-as-a-wedding-planner/
- Insurance Canopy and NEXT Insurance, planner insurance: https://www.insurancecanopy.com/?p=140612 and https://nextinsurance.com/business/wedding-planner-insurance
- Planning Pod, pricing and software comparison: https://planningpod.com/blog/pricing-your-event-and-wedding-planning-services and https://planningpod.com/blog/aisle-planner-vs-honeybook-vs-planning-pod-wedding-planning-software-alternatives-reviews-pricing
- Timeline Genius: https://www.timelinegenius.com/
- Style Me Pretty, crediting vendors: https://perspectives.stylemepretty.com/credit-every-vendor-including-yourself/
- Software reviews: https://community.honeybook.com/talk-product-7/better-client-managemeng-system-for-event-professionals-5069, https://makerstack.co/reviews/aisle-planner-review/, https://www.g2.com/products/aisle-planner/reviews, https://www.capterra.com/p/210290/Aisle-Planner/
