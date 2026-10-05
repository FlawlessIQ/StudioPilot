# GR feedback: execution plan (2026-10-05)

Gabe ran a full test wedding on production on 2026-10-05 (Dionne Rhodes
Wedding: inquiry 16:10 to booked 16:35, every email delivered) and sent
eleven points. This plan covers all of them, in the order that is safe to
ship. The assessment behind it is in the chat of the same day. The short
version: one regression is ours, two problems are settings, two are product
gaps, one is a discoverability miss, and one is a new feature.

## Already done (needs Gabe's confirmation, nothing to build)

| Point | State |
|---|---|
| "Review reply" needed two clicks | Fixed, 4a294fde. The job page jumps to its #hash once the section renders, and next-move links scroll directly. |
| "# of Invited Guests" was a "100-150" chip | Fixed. GR's template was corrected in place (backup taken, peer-checked). Imports now ask a one-option choice as text (studioImportCommand deployed). |
| Does Albert get an automated email? | Yes. `crewOffers.autoOfferOnBooking` is on, and the crew_invitation went to gershphoto@gmail.com at 16:35:24. |

## Phase 0: guardrails (before any build, and for the whole plan)

Today's "weird stuff" came from four sessions shipping to GR-facing screens
on one day, deploys landing while Gabe was working, and fixes proven by us
but not on his flow. These rules apply to every phase below.

1. **One owner.** One session owns GR-facing changes until this plan is
   done. Other sessions post to it before touching `components/client/*`,
   `components/planning/*`, `features/questionnaires/*`, `features/contracts/*`,
   `app/kit.css` or `app/contracts.css`.
2. **Deploy window.** Deploy functions outside Gabe's working hours (before
   9:00 or after 19:00 ET), or narrowly: only the functions whose compiled bundle
   imports what changed (trace `functions/lib/index.js` exports to the module), with
   `configure-production-function-invokers.sh` chained straight after. Never
   "deploy all" while he is active (it caused his 403 at 15:17Z).
3. **Proven on a production build.** CSS fixes are proven against
   `npm run build && npm run start`, never an injected style tag (see the
   memory note on grid-area). Then grep the built chunk for the rule.
4. **Walked as the couple.** Each batch is walked end to end on prod as a
   FlawlessIQ test couple: inquiry → form → proposal → sign → portal. Phone
   and desktop. Screenshots go in the batch note. Gabe hears "fixed" only
   after the walk.
5. **No silent data edits.** A change to GR's records is backed up first,
   announced to Conor, and preferably done through the product.

## Phase 1: our regression and the hidden forms (small, ship first)

### 1.1 Agreement reads as "one long sentence" in the couple's portal

- **Cause:** `app/kit.css` resets `.kit :where(h1, h2, h3, p, ul, ol, figure)
  { margin: 0 }` (added Sep 29). It ties with `.contract-paragraph` and
  `.contract-heading` in `app/contracts.css` and loads later, so it wins. Lists
  were fixed Sep 30; paragraphs and headings were not. The studio preview is
  outside `.kit`, which is why it looks right there.
- **Fix:**
  - Raise the agreement rules above the reset:
    `.contract-document .contract-paragraph`, `.contract-document .contract-heading`,
    `.contract-document .contract-subheading`, matching what the list fix did.
  - Bold the clause label on render. In `components/contracts/contract-document-view.tsx`,
    a paragraph opening with a short "Label:" renders the label in bold. This
    is presentation only: the stored document and its signing hash are unchanged.
- **Sweep:** list every component rendered inside `.kit` that relies on a
  single-class margin or list style from `globals.css`, `legacy-bridge.css` or
  `contracts.css`, and fix any other casualties in the same batch.
- **Tests:** a guard test that `contracts.css` agreement rules out-rank the
  kit reset (specificity check, as `unstyled-classes` does for class names).
- **Proof:** a production build, couple's `/client/contract` at 393px and
  desktop, screenshot of Dionne-shaped text (separate clauses, bold labels).
- **Deploy:** app only.

### 1.2 Recommended forms invisible on the per-job send screen

- **Cause:** `app/studio/questionnaires/page.tsx` renders
  `<RecommendedQuestionnaires />` only without `?project=`. Gabe reaches the page
  from the job's "Send the form", which always has `?project=`.
