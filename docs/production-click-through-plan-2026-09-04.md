# Production click-through — sign-up to closeout, every email, every escape hatch

A plan for one person in Chrome, on **studio-cue.com**, walking a brand-new
studio from its first page view to a closed job — including every email the
product sends and every place a studio can record something that happened
outside StudioCue.

It is grounded in the three walks of 2026-09-02/03 (studio, couple, crew), the
six guards those produced, and a read of what production actually has switched
on. Where this plan says "expect X", X was read from the code, not assumed.

---

## Read this first — production is live, in every sense

| Surface | State on production | What that means for you |
|---|---|---|
| Stripe | **`sk_live_`** — real charges | Subscription checkout takes a real card. Decide before Phase A whether to (a) charge a card you will refund from the Stripe dashboard, or (b) create a 100%-off coupon in the live account first. **I cannot enter card details; that step is yours.** |
| Email | Real SendGrid, shared account | Every email in this plan reaches a real inbox. Use addresses you control. Delivery status arrives by a **15-minute polling sweep** (no webhook slot), so "sent" → "delivered" lags in-app. |
| Auth, data, providers | all `live`, mock mode off | Nothing is a preview. Firestore writes are real; audit events are real. |
| Signing apps | **none offered** | Contract stage has exactly one path: record the signature yourself. This is by design (DocuSign/Dropbox Sign deferred on cost), not a bug. |
| Invoicing | QuickBooks offered, not connected on a fresh studio | Retainer and final balance take the record-by-hand path unless you connect QuickBooks in Phase B. Both paths are in scope. |
| AI drafting | Vertex, configured on prod | Reply drafts, proposal copy, run-of-show generation should work. If any says "isn't available for this workspace", that is a finding. |
| Lifecycle reminders | Scheduler, **daily at 13:00 UTC** | Reminder-type emails are *drafted for approval*, not sent. You will only see them if a run happens during the test window. Plan for it or skip it. |
| Trial | 14 days from onboarding, cheapest-plan entitlements | `trialEndAt` is written and **never read** anywhere in `features/` or `lib/`. Expiry is not enforced client-side. Scenario H5 checks what a lapsed trial actually sees. |

### Identities — set these up before you start

You need three people you can be at once. Use three real inboxes you control
(plus-addressing works: `you+studio@`, `you+couple@`, `you+crew@`).

| Role | Email | Also needs |
|---|---|---|
| Studio owner | a fresh address, never used on StudioCue | a phone number for the event-day brief |
| The couple | a second address | — |
| Second shooter | a third address | — |

Pick a throwaway studio name with a unique public slug. The job: a wedding
about **six weeks out**, one venue, one city. Six weeks keeps the readiness
due dates ahead of you so nothing reads "overdue" for the wrong reason.

### What to record, at every step

For each step, before moving on, answer in one line: **from this screen, can I
tell what just happened and what to do next?** If answering needs the URL, the
database, or knowing how the product is built, it is a finding. Tag it with the
pattern table from `docs/ux-walkthrough-2026-09-02.md` and one of
**blocks / doubt / friction**.

Keep three tabs: the studio, the portal, the crew workspace. Keep the three
inboxes open. Note the **time** you trigger each email; the reconciler explains
a status that is fifteen minutes behind, and nothing else should be.

---

## Phase A — Sign up, verify, onboard, subscribe

| # | Do | Expect on screen | Expect in inbox | Confirm |
|---|---|---|---|---|
| A1 | Open `/start-trial` | Redirects to `/auth/register` | — | copy uses "your own private studio", never "tenant" |
| A2 | Register the studio owner | Form is **replaced** by a confirmation naming the address (A2 from the studio walk was fixed — regression check) | `email_verification` | button is disabled after the first send; a second press is not possible |
| A3 | Click the verification link | `/auth/verify-email` → sign-in | — | the link works once; a second click says so plainly |
| A4 | Sign in | `/auth/onboarding` — "Create your workspace"; "You'll be the owner of this studio" | — | no "audited Studio Owner" |
| A5 | Complete onboarding | Today, headline **"Let's get you set up."** with the setup card at 1 of 4 | **nothing** — there is no welcome email (read from `auth/emails.ts`; decide whether that is a gap) | Today must not say "You're all clear" beside "1 of 4 answered" |
| A6 | `/studio/subscription` | Trial status, 14-day end date, two plans × two cadences | — | the trial-end date is exactly 14 days from A5, in your timezone |
| A7 | Choose a plan → checkout | **Real Stripe Checkout** | Stripe's own receipt | you enter the card, per the decision above. Afterwards: status `active`, plan and cadence shown, portal link works (`createPortal`) |
| A8 | Open the billing portal, change cadence, return | Subscription reflects the change without a reload | Stripe email | `stripeWebhook` is what updates the record — if the screen lags more than a minute, note it |

