# First-run walkthrough — findings backlog

Walked as a **non-technical studio owner who has never used StudioCue**, on a
**brand-new studio with no data**, from register to closeout. The existing demo
job is fully populated and hides what a new owner actually meets: empty states,
absent defaults, and steps that assume prior setup.

The rule applied at every step: *from what is on screen right now, can I tell
what just happened, and what to do next?* If answering needs the URL, the
database, or knowing how the product is built, it is a finding.

## How to run this

Against a **production build**, not the dev server:

```bash
firebase emulators:start && npm run seed
npm run build && npm run start
```

`/auth/onboarding` cold-compiles in **130 seconds** under `next dev` and serves
in **0.17s** under `next start`. Every "hang" in the first attempt was that,
not the product — including a sign-in that appeared to lock up for ever. The
same effect explains the AI schedule generate that "never returned" in 90s and
why the inset sweep needs a warm pass.

## Defect patterns

Every finding is tagged with one of these. They are derived from what was
already found by hand, so the list is evidence, not theory.

| # | Pattern |
|---|---|
| 1 | No way to say "doesn't apply" |
| 2 | Silent success — it worked, nothing says so |
| 3 | No forward motion after finishing |
| 4 | Dead end on failure |
| 5 | Contradictory state on one screen |
| 6 | Prerequisite announced too late |
| 7 | System vocabulary |
| 8 | Missing or wrong default |
| 9 | Lost context — a link that drops the job |
| 10 | Unexplained authority — numbers implying precision |

Severity: **blocks** (cannot complete) · **doubt** (cannot tell if it worked) ·
**friction** (slower or puzzling than needed).

---

## The patterns already done right

These are the reference implementations. Most of the backlog below is
propagating them, not inventing anything.

- **`/studio/projects/new`** — numbered sections, explicit `REQUIRED` labels,
  and a paste-the-client's-email shortcut. The COI request form has none of
  these.
- **"Hartley Wedding is ready — The journey starts at inquiry. [Open project]"**
  — success stated, thing named, forward action offered. Exactly what
  publishing a run of show lacked.
- **"It already happened — mark done"** beside "Schedule consultation" on the
  next-move card — the "this doesn't apply" affordance, already built for
  consultations. This is the answer to the COI question, already in the product.


## Summary

**48 findings** across a single end-to-end walk: register → verify → onboard →
create job → consultation → package → proposal → acceptance → contract →
retainer → booking gate → questionnaire → run of show → COI → readiness →
event-day brief → delivery → closeout.

The job **did** reach BOOKED with no signing app and no QuickBooks, and the
journey rail tracked it correctly the whole way. What breaks is almost never the
state machine — it is what the screens say about it.

### The eight that matter most

| # | Finding | Why |
|---|---|---|
| **B9** | Wedding checkpoints are chained in array order, so every studio task is gated behind a client action | Confirming the venue waits on the couple's form; recording crew waits on the **final balance**. Blocks the whole preparation phase for hand-resolution. |
| **A11** | The proposal page says a booking "cannot be confirmed" without QuickBooks | False — I booked one without it. Told to a new studio before their first proposal. |
| **A25** | The contract page leads with choose-a-template / approve-and-send | **No signing app is offered to any studio.** The only working path is a grey note beneath it. |
| **B1** | The reference panel lists finished work as outstanding | Header counts 8 blockers, panel lists 12 — the extras are the contract and retainer just recorded. |
| **A19 / B5** | The next-move card skips waiting steps and promotes the next one | "Send contract — built from the accepted proposal" with nothing accepted; "Draft the schedule — drafted from the form" with no form. Recurs at every client boundary. |
| **A8** | `INVALID_COMMAND` is unmapped, so every validation failure is "Try again" | Across packages, projects, contacts, tasks, workflows, crew. The one action guaranteed to fail again. |
| **B12** | The event-day brief warns about insurance marked not required | The one screen you open at 6am, warning you about a decision you already made. |
| **A20** | The journey spine renders a tick with no reason | "Crew confirmed" on a job with no crew. The explanation — "Shooting this one solo" — is computed and thrown away. |

### What this walk says about the pattern

Four causes produce most of the 48:

1. **The same question computed in more than one place.** Readiness has three
   answers (Overview 50%, Plan 42%, both on the event-day brief at once);
   checkpoint satisfaction has two. Every duplicate eventually disagrees.
   → B1, B10, B11, B12
2. **Copy that outlived the code.** A11 (the retainer escape hatch shipped and
   the copy still denies it), A16 (sending without a PDF works and the sentence
   above says it cannot), A25 (DocuSign removed, the instructions kept), B4.
   Each one was correct when written.
3. **A precise server reason discarded at the client.** `INVALID_COMMAND`,
   `DEPENDENCIES_INCOMPLETE`, and the closeout's own eight-item reconciliation
   reduced to "the gallery, the balance or the album". The information exists at
   the moment the message is composed.
   → A8, B9, C2
4. **Explanations computed and not rendered.** Journey `detail` strings, the
   solo-crew reason, which checkpoint blocks which. The product knows; the page
   does not say.
   → A20, B2, B16

**The reference implementations are already in the codebase.** The delivery
gate's refusal (C1) names all three of its conditions. The record-acceptance
outcome (A17 amended) states what happened, what it means, what was recorded,
and offers the way on. The Plan hub's card statuses say who holds each thing.
Most of this backlog is propagating those three, not designing anything.

---

## Phase A — signup to first project

### A1 · Internal vocabulary in the first three screens · #7 · friction
- Register: "create your **tenant-isolated** studio"
- Sign-in footer: "**Tenant-isolated** data"
- Onboarding: "This account becomes the **audited Studio Owner**"

A photographer does not know what a tenant is. Three occurrences before they
have seen the product.

**Fix:** "your own private studio"; "Your data is private to your studio";
"You'll be the owner of this studio."