- **Fix:** on the per-job screen, show the recommended forms below the
  library (a compact version: name, one line, "Make a copy"). After copying,
  the new form is immediately assignable in the same picker.
- **Tests:** a render test that the project branch includes recommended
  forms for owners and admins, and not for other roles.
- **Deploy:** app only.

**Phase 1 exit:** both walked on prod. Gabe sees the Event details form and
Final schedule from the job's "Send the form", and Dionne's agreement reads
as separate clauses.

## Phase 2: Gabe's forms, set up properly (settings and data, with his OK)

Order matters. The inquiry form must switch before the old one is archived.

1. **Copy** the two recommended forms into GR: "Event details form" and
   "Final schedule". Gabe clicks "Make a copy", or we do it with his OK.
2. **Inquiry form:** set "Which form new wedding inquiries fill in"
   (`leadCaptureSettings.inquiryEventForm`) to GR's copy of the **Event details
   form**. That delivers "event details form with the initial email": the
   first reply already links to the form-then-pick-a-time page.
3. **Planning timeline:** Settings → Planning timeline: form = **Final
   schedule**, send = **automatically**, 6 months, lock 28 days. Phase 4 adds
   the "at signing" send.
4. **Archive** (never delete) the old wedding forms: Wedding Event Info, Client
   Event Details, Wedding Photography Venue Form, and both Wedding Planning
   Questionnaires. Existing responses (Dionne's) keep working, because they
   reference the template id.
5. **Corporate Shoot Brief and Sports Day Brief:** keep them unless Gabe says
   otherwise (question 1). He runs about 200 non-wedding jobs a year.

- **Check after:** submit a test inquiry on GR's link (with Gabe's
  agreement, or on FlawlessIQ with the same setup). The form shown is the Event
  details form, and its answers land in Schedule A.
- **Risk:** archiving the form currently used as the inquiry form strands new
  inquiries. Step 2 first, and verify before step 4.

## Phase 3: one address, asked once (gap), then sales tax (setting)

### 3.1 Reuse the couple's address at signing

- **Today:** the signing step (`features/contacts/billing-address-signing.ts`,
  `server/contracts/signing-billing-address.ts`,
  `components/client/billing-address-step.tsx`) pre-fills only from the
  contact's `billingAddress`. Dionne gave "140 Briarwood Rd, Florham Park, NJ"
  in the form at 16:19 and was asked again at 16:34.