**Outside-the-flow checks in this phase:** none exist. Sign-up has no
"I already have an account elsewhere" path and does not need one.

---

## Phase B — Set the studio up

Do this **before** the first job, because the job walk on 2026-09-02 found that
several steps fail late if these are missing (B6, A25, CR3).

| # | Do | Expect | Confirm |
|---|---|---|---|
| B1 | Setup card → packages → create one | Required marks on all 11 fields; retainer percent capped at 100 in the browser | try 1000% — the browser refuses before submit (A8 regression) |
| B2 | Questionnaire templates | The three starters exist already for a new studio | wedding template is `active` |
| B3 | Consultation availability | Save a window that covers your test week | public scheduler will offer it in C4 |
| B4 | Settings → Studio identity → **Event-day phone** | Field exists; saves; audit event written | this is the number crew will see in F3 |
| B5 | Integrations → Google Calendar **and** Zoom → OAuth | Callback lands on `/api/integrations/oauth/callback` → back to Integrations connected | any failure copy here is a **new error-copy** finding; the guard baselined 4 codes on this route |
| B6 | Integrations → QuickBooks — **decide**: connect it (tests provider invoices in D5/E9) or leave it (tests the record-by-hand path) | If connected: sandbox company, expect invoice emails | if not connected, the contract page must **not** say the booking "cannot be confirmed" (A11 regression) |
| B7 | Settings → agreement | No signing app offered — the page must lead with "record the signature you took yourself" (A25 regression) | no "Choose your agreement first / paste a template ID" block visible |
| B8 | Invite a staff member (optional) | `staff_invitation` email; accept as a second studio identity if you have one | invitation link works; role shows in Team |

---

## Phase C — Inquiry, first reply, consultation (as the couple, then the studio)

| # | Do | Expect on screen | Expect in inbox | Confirm |
|---|---|---|---|---|
| C1 | **As the couple**, open `/inquiry?slug=<your slug>` and submit | Public form confirms | **couple:** `inquiry_acknowledgement` | studio Today shows the new inquiry as the lead; Jobs shows it at Lead |
| C2 | **As the studio**, open the lead → AI draft a reply → approve → send | Draft appears for approval; sending records a `manual_message` | **couple:** the reply (`manual_message`) | journey: "First reply" complete; Today's inbox item clears |
| C3 | Couple replies by email (from the couple's inbox, to the studio's sending address) | Inbound lands in `/studio/messages` | **studio:** `client_message_received` | Today shows "client replied"; the thread shows both messages |
| C4 | **As the couple**, book via `/schedule/consultation?slug=…` from B3's window | Slot list from B3; booking confirms | **couple:** `consultation_confirmation`; **studio:** `consultation_invitation` | Google Calendar event exists (B5); Zoom link on it |
| C5 | **As the studio**, complete the consultation with notes ≥ 20 chars | Journey → Talking; next move → "Prepare proposal" | — | badge changes without reload (A26 class) |
| **C5-alt** | Instead of C4/C5: on the next-move card use **"It already happened — mark done"** | Same advance, no calendar event | — | audit log records the manual advance |

---

## Phase D — Proposal, contract, retainer, booking

