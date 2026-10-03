# Job kinds — Phase 4 walk on production (2026-10-03)

Phase 4 of `docs/job-types-plan-2026-10-02.md`: one job per kind, walked on
studio-cue.com as FlawlessIQ (test data), from the public inquiry form onward.
Deployed build: app `90ac916`, all 98 functions current.

| Job | Kind | Date | Reached |
|---|---|---|---|
| Maya Okafor Portraits (`34b4fcb0…`) | Family & portraits | Oct 10 | Proposal accepted → **stuck at payment** (P0 below) |
| Dana Reyes Sports (`f1df8cf7…`) | Sports | Oct 4 | **Booked**, paid on the day recorded |
| Priya Shah Corporate (`6518c168…`) | Corporate | Oct 24 | Proposal accepted → agreement drafted, awaiting signature |

Not walked: event day, delivery and review (all three dates are in the
future), anything behind the client's sign-in, and phone-width screenshots (the
window resize didn't take).

## Status — fixed 2026-10-03

All P0 and P1 findings, and most of P2, fixed the same day (this commit):

- **F19** hand payment and waiver no longer demand a contract when the kind has
  no agreement (`functions/src/booking/commands.ts`).
- **F18/F13/F26** proposal payment lines follow the job's payment shape
  (`paymentScheduleFor` in job-kinds): one "Payment in full", "Payment on the
  day" or "Invoice after the event" line, so the proposal, Booking screen,
  hand-payment form and invoice agree. Readers (`agreed-retainer`,
  `agreed-final-balance`, both copies) know the new labels. One-off packages
  get a "How it's paid" choice. Proposals made before this keep their old lines.
- **F11/F10/F9** no consultation gate for `consultation: false` kinds: the
  server steps LEAD → CONSULTATION as it creates the proposal; the Booking hero,
  composer and journey offer "Prepare the proposal" straight away.
- **F6/F6b/F23/F27** the first reply and the `/i/` page follow the kind: no
  call to book for family and sports ("we'll send your price"), "your session"/
  "your event", and "one last step: your payment" for a no-agreement job.
- **F24/F25** a warning before a "Wedding" agreement goes out on other work;
  Schedule A promises the lock only when the kind has one, at the studio's own
  lock day.
- **F14/F16/F17-ish/F22/F28** proposal, acceptance, booking and Today wording by
  kind; "Send as one booking agreement" hidden without an agreement.
- **P2**: crew note, call invite hidden, "Session date", "Our planner" chip,
  one-off placeholder, planning-timeline subtitle, "Review" for no-album kinds,
  empty wedding fields out of the reply context (F20).

Re-walked on production after the deploy: a new family inquiry (Lena Marsh)
went inquiry → proposal from Lead → "Payment in full $450" → accepted →
recorded by hand (Venmo) → **Booked**, with no consultation and no agreement.

**Second pass, same day** — the rest:

- The first reply's AI gets the job's kind and only the facts the inquiry
  holds; its "check" list is filtered to what the studio's form asked that kind
  (no "Check BudgetRange, Venue" on a family session), and it must not add a
  partner or children nobody mentioned (F7, F20). The proposal intro drafter
  writes as the studio ("your family of four", never "the four of us") (F15).
- The proposal email's footer says what accepting does for the kind (F17).
- Readiness reasons say "the client" (F21). The billing-address card speaks
  of the client and, for a kind with no agreement, says where to add it.