### A2 · "Create account" does not move · #2 #3 · doubt
After submitting, the heading still reads "Create your account", the form is
still filled, the button still says "Create account", and one grey line is
added: "Check your email to verify your account." Pressing it again fails.

**Fix:** replace the form with a confirmation naming the address written to, as
`/studio/projects/new` already does on success.

### A3 · A new studio is congratulated for doing nothing · #5 · doubt
Today leads with "**You're all clear.** Nothing needs you right now" and
"Nothing is waiting on you", while the same screen says "Let's get your studio
ready — **1 of 4** answered".

**Fix:** while setup is incomplete and no jobs exist, the hero should be the
setup, not a congratulation.

### A4 · The client picker defaults to the option that cannot work · #8 · friction
"Existing client" is the active tab; its dropdown holds exactly one option, the
empty placeholder.

**Fix:** default to "New client" when the studio has no clients.

### A5 · Required markers inconsistent inside one form · friction
Event fields carry `REQUIRED` labels and the `required` attribute. The
new-client fields (first name, last name, email, phone) carry neither, so a
project can be created with a nameless client.

### A6 · The job page labels the city as the venue · #7 · doubt
Project creation has no venue field. "Providence" entered as **city** renders
as **Venue: Providence** on the job Overview.

**Fix:** label it City, or capture a venue at creation — the venue is what the
certificate, the crew brief and the run of show all need.

### A7 · The package form marks nothing as required · #8 · friction
All eleven fields — including name and base price — report `required: false` and
carry no `REQUIRED` label. This is the page a new studio **must** finish before
it can send its first proposal, and `/studio/projects/new` two clicks earlier
marked its fields properly.

**Fix:** propagate the `/studio/projects/new` treatment. The server already
knows the answer: name ≥ 2 chars, description ≥ 10, deliverables ≥ 1, terms
≥ 10, coverage and photographers positive.

### A8 · A rejected field cannot be named, so "Try again" is a dead end · #4 · blocks
Submitting a **1000% retainer** — which the form invites, because the field is
labelled "Retainer percent" with `min="0"` and **no `max`** — is refused by the
server (`basisPoints` is capped at 10000) and reported as:

> The package could not be created. Try again.

No field, no reason, and the suggested action is the one guaranteed to fail
identically. A non-technical owner presses it repeatedly and stops there,
unable to send a first proposal.

The cause is not local to packages. Schema rejection returns
**`INVALID_COMMAND`** from all three command endpoints —
`functions/src/crm/commands.ts:378`, `integrations/commands.ts`,
`workflow/commands.ts` — and `INVALID_COMMAND` **has no entry** in
`lib/ai/friendly-error.ts`. The code map has 40-odd precise entries and this,
the most common failure of all, is not one of them. So every malformed-field
rejection in the product becomes the caller's generic fallback:
"could not be created. Try again." — across packages, projects, contacts,
tasks, workflows and crew profiles.

**Fix, two parts:**
1. Constrain at the source: `max="100"` on the percent field (and switch max
   with the retainer mode, since the same input means cents when mode is
   fixed).
2. Map `INVALID_COMMAND`, and have the endpoints return the offending field.
   Zod's `safeParse` already has `error.issues[].path`; it is discarded at the
   400. Returning the first path lets the client say *which* field.

### A9 · The proposal page explains its guarantee in engineering terms · #7 · friction
"Pricing remains locked to the project **snapshot**" · "**Snapshot protected**
— Package pricing cannot **drift** while you write" · "Only projects at
consultation or proposal stage with a locked package are available."

The underlying promise is genuinely reassuring and worth stating — the client
cannot be quoted a price that moves under them. None of these three sentences
says that.

**Fix:** "The price you send is the price they see — changing your package
later won't alter a proposal you've already sent."

### A10 · Empty Jobs hedges about filters that do not exist · #5 · friction
"Create your first project **or change the active filters**" on a studio with
no projects and no filters set.

**Fix:** show the filter clause only when a filter is actually active.

### A11 · The proposal page invents a dead end that does not exist · #4 #5 · blocks
One click from sending their first proposal, a new studio is told:

> Nothing is connected to raise and track invoices. StudioCue cannot track a
> retainer it did not raise, so the booking cannot be confirmed until one is
> connected. **Connect QuickBooks.**

**This is false.** `recordRetainerPayment` and `recordFinalPayment` exist in
`functions/src/booking/commands.ts:145,174`, are wired through
`lib/booking/command-client.ts`, and are mounted in the booking workspace at
`components/booking/project-booking-workspace.tsx:907,987,1058`. Their own
comment says they were added for precisely this wall — *"since a photographer
hit the wall where their couple paid by transfer and the only path onward was a
QuickBooks webhook that was never coming."*

So the one capability that **does** have a working manual path is the only one
whose copy denies having one. The line directly above it gets this right for
signing: "Send your own agreement and record the signature on the booking —
StudioCue books the job either way."

The consequence is the worst available: a studio that takes bank transfers —
most of them — reads "the booking cannot be confirmed" before they have sent a
single proposal, and either goes and connects an accounting product they do not
use, or concludes StudioCue cannot run their business. Nothing later corrects
it.

**Fix:** `features/integrations/capability-readiness.ts:82` —
> "Raise your own invoice and record the payment on the booking — StudioCue
> books the job either way."

The comment block above that map (lines 63–76) reasons carefully to the wrong
conclusion for invoicing; it predates the two record commands and should be
corrected with the string, or the next person will restore the old wording on
purpose.

### A12 · A deliberately blank date becomes "Not set" in the client's document · #8 · doubt
The retainer due date is optional on the create form, correctly captioned
"Optional until the agreement is ready." In the client-facing preview — the
same layout that becomes the branded PDF — that blank renders as:

> Retainer · **$1,050.00** · Not set
> Final balance · $3,150.00 · May 29, 2027

