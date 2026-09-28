# COI automation — plan, 2026-09-28

**The ask.** The certificate of insurance (COI) is one of StudioCue's main
selling points. Automate it from the inquiry onward:

1. The inquiry form asks **"Does your venue require a COI?"** and captures the
   venue's details.
2. At onboarding, or later in settings, the studio saves its **insurance
   agent's** contact details.
3. StudioCue **emails the agent a COI request** with the event and venue
   details already filled in.
4. It **follows up every few days** until the COI arrives.
5. Once it arrives, the studio gets a **"Send COI to venue" task that it only
   needs to approve**.

---

## What exists today (audit)

Most of the pipeline is already built. What's missing is the start, which
depends on typing the details in by hand, and the finish, which takes two
separate manual clicks.

| Stage | Today | Where |
|---|---|---|
| Venue needs a COI? | `project.insuranceRequired` (unknown / required / not_required). It can only be set by hand or by Cue. | `features/projects/schema.ts:61` |
| Agent contact | **Not stored anywhere.** It's typed into the request form each time. `insurance_agent` exists as a vendor or contact type, but nothing links it to the COI. | `coi-workflow-panel.tsx:372` |
| Create the request | **Manual only.** `createCoiRequest` needs the venue's legal name, address, submission email and the agent's email. | `planning/commands.ts:979` |
| Email to the agent | `coi_request` template. The agent replies to a `coi+<token>@` address. | `email-templates.ts:688` |
| Inbound COI | Matched by token. Exactly one PDF is stored and the status becomes `received`. | `planning/inbound.ts:73` |
| Scan + AI extraction | Scan, then extraction, then `under_review` with `humanDecision: pending`. | `file-safety.ts:430`, `ai-pdf.ts:698` |
| Chasing | `coiChaseScheduler` runs daily. It chases only `requested`, **every 7 days, at most 3 times**. It resends the same email (no reminder wording), ignores the due date and never escalates. | `planning/coi-chase-scheduler.ts` |
| Studio decision | `decideCoi` (owner/admin, reason required). Approve writes `documents/coi_{id}`. Reject emails the agent with `coi_correction`. | `commands.ts:1088` |
| Send to venue | A separate manual click on /studio/insurance. It emails the PDF to `submissionEmail`. | `commands.ts:1178`, `jobs.ts:762` |
| Today | **No COI card in any lane.** The drafts lane can't address a venue, because `communicationDrafts` must go to a client contact. | `features/today/inbox.ts` |

### Inquiry side

- **The public form** (`/inquiry`, `components/crm/lead-intake-form.tsx`) has
  one `venue` string field. The place lookup **finds the full address and then
  throws it away**, keeping only the label. Conversion then sets
  `project.venue: null` (`intake/convert.ts:166`).
- **There's no COI question and no venue contact.** Studios can't add fields
  of their own.
- **The schema is written twice**, once in `features/leads/schema.ts:37` and
  once in `functions/src/crm/public-lead.ts:36`, so every new field goes in
  both.
- **Emailed and forwarded forms** use `LeadFieldKey` label patterns
  (`intake/form-email.ts:80`) and AI enrichment (`intake/enrich.ts`). Neither
  knows about COI.
- **Work in progress in another session:** the per-couple inquiry link
  (`app/i/[token]`, `couple-inquiry-page.tsx`, `intake/inquiry-link.ts`
  `DETAIL_FIELDS`). New venue and COI fields belong there too. **Coordinate
  before touching those files.**

### Defects found in the current COI flow

| # | Defect | Where |
|---|---|---|
| C1 | **A late PDF overwrites an approved request.** Inbound checks neither the request's status nor the sender. | `planning/inbound.ts:89-123` |
| C2 | **The correction email has no `coi+` reply address**, so the agent's corrected PDF goes to the studio's inbox and never comes back to StudioCue. | `commands.ts:1120-1132` |
| C3 | **The journey counts `approved` as done, but readiness requires `sent_to_venue`.** The two disagree about the same wedding. | `steps.ts:784`, `checkpoint-evidence.ts:220` |
| C4 | **`under_review` is shown as "waiting on someone else"**, but it's the studio's move. | `steps.ts:784-819` |
| C5 | **`awaiting_response` and `venue_acknowledged` are never written.** | schema vs writers |

