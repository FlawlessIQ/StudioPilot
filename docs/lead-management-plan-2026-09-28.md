# Lead management — from first email to booked (2026-09-28)

Follows `docs/execution-plan-lead-capture-2026-09-25.md`, which got inquiries
*in*. This plan is about what happens once one is in: replying, following up,
getting to a consultation, and ending every inquiry somewhere — booked or
closed, never left open.

**Outcome.** A couple fills in the studio's website form. It reaches Gmail and
StudioCue on its own. Today shows a reply that answers the date and carries one
personal link: *tell us about your day, then pick a time to talk*. If they go
quiet, StudioCue drafts two follow-ups and then offers to close it. If they book
a call, the job moves to Consultation, the invite goes out in the format they
chose, and they can reschedule it themselves. They become a client the moment
they book. The studio's part is tapping Send.

---

## Status (2026-09-28, end of day)

All six phases are built and deployed to production (functions verified
current, app rollouts verified by commit).

| Phase | Commit | Notes |
|---|---|---|
| 0 | a30795f | Envelope-first recipients; per-couple form rate limit |
| 1 | 81fd926 | Short address, trusted by sender |
| 2–3 | c1a4bff | Inquiries become jobs; Inquiries tab; whose-move from the thread; AI review out of the nav. Three open dated leads on production were migrated (two jobs; a duplicate linked) |
| 4 | e0712fe | `/i/<token>` — details, then time and format; self-reschedule/cancel; link in every reply |
| 5 | 9bb5673 | Follow-ups day 3/7, close offer day 14 (`inquiryFollowUpScheduler`); LOST state; close/reopen; auto-reopen on reply |
| 6 | (this commit) | New-inquiry alert email; Insights; maybes drafted only on confirm; dead code and statuses removed; leads server-write-only |

**Deviations from the plan above**

- **Phase 1 trust** reads SendGrid's `SPF`/`dkim` fields and Gmail's
  `+caf_` envelope sender; both are unverified against a real Gmail filter
  forward (0.3 is still owed). Failure is safe: an untrusted forward lands
  in "Maybe an inquiry", never dropped.
- **Phase 2** keeps the lead document as the capture record beside the job
  rather than folding it in; a lead with a job is `converted` and its page
  hands straight to the job.
- **Phase 4.4 pricing** is not built — it waits on whether the studio wants
  pricing in the first reply.
- **Phase 5** adds "They replied elsewhere" (restarts the follow-up clock and
  withdraws the drafted nudge) and "Keep it open" (ask again in a week).
- **Phase 3 AI review** stays addressable, linked from Today's "handled for
  you" for failed/scheduled receipts; it is only off the nav.

**Still needs a person**

- A real website-form inquiry through a Gmail filter forward on production
  (0.3), to confirm Phase 0/1 end to end.
- Whether the first reply should carry pricing (4.4).

---

## Decisions taken (2026-09-28)

| # | Decision | Taken |
|---|---|---|
| D1 | The first reply carries **one combined link**: details, then consultation booking | Conor |
| D2 | Follow-ups on **day 3 and day 7**, then offer to close on **day 14** | Conor |
| D3 | An inquiry becomes a **client when booked** (contract signed + retainer paid, the existing booking gate) | Conor |
| D4 | A **short forwarding address** (`<slug>@inbound.studio-cue.com`), trusted by who sent it | Conor |
| D5 | An **Inquiries** entry in the left nav; **AI review** leaves the nav | Conor |
| D6 | One record from start to finish: an inquiry becomes a job as soon as it is a confirmed inquiry with a date | Recommended, see *The model* |
| D7 | The closed-without-reply outcome is labelled **"Went quiet"** | Default; one string to change |

Still open:

- **Pricing in the first reply?** It depends on Gabe. Either answer fits
  Phase 4, where it becomes a studio setting.
- **New-inquiry alert channel:** email by default, push if available.
- **Phone bottom bar:** should Inquiries take Clients' slot?

---

## The experience

1. **Arrives.** The website form emails Gmail, and a Gmail filter forwards it to
   `gr-productions@inbound.studio-cue.com`. No manual forwarding.