A couple reading "$1,050.00 — Not set" beside a real date on the row below
cannot tell whether they owe it now, later, or whether something is broken.

**Fix:** in the client-facing view, either omit the date or say what is true —
"On signing". Keep "Not set" for the studio's own editing view if it is useful
there.

### A13 · The venue gap is advertised to the client · #5 · friction
"Jun 12, 2027 · **Venue pending**" appears in the client-facing preview and so
in the PDF, because nothing ever asked the studio for a venue (see A6).

**Fix:** with A6 fixed this resolves itself; until then, omit the clause in the
client-facing view rather than publishing the gap.

### A14 · A solo studio approves its own draft · friction
"Send for approval" → status "Needs approval" → "Approve the offer" →
"Approve & generate PDF". For a one-person studio — the common case — that is
two clicks and a status change to hand a document from someone to themselves.
The mechanism is right for a studio with an admin and a coordinator; nothing
adapts it to a studio of one.

**Fix:** when the tenant has one internal member, collapse to a single "Approve
and send" and skip the `needs_approval` status, or name it honestly:
"Approve your own draft".

### A15 · "The document worker usually finishes within a minute" · #7 · friction
Also "CURRENT STEP · Generate the PDF" for work the studio does not do.

**Fix:** "We're building the PDF — usually under a minute." Step title
"Building the PDF".

### A16 · One screen says the proposal both can and cannot be sent · #5 · doubt
When the PDF worker fails — which it does, and the failure handling is
otherwise the best in the product — the page shows, top to bottom:

> PDF generation failed
> **Nothing was produced, and the proposal cannot be sent without it.**
> ☐ Ready to share with the client
>   *The PDF could not be built, so this sends the branded email with a link to
>   the proposal and no attachment. iris.hartley@example.test can still review
>   and accept it in the portal.*
> [Send proposal]

The first sentence is stale. `features/proposals/pdf-notice.ts:49` still
asserts sending is impossible without a PDF, and its comment explains why —
*"Sending is gated on a ready PDF, both here and in the command, so 'send it
without one' would be advice the product cannot honour."* That gate was since
lifted; `components/proposals/studio-proposal-workspace.tsx:1955` records the
change — *"The server allows it now"* — and admits `pdfState: "failed"` to the
send path.

So the discouraging sentence is the one an anxious owner reads first, and it is
the false one.

**Fix:** `pdf-notice.ts:49` → "Nothing was produced. You can still send the
proposal as a link, or try again." Also `proposalPdfNotice`'s two `failed`
branches (lines 26–28), which say "sending needs it" for the same reason.

Not a defect, recorded so it is not "fixed" later: **the disabled Send button is
correct** — it is gated on the adjacent confirmation checkbox, which renders
properly. Flattened page text makes the label look like a status heading.

### A17 · The proposal page cannot get you back to the job · #9 · friction
Reached from the job's "YOUR NEXT MOVE" card. Once there, the only links on the
page are **Back to proposals** (the list), **Preview**, and the version-history
entry pointing at the page you are on. The `<h1>` "Hartley Wedding" is plain
text, and the client's name is plain text.

So the studio finishes a proposal and the way back to the job it belongs to is
the browser's back button, or Jobs → find it again. This is the same complaint
that produced `useReturnToJob` for six other steps; the proposal is the one
place the studio spends the most time and it was not wired.

Unlike those six, the proposal should **not** auto-navigate away — "Track the
decision" is a place to stay. It needs a link, not a redirect.

**Fix:** make the heading's eyebrow a link to `/studio/projects/{projectId}`,
as the crew and delivery workspaces do.

### A18 · "Not set" for things that simply have not happened yet · #7 · friction
Tracked with A12, which is the client-facing case. Internally: "Viewed · **Not
set**" on a proposal sent ninety seconds ago, and "Retainer · Not set". Nothing
was *unset*; it has not happened.

**Fix:** "Not yet" for pending events, "—" for absent values. Reserve "Not set"
for a field the studio was expected to fill and did not.

### A19 · The next move is a step whose precondition is unmet · #5 · doubt
On a job whose proposal was sent ninety seconds ago and never opened by the
client, the primary call to action reads:

> **YOUR NEXT MOVE** · Send contract
> *Built from the accepted proposal — no retyping*

No proposal has been accepted. The journey spine on the same screen knows
this — it marks **Proposal** `is-waiting_client` and, lower down, offers
"They said yes by email, text or in person? Record it on the proposal."

The mechanism: `features/journey/steps.ts:875` picks the next move as
`steps.find((step) => step.status === "current")`. A step waiting on the client
is not `current`, so the finder **skips it** and lands on the next one — and
`contract`'s status (line 377) is `current` whenever the contract is neither
out nor signed, with no reference to whether the proposal was accepted. So the
card advertises the following step, using copy that asserts the skipped step
finished.

**Fix, two parts:**
1. `contract.status` should be `upcoming` until the proposal is accepted —
   the step genuinely cannot start before then. `retainer` needs the same
   check; it will have inherited the same shape.
2. When every remaining step is waiting on someone else, the next-move card
   should say so — "Waiting on Iris to answer · sent Sep 2" — with the
   record-acceptance escape hatch promoted into the card. Falling through to
   the next actionable step is what produced this.

### A20 · The journey spine throws away the reason a step is complete · #2 · doubt
"Crew confirmed" shows a tick on a job with no crew, no booking, and a crew
page the owner has never opened. The reason is correct and already computed:
`crewDone` includes `shootingSolo`, and the step's `detail` reads **"Shooting
this one solo"** (`features/journey/steps.ts:552`).

The spine renders `<span><Check/></span><a>Crew confirmed</a>` and **nothing
else**. Every one of the 14 steps carries a written `detail` for exactly this
purpose — "0 of 2 accepted · 2 still to answer", "Offer cascading through your
ranked list", "Signed outside StudioCue — no contract on file here", "Settled
by you" — and the job page displays none of them.