---

## Design

### 1. Studio insurance settings (onboarding + Settings → Insurance)

- A new doc, `coiSettings/{tenantId}`, editable by owners and admins only:
  - **How you get certificates:**
    - `agent`: an agent or broker who emails them; or
    - `self_serve`: your insurer has a portal where you generate them
      yourself, as Hiscox, NEXT, Thimble and Full Frame do.
  - **The agent:** name, agency, email, phone, plus an optional CC for the
    studio owner.
  - **Self-serve:** a portal URL.
  - **Defaults:** the lead time (see decision 1), how often to chase, the
    maximum number of chases, and standard notes for the agent.
  - **Automation dial** (the same trust pattern as `lifecycleMessaging`):
    `off`, `prepare` or `auto`, default `prepare`. Owner-only and audited.
    - `prepare`: StudioCue drafts the request and the studio approves it from
      Today.
    - `auto`: StudioCue sends it.
- **Setup:** add a sixth, skippable question to the setup conversation:
  "Who sends your certificates of insurance?"
- **Existing studios:** a Today nudge the first time a job is marked
  COI required and no agent has been saved.
- **Self-serve mode** replaces "email the agent" with a Today task: "Generate
  the COI in your insurer's portal". It has copy buttons for the holder name,
  address, event date and wording, and a place to drop the PDF. Everything
  after the PDF arrives is the same. **Many wedding photographers insure this
  way, so an email-only flow would miss them.**

### 2. Capture at inquiry

- **The public form** gets **"Does your venue require a certificate of
  insurance?"** with the answers Yes / No / Not sure. When the answer is
  Yes, it also shows optional **venue coordinator name + email**.
- **Keep the address the place lookup already found:** store the `venue`
  place on the lead and carry it to `project.venue` at conversion. A COI
  needs a real postal address.
- **At conversion:**
  - the answer maps to `project.insuranceRequired`, with Not sure becoming
    `unknown`;
  - the venue contact becomes a `vendors` record of type `venue`, linked by
    `projectIds`.
- **Emailed forms** get new `LeadFieldKey`s (`coiRequired`,
  `venueContactName`, `venueContactEmail`), label patterns for them, and the
  same keys in the enrichment schema.
- **The couple's personal inquiry link** (the other session's work) asks the
  same question when it's missing.
- **Studios still have the final say:** the job page keeps the existing
  setting, because couples often don't know the answer.

### 3. Venue memory

- A COI for a venue the studio has shot at before should need **no typing**.
  Key the `insuranceRequirements` on the venue (place id, falling back to a
  normalised name), so the second wedding there pre-fills:
  - the certificate holder
  - the legal name
  - the additional-insured wording
  - the limits
  - the submission email.
- **This is the compounding value:** every COI makes the next one at that
  venue free.

### 4. Automatic request

- **Trigger:** a new job, `coiAutoRequest`, which runs on project writes plus
  a daily sweep. It fires when all of these hold:
  - `insuranceRequired == "required"`
  - the job is **booked** (past the booking gate)
  - there is no live request yet
  - the studio has saved an agent and the dial isn't `off`
  - the `coiEnabled` entitlement is on
  - the timing rule says it's time (decision 1).
- **Recheck at send time** whether the job is paused, cancelled or archived,
  following the scheduled-client-email rule. It uses the idempotency key
  `coi_auto_{projectId}`, and the automation run is created before any side
  effect.
- **Relax `createCoiRequest`:** only the venue name + address and the agent
  are needed to ask for the certificate. The venue submission email becomes
  optional until it's time to send to the venue.
- **When details are missing** (no address, or `unknown`), it doesn't send.
  Instead it puts a card in Today: "COI for Harper Lane — confirm the venue
  address", and one click resumes the automation.