2. **Studio is told.** "New inquiry — Sarah & Tom, 14 Jun 2027, date free."
3. **Reply is ready.** It thanks them, answers the date, and carries their
   personal link. If consultation hours aren't set, the card says so right there
   rather than sending a reply with no link. One tap sends it.
4. **The couple opens the link.**
   - Step 1 asks only for what is still missing, pre-filled with what they
     already told us.
   - Step 2 offers times from the studio's hours and lets the couple choose
     Zoom or in person, from the formats the studio offers.
   - Booking creates the consultation, sends the calendar invite and Zoom link,
     and moves the job to Consultation.
5. **If they answer by email instead,** that reply lands on the thread. The
   drafted answer carries the same link and a line on how booking works.
6. **If they go quiet,** a nudge is drafted on day 3 and again on day 7.
   - Before each one the card asks *Still waiting on them?*, with *They replied
     in Gmail* as an answer.
   - On day 14 it offers **Close as went quiet**.
   - A closed inquiry **reopens itself** if they write back.
7. **Date taken.** The draft is a kind decline. Sending it offers **Close — date
   taken**.
8. **Reschedule.** Every confirmation and reminder carries *Reschedule /
   Cancel*. The couple picks a new time, calendar and Zoom update, and the
   studio gets an FYI.
9. **Booked.** The contract is signed and the retainer paid. The contact
   becomes a client (`functions/src/contacts/promotion.ts` already does this),
   and the job leaves Inquiries for Jobs.

---

## The model

**Today there are two "not booked yet" records.** A lead (`leads`, status
`new`) comes from the form and from forwarding. A job in `LEAD` state comes from
New job, share-to-app and conversion. Consultations, booking links, package
matching, questionnaires and workflow automations only work on the job, so the
lead is a waiting room the studio has to convert out of by hand before anything
useful can happen.

**Target: the lead is the capture record, and the job is the inquiry.**

- A lead is **converted automatically** when it is a confirmed inquiry
  (form: always; capture: verdict `inquiry` or studio-confirmed) **and it has a
  date**.
- A lead with no date **waits** until the date arrives, from the couple's link
  or a studio edit, and then converts. Dateless wedding inquiries are the
  minority, and the combined link asks for the date first.
- "Maybe an inquiry" captures stay leads. **Spam never becomes a job.**
- **Why not make jobs dateless instead?** `eventDate` is read in 38 files in
  `functions/src` and 69 in the app, and `features/projects/schema.ts` requires
  it. Holding the few dateless inquiries back is far cheaper and safer.

**States.** The pre-booking states already exist (`LEAD`, `CONSULTATION`,
`PROPOSAL`, `CONTRACT_PENDING`, `RETAINER_PENDING`). The gap is ending one:
`CONSULTATION` and `PROPOSAL` can only go to `CANCELLED` or `POSTPONED`
(`features/projects/state-machine.ts`), which mean a booked wedding called off.
Add a **`LOST`** state, reachable from every pre-booking state, carrying a
reason (`went_quiet`, `booked_elsewhere`, `budget`, `date_taken`, `not_a_fit`,
`other`). It can go back to the state it closed from, and does so on the
couple's next inbound message.

**Who owes the next move** is derived from the thread (last inbound vs last
outbound), never stored by hand. That derivation replaces the missing "reply
sent" record that makes Today re-show answered inquiries as new, and it drives
Today, the Inquiries stages and the follow-up clock.

---

## Phases

Each phase ships on its own and is walked on prod with a real email before it
is called done.

| Phase | What ships | Build |
|---|---|---|
| 0 | Stop losing inquiries (the two P0s) | ½ day + a prod walk |
| 1 | Short forwarding address | ≈2 days |
| 2 | One record: inquiries become jobs | ≈5 days |
| 3 | Inquiries tab, "who owes the next move", AI review out of the nav | ≈3 days |
| 4 | First reply does real work: the combined link, the couple picks the format, self-reschedule | ≈6 days |
| 5 | Follow-ups and closing | ≈4 days |
| 6 | New-inquiry alert, Insights, cleanup | ≈3 days |

### Phase 0 — Stop losing inquiries