| # | Do | Expect on screen | Expect in inbox | Confirm |
|---|---|---|---|---|
| D1 | Prepare proposal → lock package → AI draft copy → create draft | Version 1 draft; **job link in the heading at every status** (A17) | — | "The price you send is the price they see" — no "snapshot"/"drift" |
| D2 | Send for approval → approve → PDF | PDF builds (cloud-run worker is live on prod) | — | if the PDF fails, the page must offer send-as-link **and** not say sending is impossible (A16) |
| D3 | Send proposal | Status Sent; "Viewed · Not yet" | **couple:** `proposal_sent` | delivery status flips to delivered within ~15 min (reconciler) |
| D4a | **As the couple**, open the portal link → accept | Portal shows the proposal; accept confirms | — | studio: status Accepted; journey → Awaiting signature |
| **D4b** | Alternatively: **as the studio**, "Record their acceptance" | Lands on the proposal with the form **open** (A24) | — | audit shows "recorded against your name" |
| D5 | Contract stage | Only path: **Record the signed agreement** (open by default, A25) | — | badge → Awaiting deposit **without reload** (A26); evidence row reads "Signed elsewhere · recorded by you", not a hash (A27) |
| D6a | If QuickBooks connected: create retainer invoice | Invoice email | **couple:** `retainer_invoice` | pay in QuickBooks sandbox → webhook → Paid |
| **D6b** | Else: **Record the retainer** (bank transfer) | Amount stated on the form before you submit | — | — |
| D7 | Check and confirm booking | "Booking is confirmed"; setup runs | **couple:** `booking_confirmation` | badge → Booked; no "project setup jobs" copy (A29); readiness ring hidden until checkpoints exist (A28) |
| D8 | **Couple's portal** after booking | Nav shows: Your event, Your agreement, Payments, Records, Messages (CP2) | — | contract page says booking completed without StudioCue signing, offers to message |

**Also test here — postpone and re-run:** on the booked job, change the event
date to next year. Expect: state → Postponed; next move → "Re-run the booking
check"; run it; expect Booked again with the signature and retainer preserved.

---

## Phase E — Planning: form, run of show, crew, insurance, balance

| # | Do | Expect on screen | Expect in inbox | Confirm |
|---|---|---|---|---|
| E1 | Send the details form | Returns to the job automatically with a stated confirmation | **couple:** `questionnaire_request` | journey: form waiting on client; next move is **not** "Draft the schedule · from the form" (A19/B5) |
| E2 | **As the couple**, fill and submit the form (leave one required field empty) | "Still needed" badge on **only** the empty field; notice names it (CP4) | — | studio: journey form complete; readiness rises |
| E3 | Run of show → Generate draft (AI) | Draft with assumptions labelled | — | if AI is off, "Build it myself" must be offered **in the error** and seed from the form (B6/B7) |
| E4 | Publish for review | Returns to job | **couple:** `schedule_review` | portal next action: **"Approve your event-day schedule"** (CP3); nav has Event-day schedule |
| E5a | **As the couple**, approve | — | — | studio: journey run-of-show complete |
| **E5b** | Then revise: publish v2 for review | **Portal next action must again be the schedule** — this is the class CP3 fixed; a v2 that goes silent is a regression | **couple:** `schedule_review` again | |
| E6 | Crew: add a crew profile (the crew address) → invite | Directory entry; invite pending | **crew:** `crew_directory_invitation` | Resend works and says it created a separate attempt |
| E7 | Offer the second-shooter role (cascade or direct) | Offer out; studio next move → waiting | **crew:** `crew_invitation` — **check the link is present in the email body** (the 2026-09 incident was a contentless invite) | |
| E8 | **As the crew**, accept the invite → accept the offer | Crew home: "1 invitation to answer" before; after: nothing due; Jobs shows rate and responsibilities | — | studio: Crew confirmed with the reason shown in the rail (A20) |
| E9 | Publish final schedule | — | **couple:** `final_schedule_published`; **crew:** acknowledgement due | crew home: "a schedule to acknowledge"; acknowledge; studio readiness flips |
| E10a | Insurance → Request COI | Request form: required marks; venue email | **you (as venue), if you use your own address:** `coi_request`; later `coi_correction`, `coi_venue_delivery` | inbound COI parsing lands under review with **humanDecision pending** — AI never auto-approves |
| **E10b** | Instead: next-move card → **Not required** | Journey ticks with "This venue does not require one" shown (A20); readiness rises; reference panel drops the row (B8) | — | |
| E11 | Reference panel → the four studio judgements → **Mark done** with a reason; **Waive** one | No `DEPENDENCIES_INCOMPLETE` (B9); a blocked one names its blocker instead of a button | — | audit log has the reason |
| E12 | Final balance: QuickBooks → `final_invoice` email, or **Record the final payment** | — | **couple:** `final_invoice` if provider | `final_payment_reminder` has **no trigger in the codebase** — do not expect it; note it as dead |
| E13 | Lifecycle reminders | Only if a 13:00 UTC run occurs in your window: drafts for `questionnaire_reminder` / `crew_reminder` / `event_reminder` appear in the approval queue, **not** in inboxes | — | approve one → `manual_message` arrives |