- **Not sure → ask the venue** (optional slice): a prepared email to the
  venue coordinator asking whether they need a COI and what it should say,
  which the studio approves.

### 5. Chasing v2

- **Cadence:** every **3 days** by default (set in the studio's settings),
  and every day in the final week before the due date.
- **Chase `correction_required` too**, not just `requested`.
- **Reminder wording:** a real follow-up ("Following up on the certificate
  for…, due {date}") that uses `chaseNumber`, which the template currently
  ignores.
- **Escalation:** after the maximum number of chases, or 5 days before the
  due date, **stop emailing and tell the studio**. A Today card reads "Your
  agent hasn't sent the COI for Harper Lane — due Fri" and shows the agent's
  phone number.

### 6. Review + send to venue: one approval

- **When the COI arrives**, a Today card appears: **"COI ready for Harper
  Lane"**. It has:
  - the PDF preview (the H1 file chip);
  - the AI checks as ticks and crosses: holder name, venue address,
    additional insured, limits, and policy dates covering the event date;
  - the venue email it will go to.
- **One button: "Approve & send to venue".** It runs `decideCoi(approve)` and
  then `sendCoiToVenue` in one command.
  - If any check fails, the button changes to **"Ask agent to correct"**,
    which prefills the correction reason.
  - If there's no venue email, the card asks for one inline.
  - AI stays advisory: the human always approves, and AI never sets
    `humanDecision`.
- **After it's sent**, the venue's reply can mark the COI
  `venue_acknowledged`. That needs a `coi+` reply-to on the email to the
  venue, which fixes C5.

### 7. Fix what's there (C1–C5)

- Inbound accepts a PDF only in `requested`, `awaiting_response` or
  `correction_required`. Anything else is logged and dropped (C1).
- The correction job gets the `coi+` `replyAddress` (C2).
- The journey and readiness both treat `sent_to_venue` as done (C3).
- `under_review` becomes the studio's move (C4).

---

## Ship order

| # | Slice | Size | Notes |
|---|---|---|---|
| 0 | C1–C5 fixes | S | Independent. Worth doing now: C1 can destroy an approved COI. |
| 1 | `coiSettings` + Settings → Insurance + setup question + self-serve mode | M | |
| 2 | Inquiry capture (both schemas, emailed forms, enrichment), keep venue place, conversion mapping | M | **Coordinate with the inquiry-link session** |
| 3 | Venue memory for requirements | S–M | |
| 4 | `coiAutoRequest` + timing rule + relaxed create + "missing details" card | M | Functions deploy |
| 5 | Chasing v2 + reminder wording + escalation card | S–M | Render worker: verify the deployed bundle |
| 6 | Today "COI ready" card, with one-click approve & send | M | Uses H1's preview |
| 7 | "Not sure → ask the venue" (optional) | S | |
| 8 | Walk on prod: Conor's own address as the "agent", a real venue email | — | Needs Conor |

Slices 4–6 touch `functions/` and add email wording. Follow the
render-worker rule in CLAUDE.md: check the deployed `operationsTaskWorker`
bundle, not just the commit.

---

## Open decisions

1. **When to ask the agent.**
   - Recommended: **once the job is booked, but no earlier than 60 days
     before the event** (the studio can change the number).
   - Why not at booking: a COI issued 14 months out may show a policy that
     renews, and so appears to lapse, before the wedding.
   - Why not at inquiry: requesting a COI for a lead that never books
     wastes the agent's time.
2. **Automation dial default:** `prepare`, with the studio approving the
   first send (recommended), or `auto` from the start?
3. **Chase cadence:** every 3 days, at most 4 chases, then escalate
   (recommended)?
4. **Self-serve insurer mode in v1** (recommended), or agent email only?
5. **One click to approve and send to the venue when every check passes**
   (recommended), or keep them as two steps?
6. **Is the COI question required on the inquiry form?** Recommended:
   optional, with Not sure as an answer. A required question adds friction to
   the one form that has to convert.