- A job paid in full takes the whole agreed price on the hand-payment form,
  the Booking screen and a retried invoice, even from an older proposal that
  split it into a retainer and balance (Maya's).
- No "Confirm we've spoken" stage control at Lead for a kind with no
  consultation.

Still not walkable today: event day, delivery and review (the test dates are
in the future).

## What works

- **Inquiry form** asks each kind only its own fields. Family and sports: date and
  city are optional, with no venue or guest count. Corporate: date, city, venue and guests.
- **Every inquiry becomes a job with the right kind.** Each journey has the right
  steps:
  - **Family:** proposal → paid in full → session details form.
  - **Sports:** proposal → paid on the day.
  - **Corporate:** consultation → proposal → contract → retainer → final balance.
- **Settings → Job types** describes each kind correctly.
- **Booking without an agreement works in the backend.** Accepting a family
  proposal skipped the agreement and raised one **$450 invoice** (the full price).
  Accepting the sports proposal **booked the job outright**.
- **Paid on the day** works. Today shows "Bill Dana Reyes Sports · $600, due Oct 4".
  "Paid another way" recorded cash, the card cleared, the job stayed Booked, and the
  journey ticked "Paid on the day".
- **Corporate** offers the consultation correctly. Schedule A is titled "Event details".
- The Booking tab's agreement step reads "Not needed for this kind of job" for
  family and sports.

## P0 — a family session cannot be booked

**F19. A hand payment (or a waiver) needs a signed agreement for every kind.**
`attestRetainer` (`functions/src/booking/commands.ts:1923`) and
`approveRetainerException` (`:3042`) throw `SIGNED_CONTRACT_REQUIRED`. A family
job never has an agreement. So when the provider invoice fails, or the client
pays by Venmo or cash, the job can never be booked. The screen says "The signed
agreement comes first." This is the normal way family sessions are paid.
**Fix:** skip the contract check when `projectGateNeeds(project).agreement` is false.

**F18. The amounts disagree, which loses money.** On the family job:

- The invoice raised is **$450** (correct).
- The proposal the client was sent says **retainer $135, final balance $315**.
- The Booking screen says "Try again · **$135.00**".
- Recording a payment by hand would record **$135**.

A paid-in-full job has no final balance, so the other $315 would never be
billed. **Root cause (F13, F26):** a one-off package takes "the deposit and tax
from your usual packages", which is 30%, and ignores the kind's payment shape.
There is also no payment-shape choice anywhere except the Library package
editor.

**F13. Proposal defaults ignore the kind.**

- **Family:** a $135 retainer, "Final balance due **Sep 26**" (already past, and
  there shouldn't be one), and the terms say "The signed photography agreement
  holds the full terms".
- **Sports:** "Retainer $180 on signing, final balance $420 due Sep 20". The
  proposal expires Oct 10, after the Oct 4 event.

## P1 — the light path still goes through a consultation

Family and sports have `consultation: false`, but:

- **F11.** `/studio/proposals/new` refuses: "A proposal starts after the
  consultation. Mark the consultation done". The studio has to fake "Confirm
  we've spoken" before it can price a 1-hour family session.
- **F10.** The Booking tab hero says "From the consultation … Schedule the
  consultation first" (`components/booking/booking-autopilot-workspace.tsx:855`).
  Its booking step says "Waits for the retainer" (sports has none).
  `project-booking-workspace.tsx:1765` says "This unlocks once the signature is
  confirmed".
- **F6.** The first reply always says "Tell us a little more about your day and
  pick a time to talk" (`functions/src/intake/inquiry-link.ts:79-80`).
- **F6b.** The family `/i/` link **is** a consultation booker ("pick a time to
  talk … a 45-minute conversation"), and here a dead end: "No times are open".
  Gabe's light path (inquiry → package → pay) has no client-facing page.
- **F9.** Before booking, the family job's next move is "Send the form" rather
  than the proposal.

## P1 — client-facing words that are false for the kind

- **F27.** After acceptance, Maya's `/i/` page says "one last step: your
  retainer. **Your agreement is signed.** FlawlessIQ has emailed the retainer
  invoice". She has no agreement, and the invoice is the full price.
- **F24.** The corporate agreement is titled "**Wedding** Photography &
  Videography Agreement". The studio only has its wedding agreement, and nothing
  warns before "Sign & send". (The corporate template itself is still owed to
  counsel. The missing warning is the product gap.)
- **F25.** Schedule A on the corporate agreement promises final details "four
  weeks before the date. After that, changes … agreed with us in writing".
  Corporate has no final-details lock. This is contract text that claims a
  process that won't run.
- **F14.** The proposal sidebar says "When they accept, StudioCue writes the
  contract … for you to read, sign and send". After acceptance it says "The
  agreement is the next step". The record form says "It moves the job on to the
  agreement". The Booking hero says "Awaiting deposit · The agreement and the
  retainer are below. The final balance is on Invoices". All of these appear on
  family and sports jobs.
- **F16.** Family proposals offer "Send as one booking agreement".
- **F17.** The proposal email says "Accepting a proposal does not … collect a
  payment. Those steps remain separate". For family, acceptance is what raises
  the payment.
- **F22.** The sports "Paid another way" dialog is labelled "Final balance". It
  says "the balance on what the couple accepted" and "It closes the job on your
  word". It doesn't close the job, and this is before the day.

## P2 — wording sweep (studio side)

- **F23 / F6c.** Corporate `/i/` and reply: "tell us about your day" (should be
  "your event").
- **F2.** Inquiry step 2 says "Event date" for Portraits (vocab says "session").
- **F3.** The "Our planner" referral chip is offered for every kind.
- **F5.** Family job: "You're shooting this one — StudioCue books the rest of the
  crew" (the portraits profile has crew off). Also "Invite client to choose a
  time" and "Confirm we've spoken".
- **F12.** One-off package placeholder "Elopement — 4 hours". Also "for other
  couples later", and no family or sports packages for an existing studio (only
  new studios got the starter kit).
- **F20.** Sports reply badge: "Check Venue, Estimated Guest Count, Budget Range"
  (the lead's missing-info list is wedding-shaped).
- **F21.** Sports readiness: "a run of show the couple can see", "when the couple
  submits". Next move: "Prep locations, times, and **family names**".
- **F28.** Family next move "Create retainer invoice — Computed from your
  retainer rule".
- **F1.** Settings index: "Planning timeline — when **couples** get their
  planning form". This now applies to weddings only.
- **F7 / F15.** AI drafts invented "your partner" and echoed "for the four of us".
- "Album & review" is the step title on sports and corporate jobs, which have no album.

## Environment (not product bugs)

- **FlawlessIQ's QuickBooks subscription has ended.** QuickBooks refuses every
  invoice: "Subscription period has ended or canceled…". This blocks any
  invoicing test on FlawlessIQ.
- FlawlessIQ's first reply is signed "**Conor — GR Productions**" (data in its
  first-reply settings).

## Suggested fix order

1. **F19.** Hand payment and waiver for kinds that book without an agreement. This
   unblocks every family job.
2. **F18, F13, F26.** Take the proposal payment schedule from the job's profile:
   - **Paid in full:** retainer = total, no final balance.
   - **Paid on the day, or invoiced after:** no retainer, one bill.

   Use the same number on the proposal, the Booking button, the hand-payment form
   and the invoice. Add a payment-shape choice to one-off packages.
3. **F11, F10, F9, F6, F6b.** No consultation gate for `consultation: false`
   kinds. The first reply and `/i/` page say what actually happens next for that
   kind.
4. **F27, F24, F25, F14, F16, F17, F22.** Client-facing words, through
   `vocab()` / `bookedOnceClause()`. Warn before sending a "Wedding" agreement on a
   non-wedding job. Have Schedule A state the lock only when
   `finalDetailsLockApplies`.
5. The P2 sweep, then walk family again end to end on a studio whose QuickBooks
   works, at desktop and phone width.