---

## Phase F — The day

| # | Do | Expect | Confirm |
|---|---|---|---|
| F1 | Day-before checklist draft | Draft for approval; approve → couple email | **couple:** `event_reminder`-style message |
| F2 | Studio event-day brief (`/studio/event-day?project=`) | Before the day: "On the day · First up: …" with the countdown (B14); one readiness number, matching the job page (B10/B11) | insurance warning absent if E10b was used (B12) |
| F3 | **As the crew**, event-day brief | **A dialable phone number** from B4 under Event contacts (CR3); "The day has passed" only after the date | with B4 blank the brief must say no number is on file and where to add it |
| F4 | On/after the date: mark the event complete | If you leave it: the job page shows "**Did this go ahead?**" reconciliation; the portal must **not** ask the couple to keep planning (CP1) | |

---

## Phase G — After the event

| # | Do | Expect | Expect in inbox | Confirm |
|---|---|---|---|---|
| G1 | Post-production checklist | Backup / editing / gallery-ready ticks; delivery form gated until all three (C1) | — | before ticking, delivery page explains the gate rather than showing a dead form |
| G2 | Record delivery (gallery link, code, expiry) | Returns to job; journey → Delivered | **couple:** `delivery` | portal: "Your photographs" in nav; gallery page live; **before** G2 the portal delivery page must read "being worked on" (CP8) |
| G3 | **As the crew**, submit closeout (hours, expenses) | Crew home before: "1 work record to send in · $X is waiting on it" (CR1); after: cleared | — | studio: closeout to review |
| G4 | **As the studio**, approve closeout → schedule payment | Crew closeout page: Payment scheduled | — | statuses sentence-cased (CR7) |
| G5 | Review request | — | **couple:** `review_request` | portal Reviews page changes from "No review requested yet" (CP6) |
| G6 | Thank-you (scheduler draft or manual) | — | **couple:** `thank_you` | |
| G7 | Closeout → reconcile → close | `CLOSEOUT_BLOCKED` names what is open, never a three-way guess (C2); Closed | — | journey 14/14; Today no longer lists the job |

---

## Phase H — Edits and reversals (the part no happy path covers)

Each of these is a thing a real studio does, and each was a class of finding.

| # | Do | Expect | Confirm |
|---|---|---|---|
| H1 | Change the event date **after** booking | Postponed → re-run booking check (see Phase D) | crew assignments and the schedule carry the new date; couple's portal shows it |
| H2 | Change the venue/city after the proposal is sent | Job page label follows the field — "City" vs "Venue" (A6); proposal document shows no "Venue pending" (A13) | |
| H3 | Cancel a job with a reason | Next-move card says Cancelled and shows the reason; portal and crew reflect it | no "Schedule consultation" on a cancelled job |
| H4 | Resend: proposal, client invite, crew invite | Each creates a separate audited attempt and says so | delivery status per attempt |
| H5 | **Trial expiry** — you cannot wait 14 days, so: what does a lapsed trial see? Check `/studio/subscription` copy and whether any command refuses on `ENTITLEMENT_EXCEEDED` | Today: nothing enforces `trialEndAt` client-side. Expect nothing to lock. **Record that as the finding**: either enforce it or say so | |
| H6 | Sign out and back in as each role; switch workspaces (`/auth/workspaces`) | Right workspace, right data, no leakage between the three identities | |
| H7 | Mobile: repeat F3 and G3 on a phone (Pixel 7 emulation is fine) | Crew workspace is phone-first; insets ≥ 20px (the inset sweep guard covers it) | |

---

## Email checklist — all 32, with what triggers each