| # | Change | Where | Proof |
|---|---|---|---|
| 0.1 | Read the inquiry token from the **envelope first**, then `to`, then the header. A Gmail filter forward keeps `To:` as the studio's own address; only the envelope has `inquiries+…`. Reuse the envelope-first parsing in `post-event/inbound.ts:32-41`. | `functions/src/communications/inbound.ts:109-116` | Fixture: auto-forward with `To:` = studio, envelope = inquiry address, which becomes a lead |
| 0.2 | Rate-limit the public form **per couple**. The relay forwards only a fixed header list, so `requestFingerprint` sees App Hosting's address and the 6th inquiry in an hour, from anyone, gets a 429. Prefer `x-studiohub-client-ip`, which the relay sets. | `functions/src/crm/security.ts:30-34` | Unit test: two client IPs, separate buckets |
| 0.3 | **Prod walk:** a real website form, into a real Gmail filter forward, becomes a lead. Keep the raw message as the first real fixture. | — | Needs Conor to send one |

### Phase 1 — Short forwarding address (D4)

- Accept `<slug>@inbound.studio-cue.com` alongside the signed address. The
  signed address keeps working forever. It is the same MX, so **no DNS change**.
- **Trust comes from who sent it, not from a secret in the address:**
  - **Trusted:** one of the studio's own addresses (owner/admin membership
    emails, the notification address) with SPF or DKIM passing.
  - **Watch this — Gmail auto-forward keeps the original `From:`** (the form
    builder), so a filter forward is trusted through its envelope sender. Gmail
    rewrites that to `studio+caf_=…@gmail.com`, which is SPF-checked against
    gmail.com. Confirm the exact shape with the Phase 0.3 fixture before
    building on it.
  - **Also trusted:** a sender the studio has already confirmed
    (`inquirySenders`), which covers a form that emails StudioCue directly.
  - **Anything else** goes to the **Maybe tray**, never dropped and never a lead
    that auto-converts.
- Reserve local parts that can never be a slug: `reply`, `gallery`,
  `inquiries`, `postmaster`, `abuse`.
- Setup shows the short address, with a copy button and a "save as a Gmail
  contact" hint.
- Files: the dispatcher regex (`app/api/webhooks/sendgrid/inbound/route.ts`),
  `forwarded-inquiry.ts`, `inbound.ts`, `communications/commands.ts`
  (`getLeadCaptureSetup`), and `components/intake/lead-capture-setup.tsx`.

### Phase 2 — One record (D6)

| # | Change |
|---|---|
| 2.1 | Auto-convert inside `captureInquiry` and `publicLeadIntake` when the conditions in *The model* hold. Contact + job + lead in one transaction, with a deterministic idempotency key, which fixes the duplicate contacts that two-call conversion creates today. |
| 2.2 | Convert a waiting lead when its date arrives (`updateLead`, the combined link). |
| 2.3 | **Dedupe against jobs too**: a repeat email from a couple whose job is in `LEAD` attaches to it, and doesn't create a new lead (today `ACTIVE_STATES` in `capture.ts:50` excludes `LEAD`). Lower-case form emails so the two doors match. |
| 2.4 | **Nothing client-facing runs before `BOOKED`.** Audit every scheduler and automation for pre-booking jobs: lifecycle (already `BOOKED`+ in `lifecycle-core.ts`), questionnaire reminders, review/album, readiness, crew, workflows. Add a guard test, as `import existing bookings` did for its six guards. |
| 2.5 | Date clash counts pre-booking jobs, and other inquiries on the same date show as **competing**, not as conflicts. |
| 2.6 | Migrate open leads that have a date. The leads page reads both until Phase 3 replaces it. |
| 2.7 | Fix the two reply paths that drop the thread anyway: `requestMessageDraft` `structuredOutput` (no `leadId`/`contactId`) and `replyToConversation` (no `leadId`). |
| 2.8 | Counts that should mean weddings (Insights, actions per wedding) filter to `BOOKED`+. |

`lead_created` workflows start firing here, because the job has a `projectId`.
Check that no studio has a live rule on that trigger that would surprise them.

### Phase 3 — Inquiries tab (D5)