This is the cheapest high-value fix in the backlog: the copy exists, is
accurate, and is already keyed per step. A tick with no explanation on work the
owner never did reads as a bug in the product.

**Fix:** render `detail` under each step title — at minimum for the current
step and for any step complete by exception (solo, waived, settled by hand,
signed elsewhere).

### A21 · "your signing app" breaks the sentences it is dropped into · friction
`components/booking/project-booking-workspace.tsx:365` sets a deliberate
fallback label when no signing provider is offered or connected — the reasoning
is right, and naming DocuSign to a studio that has no account would be worse.
But three insertion sites do not survive a lowercase noun phrase:

- "The accepted proposal supplies the exact package and price. **your signing
  app** remains the authority for signature completion." — a sentence starting
  in lowercase.
- "Or paste a **your signing app** template ID"
- "reuses the approved **your signing app** template"

On the page a studio visits to send its first contract, this reads as an
unfinished product.

**Fix:** give the fallback two forms — a sentence-initial "Your signing app"
and an article-free variant — or reword the three hosts so the label always
lands mid-phrase ("Signature completion stays with your signing app.",
"Or paste a template ID from your signing app").

### A22 · Three "today + N days" defaults still derive their date in UTC · doubt
The server-side sweep (94ab5dd, 871cb64) and the ten client sites left three
behind, all the same shape — a local `Date`, shifted by days, then
`toISOString().slice(0, 10)`, which re-reads it in UTC:

- `components/booking/project-booking-workspace.tsx:353` — `dueDate`, the
  **retainer due default**. The client twin of the bug already fixed on the
  server.
- `components/booking/booking-autopilot-workspace.tsx:63` — `futureDate()`,
  used for `retainerDueDate` at line 421.
- `components/post-event/delivery-form.tsx:26` — `dateFromToday()`, which is
  at least internally consistent (`setUTCDate` + `toISOString`) but still means
  UTC's today, not the studio's.

For any studio west of Greenwich, working in the evening — the normal condition
for a wedding photographer — every one of these lands a day late.

**Fix:** `todayInZone(timeZone)` from `lib/format/event-date.ts`, then add days
in the calendar domain, as the server path now does.

Checked and correct, so they are not "fixed" later:
`live-project-detail.tsx:135,152` and `booking-autopilot-workspace.tsx:268`
all parse at an explicit `T12:00:00` noon anchor before shifting, which cannot
cross a date boundary at any real offset.

### A23 · The primary CTA leads to a page that refuses it · #4 · blocks
Following A19's "Send contract" arrives at `/studio/contracts`, which says:

> Approve sequence & send
> **The client's accepted proposal is required first.**

Correct of the contracts page, and the round trip is the defect: the job told
the owner this was their next move, and the destination tells them it is not
possible. A new owner concludes they did something wrong at the proposal step.

Fixing A19 removes this. Recorded separately because it is what makes A19
severity **blocks** rather than cosmetic.

### A24 · "Record their acceptance" navigates to a list instead · #3 #9 · friction
The job page offers, under "Move this project forward":

> They said yes by email, text or in person? Record it on the proposal —
> StudioCue keeps who accepted and when.
> **[Record their acceptance]**

It is an `<a href="/studio/proposals?project=…">` to the proposals **list**.
The owner lands on a filtered index — "1 proposal · Version 1 · Sent" — and
must recognise the right row, open it, scroll past the whole document, and find
"They accepted outside StudioCue? Record it" at the bottom of the action stack.

The named action is three clicks and a scroll away from the button named after
it, and this is the escape hatch the product depends on for every client who
says yes by text — which is most of them.

**Fix:** link straight to the proposal that is awaiting a decision (there is
exactly one, and the list already computes it), anchored to the record control.
Where more than one is out, the list is the right answer — say so.

Worth copying, not fixing: the proposals **list** carries a "Back to project"
link. The proposal **detail** page does not (A17).

**A17 amended.** The proposal page *does* offer "Continue to project" — but only
at status `accepted`. At `draft`, `needs_approval`, `approved`, `sent` and
`viewed` — every status where the studio is actually working — there is no way
back to the job. The link exists; it is scoped to the one state where the
studio is finished with the page.