Tick as each arrives. Time it. In-app confirmation is the message's
`deliveryStatus` (visible today only on the client-invite panel — everywhere
else, this is a finding to log) and the SendGrid activity feed as the tiebreak.

| Key | Triggered by | Phase | Who gets it |
|---|---|---|---|
| email_verification | register | A2 | studio |
| password_reset | forgot password (test once in H6) | H6 | studio |
| staff_invitation | invite a team member | B8 | staff |
| inquiry_acknowledgement | public inquiry form | C1 | couple |
| manual_message | any approved/sent message | C2, E13, G6 | couple |
| client_message_received | inbound reply | C3 | studio |
| consultation_confirmation | public scheduler booking | C4 | couple |
| consultation_invitation | public scheduler booking | C4 | studio |
| consultation_reminder | **scheduler draft only** | E13 | couple |
| package_follow_up | **scheduler draft only** | E13 | couple |
| proposal_sent | send proposal (and resend) | D3, H4 | couple |
| contract_sent | signing provider — **cannot fire on prod** (none offered) | — | — |
| retainer_invoice | QuickBooks retainer invoice | D6a | couple |
| booking_confirmation | booking gate | D7 | couple |
| client_invitation | invite couple to the portal | D8 | couple |
| questionnaire_request | send the form | E1 | couple |
| questionnaire_reminder | **scheduler draft only** | E13 | couple |
| schedule_review | publish for review | E4, E5b | couple |
| final_schedule_published | publish final | E9 | couple |
| crew_directory_invitation | add to directory | E6 | crew |
| crew_invitation | offer a role | E7 | crew — **verify the link is in the body** |
| crew_reminder | **scheduler draft only** | E13 | crew |
| coi_request / coi_correction / coi_venue_delivery | insurance workflow | E10a | venue |
| final_invoice | QuickBooks final invoice | E12 | couple |
| final_payment_reminder | **no trigger exists — dead template** | — | log it |
| event_reminder | **scheduler draft only** | E13/F1 | couple |
| thank_you | scheduler draft or manual | G6 | couple |
| delivery | record delivery | G2 | couple |
| review_request | request review | G5 | couple |

Expected total in a full run without QuickBooks and without a scheduler run:
**~16 real emails** across the three inboxes. With QuickBooks: +2. Every
scheduler-drafted one you approve: +1.

---

## Escape-hatch checklist — every "it happened outside StudioCue" path

All six evidence-controlled transitions must be crossable by hand, and each
hand-record form must state what it records before you submit.

| Transition / record | Where | Must show before submit |
|---|---|---|
| Consultation happened | next-move card "It already happened — mark done" | — |
| Proposal accepted | job → Record their acceptance → form **opens** on the proposal | who, when, how |
| Agreement signed | contracts page, open by default when no signing app | signer, date, method, optional file |
| Retainer paid | contracts page → Retainer paid outside | **the amount** ("Records $X") |
| Final balance paid | invoices/contracts → Record the final payment | the amount |
| Booking re-checked after postpone | next-move → Re-run the booking check | — |
| Readiness judgement | reference panel → Mark done / Waive | reason ≥ min length; blocker named if any |
| COI not needed | next-move card → Not required | — |
| Gallery delivered elsewhere | delivery → Record the gallery | link, code, expiry |
| Closeout requirement vouched | closeout → attest | which requirements refuse attestation (contract, balance) and say so |

---

## What is *not* a bug — do not log these

- No signing app on the contract page. Deferred on cost; the record path is the product.
- "Studio review" / "Not scheduled" on crew payment until the studio acts.
- Delivery status fifteen minutes behind. Polling, by necessity.
- Reminder emails not arriving. They are drafts, on a daily timer.
- `contract_sent` never firing. No provider to send it.

## What *is* a bug, wherever you meet it

The ten patterns from the studio walk, plus the three that repeated across all
three workspaces: a quantity with two definitions, a page the nav cannot
reach, and the product explaining its own data model to you. The guards hold
the mechanical versions; a walk is for the rest.

---

## After the walk

Put findings in a new `docs/ux-walkthrough-production-<date>.md` in the same
shape as the three existing ones. Anything that repeats a fixed finding is a
regression and jumps the queue. Anything the guards should have caught is a
guard gap and gets recorded in the guard's own comment, as the last two were.