- **Nav:** add **Inquiries** under Workspace. Stages are *New* (waiting on you,
  never replied), *Talking*, *Consult*, *Proposal* and *Signing*
  (contract/retainer pending), with a *Closed* filter for `LOST` by reason, plus
  the Maybe tray. **Jobs** becomes `BOOKED` onward.
- **Who owes the next move** is derived from the thread (see *The model*).
  Today shows only inquiries where it's the studio's move.
- **Global search** includes inquiries.
- **AI review leaves the nav.**
  - Today already shows every pending approval (`features/today/inbox.ts:1089`).
  - About 12 files link to `/studio/ai-queue`; repoint them to Today or the job.
  - Check whether it is the only place **past** AI decisions can be seen. If
    so, keep that history reachable (per job, or under Insights). Keep the
    route addressable.

### Phase 4 — The first reply does real work (D1)

| # | Change |
|---|---|
| 4.1 | **Personal inquiry link**: a token per job, one public page with two steps. Step 1 asks only for missing fields, pre-filled. Step 2 is booking. This is not the booked-client questionnaire, which stays in the portal. |
| 4.2 | **The couple chooses the format.** The studio sets which formats it offers (Zoom, in person with its address, phone); `public-scheduling.ts` `book` takes `mode`. Today the studio picks it when creating the link. |
| 4.3 | **Self-reschedule / cancel** from the confirmation and every reminder, reusing `rescheduleConsultation`'s calendar and Zoom handling. Studio FYI on Today; `no_show` is already a status. |
| 4.4 | The intake reply draft is given the link, the date answer and (if the studio opts in) pricing. It stops inventing a next step. |
| 4.5 | The inbound-reply draft on an inquiry includes the same link plus a one-line explanation. |
| 4.6 | If hours aren't set, the reply card says so inline (the setup step already blocks when inquiries are waiting, `features/today/setup-gaps.ts:207`). |

### Phase 5 — Follow-ups and closing (D2, D7)

- **Nudges on day 3 and day 7** from the last outbound message with no inbound
  since.
  - They are **template-based and approve-first**. They stay on approval
    until StudioCue can see the studio's Gmail, because a nudge to a couple who
    already replied there is the worst outcome here.
  - They are cancelled by any inbound message, a booked consultation, or a
    close, and **re-read the job before sending** (the rule in
    `scheduled-client-email-must-recheck`).
- **Day 14:** Today offers *Close as went quiet*. It is one tap and can be
  undone.
- **Cards waiting on the couple** carry: *Heard from them in Gmail? Forward it —
  it lands here.* Capture already attaches a forward to the open inquiry by
  email.
- **Close is not "Not an inquiry."**
  - *Close* records a reason and teaches nothing.
  - *Not an inquiry* is for spam and learns the sender.
  - Today they are the same action, which teaches capture to ignore real
    couples.
- **Auto-reopen** on inbound to a `LOST` job.
- **Date taken:** a decline draft, then an offer to close with the reason
  `date_taken`.

### Phase 6 — Know, learn, clean up

- **New-inquiry alert** to the studio: a new email type rendered by
  `operationsTaskWorker`, so **verify that function's deployed bundle** (see
  CLAUDE.md, deploy rule 6).
- **Insights:**
  - Sources by `source`/`formBuilder`, not `referralSource`.
  - Speed to first reply.
  - Win rate by source.
  - Why inquiries close.
  - The inquiry count excludes spam.
- **Delete** `LeadIntakeService`, `LeadsRepository`, `parseForwardedInquiry`,
  the duplicated intake Zod schema, and the five lead statuses nothing sets.
  Tighten `firestore.rules` so leads are updated only through commands.
- **Maybe captures stop getting an AI reply draft**; it's drafted when the
  studio confirms.

---

## Risks

- **Auto-created jobs are visible everywhere jobs are.** Phase 2.4 and 2.8 are
  the guard. Walk Today, Jobs, Calendar and Insights with a fresh inquiry
  before shipping Phase 2.
- **Trust by sender (Phase 1) depends on headers we haven't seen from a real
  Gmail filter forward.** Phase 0.3 must produce that fixture first.
- **Deploy order.** Functions first, then the app. Each phase touches shared
  modules (`communications/`, `intake/`), so run
  `./scripts/verify-deployed-function-freshness.sh` after every functions
  deploy.