Also the best-executed moment in the walk, worth naming as a reference: on
recording the acceptance the page states the outcome ("Proposal accepted"),
what it means ("The project can now move into the agreement and retainer
workflow"), what was recorded and against whom ("Acceptance recorded against
your name"), what comes next ("The agreement is the next step"), and offers the
way there. Every other terminal action in the product should read like this.

### A25 · The contract page leads with the one path no studio can take · #4 #6 · blocks
`offeredProviders` (`features/integrations/schema.ts:75`) is
`{google_calendar, zoom, quickbooks, dropbox}`. **No signing app is offered**,
so `resolvedSigningProvider()` returns null for every studio that exists. Yet
the contract page's primary block is:

> **Choose your agreement first**
> StudioCue sends the agreement you pick once in Integrations, and reuses it
> for every booking.
> Or paste a your signing app template ID
> [Approve sequence & send]
>
> *Your approved agreement stays reusable* — Import the current agreement once…
> reuses the approved your signing app template so you do not place fields for
> every client.

Every instruction there is unfollowable: there is nothing to choose in
Integrations, no template ID to paste, and no provider for the sequence to send
through. The working path — the only one — is demoted to a grey note below it
("Send your own agreement and record the signature on the booking") and a
collapsed `<details>` ("Already signed outside StudioCue? Record it").

The schema comment at line 89 records a previous round of exactly this fix:
DocuSign was removed from `offeredProviders`, and a private fallback in the
booking workspace kept telling studios to go and get DocuSign anyway. The
fallback was fixed; the instructions around it were not.

**Fix:** when `resolvedSigningProvider()` is null, "record the signature you
took yourself" **is** the workflow — promote it to the primary action with the
same treatment the accepted-proposal panel gets, and hide the choose/paste/
approve block entirely rather than showing it inert. Restore it the day a
signing app is offered.

This is the same shape as A11 and, with it, the reason a new studio cannot get
a job booked without concluding the product is unfinished.

### A26 · Recording the signature leaves two regions showing the old truth · #5 · doubt
Immediately after "Signature recorded against your name", the same screen shows:

- the project badge still reading **"Awaiting signature"** (it is now awaiting
  deposit), and
- **"EVIDENCE HISTORY · Contracts · No contracts yet — Contracts will appear
  here after an agreement is prepared for signature."**

A manual reload fixes both. So the studio's confirmation that the signature
landed is contradicted, in the same viewport, by the panel whose entire purpose
is to be the evidence trail — and the fix is a reload nobody thinks to do.

This is the general form of the user's original complaint. The command result
updates the action stack and not the surrounding read models.

**Fix:** refresh the project record and the contracts list on a successful
`recordSignedAgreement`, the way `refreshTenantRecords("projects")` is used
elsewhere. Same check needed after `recordRetainerPayment` and
`recordFinalPayment`.

### A27 · A raw contract hash is shown to the studio · #7 · friction
Evidence history renders:

> Hartley Wedding
> **contract 7de90d60702ef56e3f9641e98dd912f1**
> Signers 1 · Sent — · Completed Sep 2, 2026
> **completed**

Three problems in four lines: a 32-character hex id as the document's name, a
raw lowercase enum `completed` beside a formatted "Completed Sep 2, 2026", and
"Sent —" for a contract that was never sent because it was signed on paper.

**Fix:** name it for what it is ("Signed agreement · recorded by you"), drop
the duplicate raw status, and omit the Sent row when there was no send.

### A28 · "0% ready" on a job that is progressing correctly · #10 · doubt
The project header shows a prominent **0 · 0% ready** through the whole booking
sequence — beside a journey reading 4/14 and a contract marked Signed. Both
numbers are honest about different things (readiness checkpoints have not
started; the journey has), and together they tell the owner their job is
simultaneously a quarter done and not begun.

**Fix:** don't show readiness until the readiness phase begins — it is a
preparation-stage measure. One progress number per screen.

**A11 confirmed empirically.** Walked the whole booking sequence on a studio
with **no signing app and no QuickBooks** — the state every new studio is in.
Recorded the acceptance, recorded the signature, recorded the retainer, ran the
gate: **"Booking is confirmed."** The sentence telling the owner this was
impossible was on screen at every step of it.

**A26 extends to the gate.** After "Booking confirmed", the project badge still
read "Awaiting deposit". Three commands in a row — signature, retainer, gate —
each left the badge one state behind until a manual reload.

### A29 · "The project setup jobs are now running" · #7 · friction
Also "Portal, workflow, calendar, and project folders are being prepared." —
four nouns, two of which (workflow, portal) a photographer has no model for,
and no way to tell when it finished or what to do if it did not.

**Fix:** "We're setting up the client portal, the planning checklist and the
job folder — this takes a minute." Then say when it is done, and offer the job.
No forward link is offered here at all; the booking sequence ends on the page
it started, with the job three clicks away.

---

## Phase B — booked job to event day

### B1 · The job lists the two things you just did as blockers owed by the client · #5 · blocks
On the freshly booked Hartley Wedding, one screen says both of these:

> THE JOURNEY · **BOOKING 3/3** — Proposal ✓ Contract signed ✓ Retainer paid ✓
>
> REFERENCE · Client needs (5)
> **Retainer paid** — Blocks event readiness until resolved. Client · Due Feb 12, 2027
> **Contract completed** — Blocks event readiness until resolved. Client · Due Feb 12, 2027

Both are done, by me, minutes earlier. Verified in the emulator — the records
carry the evidence:

```
contracts:          status=completed
invoiceReferences:  kind=retainer status=paid balanceCents=0
checkpoints:        contract-completed=ready   retainer-paid=not_started
```

**Cause — two computations of the same question on one screen.**
`components/projects/live-project-detail.tsx:741` computes the header
("33% · 8 blockers") through `readinessView` with `journey.readinessEvidence`,
so it is evidence-aware. The reference panel at line 516 calls
`projectLifecycleProjection({project, checkpoints, ...related})`, which takes
**no evidence argument at all**, and decides at
`features/projects/lifecycle-projection.ts:189`:

```js
if (["complete", "waived"].includes(text(checkpoint.status))) continue;
```

— the stored status only. Checkpoints are written by workflow automation;
nothing advances them from the project's own records, which is precisely the
defect `features/readiness/checkpoint-evidence.ts` was written to fix on
2026-08-26. That module is a pure function and is correctly wired into the
readiness engine, the readiness summary, the checkpoints component and the
workflow commands. The lifecycle projection was missed.

So the header counts 8 and the panel lists 12, and the two extras are the two
the studio is proudest of having finished.

**Fix:** thread the evidence into `projectLifecycleProjection` and treat an
evidence-satisfied checkpoint as settled at line 189 — the caller already has
`journey.readinessEvidence` in scope on the same component. Then audit for a
third computation: `crewCheckpointSettled` at line 305 does the same
stored-status-only test.

### B2 · Twelve identical sentences where twelve different ones belong · friction
Every entry in the reference panel — all twelve, across Studio, Client and Crew
— reads "**Blocks event readiness until resolved.**" The string carries no
information after the first occurrence, and it crowds out what actually differs
between them (what to do, and why it matters by that date).

**Fix:** say the thing that varies. "Confirm the venue address" · "Iris hasn't
returned the details form". Mark the blocking ones with a shared badge rather
than repeating a sentence twelve times.

### B3 · The blocker headline leads with the least urgent item · #10 · friction
"**8 blockers: Final balance paid** +7 more" — on a wedding nine months out,
where the final balance is due May 2027 and is *supposed* to be outstanding.
The item chosen to represent the eight is the one that should worry nobody.

**Fix:** rank by what is actionable now, and never surface a not-yet-due client
payment as the leading blocker. "8 open items — next: confirm the venue".

### B4 · "Confirm planning has started" is explained with the wrong example · #5 · friction
The stage-advance control on a booked job reads:

> Use this when the step happened outside StudioCue — for example a
> consultation handled over the phone. The change is recorded in the audit log.
> **[Confirm planning has started]**

The example is a consultation, three stages back. The copy is generic to the
manual-advance control and was never specialised per stage.

**Fix:** name the current stage's case — "Use this if you have already started
planning outside StudioCue."

### B5 · A19 is structural, not a one-off · #5 · blocks
The same skip repeats one stage later. With the details form sent and at **0%**,
untouched by the client, the job's primary action reads:

> **YOUR NEXT MOVE** · Draft the schedule
> *Drafted from the form using your timing rules*

There is no form to draft from. `steps.find((step) => step.status === "current")`
skipped "Wedding details form" (waiting on the client) and promoted "Run of
show", whose detail asserts the skipped step's output exists.

So A19 is not a quirk of the contract step — it is what the next-move card does
at **every** waiting-on-client boundary: proposal → contract, form → run of
show, and by inspection final balance → day-before too. Each time it names the
next step and describes it as consuming something that has not arrived.

**Fix is A19's:** gate each step's `current` on its own precondition, and give
the card a genuine waiting state instead of falling through. Recorded
separately because it changes A19 from "wrong copy on one card" to "the
next-move card is wrong for the whole middle of the lifecycle".

### B6 · The run of show's main path fails after the work, not before it · #4 #6 · friction
Filled coverage, ceremony, reception, three locations and a constraints note,
pressed **Generate draft**, and got:

> AI drafting isn't switched on for this workspace yet.

No remedy, no link, no mention that there is another way — and the whole page
is built around that button.

Caveat, stated because it changes the priority: the underlying code is
`VERTEX_AI_SCHEDULE_NOT_CONFIGURED`, an ops condition rather than an
entitlement, so this exact trigger may not fire on production. The **shape** is
the finding and is environment-independent: availability is discovered only
after the owner has done the data entry, and the message does not mention the
escape.

The escape exists and someone already thought this through —
`components/planning/ai-schedule-generator.tsx:757` adds **Build it myself**
precisely because "a workspace with AI off could not produce a run of show at
all, and 'Final run of show approved' is a blocking readiness checkpoint." The
button is there; the error does not point at it.

**Fix:** check availability before rendering the form. When AI drafting is off,
lead with "Build it myself" and drop the Generate button rather than offering an
action that cannot run. When it fails at submit anyway, put the alternative in
the message: "AI drafting isn't available for this workspace — you can build the
run of show yourself." Also true of the copilot (`VERTEX_AI_COPILOT_NOT_
CONFIGURED`), which the job page offers as "Ask StudioCue" with no such check.

### B7 · The manual fallback drops most of what you just typed · #9 · friction
After AI drafting refused (B6), **Build it myself** starts an empty draft. Of
the six fields entered above it:

| Entered | Carried into the draft |
|---|---|
| Coverage starts 13:00 | ✅ item 1 start, end set to +1h |
| Coverage ends 21:00 | ❌ |
| Ceremony 16:00 | ❌ no item created |
| Reception 18:00 | ❌ no item created |
| 3 locations | ❌ item 1 location empty |
| Constraints (wheelchair access, golden hour) | ❌ |

And the provenance panel reads:

> **What this schedule is based on**
> Nothing from this job yet — every time is a typical wedding

Which is false even for the one field that was used, and reads as an accusation
to someone who just supplied six.

The failure order makes it worse: the owner fills the form, is told AI is off,
takes the only remaining path, and gets a blank page with one untitled row —
having typed the ceremony time, the reception time and the three venues that
the day is made of.

**Fix:** seed the manual draft from the form — coverage bounds as the first and
last item, ceremony and reception as titled items at their times, the first
location on item 1 — and make the provenance line list what it actually used.
The form is right there and already validated.

### B8 · "Nothing for you right now" above five items owed by you · #5 · blocks
After marking the COI not required, the job reads:

> **NOTHING FOR YOU RIGHT NOW**
> This job is waiting on someone else.
> It comes back here the moment it needs a decision from you.

and, in the panel immediately below, under **Studio needs (5)**:

> Locations confirmed — You · Due May 29, 2027
> Primary contacts confirmed — You · Due May 13, 2027
> **COI approved and sent** — You · Due May 22, 2027
> Travel requirements confirmed — You · Due May 29, 2027
> Venue confirmed — You · Due May 13, 2027

Two separate defects meeting:

1. **B1 again, and now against a feature shipped today.** "COI approved and
   sent" is still listed as outstanding *seconds after* "Not required" was
   pressed — the header correctly went 42% → 50% and 7 → 6 blockers, and the
   journey ticked "Insurance to venue". The evidence module handles exactly
   this case (`checkpoint-evidence.ts:168` — "'not_required' when the venue
   never asked for a certificate. Without this, such a job carried
   `coi-approved` as an unsatisfiable blocker for ever"). The lifecycle
   projection does not consult it. Header: 6 blockers. Panel: 11 items.
2. **The waiting state is claimed while five manual studio checkpoints are
   open.** Venue confirmed, primary contacts, locations and travel are the
   `manual` checkpoints — judgements only a person can make, deliberately never
   inferred. They are the studio's work, they are the *next* real work on this
   job, and the card says there is none.

**Fix:** B1's evidence threading removes the COI row. Then the next-move card
must count open studio-owned checkpoints before claiming the waiting state —
"Confirm the venue and primary contacts" is a perfectly good next move and is
sitting right there unused.

**A19 refined — the fix is smaller than it looked.** The waiting state above is
exactly the UI A19 asked for, already built and well written. So A19 needs no
new interface: gate `contract` and `schedule` (and by inspection `retainer` and
`day-before`) on their own preconditions so they stop claiming `current`
prematurely, and the card falls into this state on its own.

### B9 · Every studio task on a wedding is gated behind a client action, in array order · #4 #6 · blocks
**The single most consequential finding of this walk.**

Pressed "Mark done" on **Venue confirmed**, wrote a genuine reason ("Confirmed
St Stephen Church and The Dorrance with both venues by phone"), submitted, and
got a 409 from `workflowCommand`:

```
{"error":"DEPENDENCIES_INCOMPLETE"}
```

surfaced to the studio as **"That checkpoint could not be updated."** — with
`role="status"`, so it is not even announced as an error, and naming neither
the reason nor a remedy. (`DEPENDENCIES_INCOMPLETE` is absent from
`lib/ai/friendly-error.ts`, exactly as A8 describes.)

**The cause.** `features/workflows/starter-templates.ts:136`:

```js
// Each step waits on the one before it, so a studio can see the order
// rather than thirteen independent obligations.
const wedding = weddingCheckpointDefinitions.map((definition, index) =>
  checkpointFrom(definition,
    index === 0 ? [] : [weddingCheckpointDefinitions[index - 1]?.[0] ?? ""]));
```

Every checkpoint depends on **whichever one precedes it in the array**, all
twelve are `blocking: true`, and `resolveCheckpoint` refuses any completion
whose dependency is unsatisfied. Read out of the live job, the graph is one
strict chain:

```
contract-completed → retainer-paid → questionnaire-complete → venue-confirmed
→ primary-contacts → coi-approved → schedule-approved → final-balance
→ crew-accepted → locations-confirmed → travel-confirmed → crew-acknowledged
```

Only weddings have it — `subset()` at line 147 clears `dependencies` for
corporate and sports. Weddings are the primary use case.

**What that means in practice, with the real owners and due offsets:**

| Studio must wait to… | until… | which is owed by |
|---|---|---|
| Confirm the venue (-30) | the couple return their details form (-45) | client |
| Confirm primary contacts (-30) | the venue is confirmed | studio |
| Record crew acceptance (-14) | **the final balance is paid** (-14) | client |
| Confirm locations (-14) | crew have accepted | crew |
| Confirm travel (-14) | locations are confirmed | studio |

Two of these are indefensible:

1. **Confirming the venue is blocked on the client's questionnaire.** Ringing
   the church is not downstream of the couple filling in a form — and a late
   questionnaire, the most ordinary event in wedding photography, freezes the
   studio's own planning behind it.
2. **Crew cannot be recorded as accepted until the couple has paid in full.**
   Crew has the longest lead time of anything on a wedding; studios book second
   shooters months out. The product forbids recording it until fourteen days
   before the day. And three more studio items sit behind *that*.

Someone has already been bitten by this chain: the comment at line 52 records
moving `crew-acknowledged` to last because "each step depends on the one
before, [so] those three could not be completed on time — their prerequisite
was not due until a week later." The symptom was fixed; the chain was kept.

**Fix.** The comment's stated goal — "so a studio can see the order rather than
thirteen independent obligations" — is a **display** concern, and the reference
panel already groups by owner. Ordering is not gating.

1. Drop the synthetic adjacency chain. Declare dependencies only where one
   genuinely cannot precede another (`crew-acknowledged` after
   `schedule-approved` is the only clear one).
2. Never make a studio judgement depend on a client action. If a real
   prerequisite must stay, `blocking` should mean "counts against readiness",
   not "refuses the attestation" — the reason field is the studio's word, and
   refusing it is refusing their knowledge of their own job.
3. Map `DEPENDENCIES_INCOMPLETE` to something that names the blocker: "Confirm
   *Questionnaire complete* first — this step waits on it." And don't offer
   **Mark done** on a checkpoint whose dependency is unmet; the graph is known
   before the button renders.

Note this is *not* the bug `functions/src/workflow/readiness-evidence-loader.ts`
fixed. That fix is present and working (verified: `functions/lib` is current) and
correctly lets record-satisfied dependencies pass. Here the dependency
(`questionnaire-complete`) is genuinely unmet — the chain itself is the defect.

### B10 · Two tabs of the same job report different readiness · #5 · doubt
Measured live, seconds apart, no writes between:

- `/studio/projects/{id}` (Overview) — **50% ready · 6 blockers**
- `/studio/planning?project={id}` (Plan) — **42% ready**

The 8-point gap is the COI: 42% was the figure before "Not required" was
pressed, and the Overview moved to 50% while the Plan hub did not. So the Plan
hub is computing readiness without the `insuranceRequired` evidence — a third
independent answer to the same question, after the Overview header (evidence-
aware) and the reference panel (evidence-blind, B1).

Internally inconsistent too: the same Plan hub *does* apply the evidence to its
card statuses, showing "Venue & insurance — **DONE**", directly above the 42%.

**Fix:** one readiness computation, called from one place. Fixing B1 by
threading evidence through the projection should be done as part of collapsing
these three; patching them one at a time is what produced three.

Worth copying: the Plan hub's card statuses — "Client details · **WITH THE
CLIENT**", "Timeline · DONE", "Crew · DONE", "Venue & insurance · DONE" — say
who holds each thing and are the clearest status display in the product. This
is the treatment the journey spine is missing (A20).

### B11 · The event-day brief shows both readiness numbers at once · #5 · doubt
B10 is not a per-tab cache. `/studio/event-day` renders **both** answers in one
viewport: the project badge says **42% ready** and the summary tile beside it
says **Readiness 50%**. Same page, same render, eight points apart.

### B12 · The event-day brief warns about insurance that was marked not required · #5 · blocks
> **Insurance still needs attention**
> Open the project record before relying on the certificate. [Review]

The COI was explicitly marked *not required* — the journey ticked "Insurance to
venue", the Plan hub says "Venue & insurance · DONE", readiness moved 42→50%.
The one screen a photographer opens at 6am on the wedding day tells them their
insurance is unresolved and sends them to go and check.

Same cause as B1 and B10 (a surface reading checkpoint state without evidence),
and the worst place for it: this brief is the product's promise that the studio
does not have to go looking. A warning it cannot dismiss trains them to ignore
the panel, which is the one that will matter when insurance *is* genuinely
missing.

### B13 · "Venue: Pending" on the event-day brief · #5 · blocks
A6 and A13 land here. The morning-of brief cannot say where the job is, because
project creation never asked for a venue. The locations are in the run of show
below (three of them, correct), so the information exists in the record and the
headline field says Pending.

**Fix:** A6 — capture a venue at creation. Until then, fall back to the first
location on the published run of show rather than printing "Pending" on the
brief.

### B14 · "RIGHT NOW · Next: Getting ready · 1:00 PM" — nine months early · #5 · friction
Opened on a 2027 wedding, the live panel asserts the first item is what's next.
The page is built for the morning of; nothing checks that the morning is today.

**Fix:** show the countdown ("in 9 months") in that panel until the event date,
and only switch to RIGHT NOW on the day.

### B15 · Six things to ask, none of which work · #4 · friction
The brief offers six prompts — "Give me the event-day brief in priority order",
"Which facts or approvals are still uncertain?", "Summarize crew arrival, roles,
and acknowledgements" — and then: **"The assistant isn't switched on for this
workspace yet."**

The B6 prediction, confirmed: the copilot path has the same
availability-checked-too-late problem, here after presenting six specific
invitations. Same fix — check first, and don't offer what cannot run.

### B16 · "Accepted crew: 0" with no explanation · #2 · doubt
On the event-day brief, for a job the product itself knows is solo (A20's
`shootingSolo`). A bare 0 beside "Accepted crew" on the morning of a wedding
reads as a failure. Same one-line fix as A20: say "Shooting solo".

---

## Phase C — delivery and closeout

### C1 · The delivery form is live months before it can work, and its refusal points at an invisible checklist · #6 · friction
On a job whose wedding is nine months away, `/studio/delivery` presents the
full **Record gallery** form — provider, secure URL, access code, delivery
date (pre-filled today), expiration, review destination — with **Record and
release delivery** enabled. Filling in a gallery URL and a review URL and
submitting returns:

```
POST postEventCommand → 400 {"error":"DELIVERY_GATE_BLOCKED"}
```

The gate is right and its message is **the best error copy in the product**:

> The gallery isn't cleared for release yet. Backup, editing and gallery-ready
> all have to be ticked on this job's post-production checklist first.

Precise, names the three conditions, names where they live. This is the
reference implementation for A8's fix.

The problem is that the checklist it names **is not on the screen**.
`app/studio/delivery/page.tsx:35` mounts `PostProductionChecklist` above the
form, deliberately — "Before the gallery, because it gates the gallery" — but
`components/post-event/post-production-checklist.tsx:55` returns `null` until a
`postProductionRecords` document exists, which a trigger opens only when the
job reaches post-production. So the page's own instruction ("Work through
post-production, then record the gallery") and the refusal both point at
nothing.

**Fix:** don't enable the form before the gate can pass. Where the checklist
would render, say why it is not there yet — "Post-production opens after the
event. The gallery can be recorded once the cards are backed up, the edit is
finished and the gallery is ready." Then the instruction, the form state and
the refusal all agree.

### C2 · The closeout reconciles eight things and reports a three-way guess · #4 · friction
"Reconcile evidence" promises to check "contract, QuickBooks balance, final
schedule, delivery, album, review ask, crew, and insurance". Run on this job it
answers:

> This job can't be closed out yet — the gallery, the balance **or** the album
> is still open.

It has just checked all eight and knows precisely which are outstanding. The
disjunction hands the studio a guessing game between three, and silently drops
the other five from consideration.

Contrast the delivery gate one section above, which names its three conditions
exactly (C1). Same page, same class of refusal, opposite quality.

**Fix:** list what is actually open, in the reconciler's own words — "Still
open: the gallery hasn't been recorded, and the final balance is unpaid." The
data is in hand at the moment the message is composed.

### C3 · Studio setup disappears the moment you create your first job · #3 · friction
At the very start of the walk, Today carried "Let's get your studio ready —
**1 of 4** answered" (see A3). After creating the first project it is gone —
verified by scanning the whole rendered document, not just the main region:
zero mentions of setup anywhere on Today, with the `tenantOnboarding` record
still holding no answers.

So the onboarding checklist is shown only while the studio has no jobs, and
creating a job is the first thing anyone does. Three of the four questions are
abandoned unanswered with no prompt and no route back.

**Fix:** keep the setup card until it is finished — demoted to a quiet strip
once work exists, not removed. A3's fix (make setup the hero while it is
incomplete and no jobs exist) is necessary but not sufficient on its own; the
card must also survive the first job.

**A3 and B8 refined — the correct phrasing already exists.** Today, on the same
state that produces B8's false claim, says:

> You're all clear. Nothing needs you. 1 job is in motion — everything is with
> a client, a provider, **or not due yet**.

That is *true*: the four open studio checkpoints are due May 2027. The job
page's card, for the identical state, says "This job is **waiting on someone
else**" — which is false, because four of the open items are the studio's own.

The fix for B8 is therefore not new logic but Today's clause: distinguish "with
someone else" from "not due yet", and when studio-owned items are open and
near, name them instead of claiming either.