- **Build:**
  - When no billing address is on file, look for an address answer in the
    job's submitted questionnaire responses, using the existing fact map
    (`functions/src/planning/questionnaire-fact-map.ts`). An address-type field,
    or one whose label maps to `billing_address`.
  - Pre-fill the step with it and a "This is my billing address" tick. The
    couple confirms with one tap or edits.
  - **The signer's own address wins.** Prefer an answer labeled for the signer
    (bride or groom, matched to the signer's name or email). With two
    different addresses and no clear owner, show both as choices rather than
    guess.
  - The address stays out of the signed document and its hash. That is
    unchanged.
- **Tests:**
  - a form answer pre-fills;
  - an answer is never applied without the couple confirming;
  - two partners' addresses produce a choice, not a guess;
  - an amendment with an address on file stays hidden (existing rule).
- **Deploy:** the app (the signing route lives in `server/`), plus any function
  that imports the changed planning modules, traced from `functions/lib/index.js`.

### 3.2 Sales tax on (Gabe's action, after 3.1 is live)

- GR has itemised QuickBooks invoices on (Oct 1). The only missing piece is
  **Settings → QuickBooks → "Add sales tax (QuickBooks calculates it)" → Save**
  (`billingSettings.salesTax.mode = "quickbooks"`).
- **Effect:**
  - New proposals and agreements show "$X plus sales tax" with an estimate.
  - The retainer stays on the pre-tax total.
  - QuickBooks taxes the **final** invoice from the billing address.
  - The address becomes **required** at signing.
- Existing bookings, including Dionne's, keep their priced decision.
- **Walk:** a new FlawlessIQ test proposal with tax on. Check the proposal and
  agreement wording, the signing address (pre-filled from the form), and a
  QuickBooks sandbox final invoice with tax.

## Phase 4: Final schedule at signing, and a review at 6 months (gap)

Gabe: "Final schedule should be sent after contract signed, and then again
6 months out."

- **Extend the planning timeline** (`features/planning/planning-timeline.ts`,
  mirrored in `functions/src/planning/planning-timeline.ts`; drift test):
  - `sendAtBooking: boolean`: send the planning form the moment the booking
    is confirmed. Hook where `studio_booking_confirmed` is queued in
    `functions/src/booking/orchestration.ts`, using `sendNewQuestionnaire`
    (`send-questionnaire.ts`).
  - `reviewAtFormMonths: boolean`: at the existing N-months date, if the form
    was already sent at booking, ask the couple to **review and update** the
    same response ("Your final schedule, six months out: anything changed?").
    The existing `amendingReturned` path lets them edit. If it was never sent,
    send it, as today.
- **Guards (all existing rules, applied to both sends):**
  - quiet bookings (imported, paused, on hold) never get an automatic couple
    email (ADR 0005);
  - `clientOutreachStop`;
  - the scheduler re-reads the project before sending;
  - no review request after the details lock;
  - no double send (idempotent per job and kind).
- **Today:** "remind" studios see "Send the final schedule" at booking and
  "Ask them to review it" at N months, instead of automatic sends.
- **Settings UI:** two switches under Planning timeline, worded in Gabe's
  terms.
- **Tests:**
  - at-booking send happens once;
  - the review request happens only after an earlier send;
  - quiet bookings are excluded;
  - lock respected;
  - mirror drift.
- **Deploy:** functions that import `planning-timeline`, `send-questionnaire` or
  `booking/orchestration` (traced from `functions/lib/index.js`; likely `bookingCommand`,
  `planningFormScheduler`, `operationsTaskWorker` and the readiness triggers),
  plus the app. Run the freshness script after.

## Phase 5: Photo list milestone (Albert's point, new feature)

Blocked on Gabe's answers (questions 3 to 5). Proposed default, to
confirm with him:

- **What:** a "Photo list" form for the couple: family groupings in order,
  must-have shots, people to capture (VIPs, who to point out). Built from the
  Final schedule's family names so they aren't asked twice.
- **When:** due before the details lock (28 days out). Sent with the Final
  schedule review at 6 months.
- **Journey:** a `photo_list` step between `schedule_form` and `run_of_show` in
  `features/journey/steps.ts`, owned by the client, with its own reminder.
- **Crew:** shown on the crew day sheet beside "From the client's brief", so
  Albert has it on the day without asking.
- **Readiness:** a checkpoint that warns rather than blocks, unless Gabe wants
  it to block.
- **Tests:** journey step ordering, crew day sheet visibility, readiness.

## Phase 6: prove it on prod, then tell Gabe

1. Walk a fresh FlawlessIQ wedding as the couple and as the studio, phone and
   desktop: inquiry → Event details form → consultation → proposal (plus sales
   tax) → sign (address pre-filled) → Final schedule arrives → portal agreement
   readable → crew offer → Today.
2. Send Gabe one message: what changed, what he needs to switch on, and the
   two or three things to try.

## Questions for Gabe (one message, before Phases 2, 4 and 5)

1. Archive only the old wedding forms, or the corporate and sports briefs too?
2. At 6 months, should the couple update the **same** Final schedule they
   filled in after signing, or get a fresh one?
3. Photo list: its own form, or a section of the Final schedule?
4. When is it due: with the final details (4 weeks out) or earlier?
5. Should Albert and the crew see it on their day sheet? Should a missing
   photo list block "ready for the day" or only warn?

## Order and sizes

| Phase | What | Who | Size | Ships |
|---|---|---|---|---|
| 0 | Guardrails | Claude, Conor | none | now |
| 1 | Agreement spacing and bold labels; kit-reset sweep; recommended forms on the job screen | Claude | small | app only |
| 2 | Copy forms, set the inquiry form and planning timeline, archive old forms | Gabe or Claude with OK | small | settings and data |
| 3 | Address from the form at signing; then sales tax on | Claude; then Gabe | medium | functions and app |
| 4 | Final schedule at signing and a review at 6 months | Claude | medium | functions and app |
| 5 | Photo list milestone | Claude, after answers | medium to large | functions and app |
| 6 | Prod walk, then one message to Gabe | Claude, Conor | small | none |
