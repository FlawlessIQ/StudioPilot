# Editing, corrections and the proposal document — requirements

From Gabe's messages and screenshots of 24 September 2026, plus what the code
actually does. Every claim below was checked against the repository or against
production data rather than taken from the screenshots alone.

## The finding that ties it together

Gabe typed a client email with a deliberate typo — `gabrielrhdoes28@gmail.com`,
where his own address is `gabrielrhodes28` — to see whether he could correct it.
He could not. Everything that followed came from that one gap:

- He sent the proposal. **It sent successfully**, four times, at 14:33, 14:34,
  14:35 and 14:37, every one to `gabrielrhdoes28@gmail.com`. Today's
  `emailJobs` are five documents and all five read `succeeded`; nothing is
  stuck and nothing failed.
- He never received it, because the address is not his.
- The proposal card said **"Email delivery: Queued"** the whole time, so the
  evidence on screen pointed at a delivery problem that did not exist.
- He resent three more times, each to the same wrong address.
- He asked Cue to fix the name. Cue said: *"I cannot edit the project name
  directly. You can update it by opening the project details page."* **There is
  no such control.** No project edit form exists anywhere in `app/` or
  `components/`, and no command in `functions/src` updates a project.

So the headline is not "email is broken" and not "Cue is unhelpful". It is that
**StudioCue is a write-once product**: you can create a job, a client, a
proposal and a package, and you cannot correct any of them afterwards except a
client record. A studio that mistypes anything is stuck with it, and the product
gives them a plausible wrong explanation for what went wrong.

---

## R1 — Edit a job *(P0)*

**Gabe:** "How do i edit info. I entered wrong on purpose and cant." · "I did
typo on purpose and cant change it." · Conor: "right now i can only edit
clients. i cannot seem to edit anything about the project."

**Today:** `app/studio/projects/` has `[id]`, `import`, `new` and a list page —
no edit route. The only edit surfaces in the whole app are packages
(`edit-package-form.tsx`), questionnaire templates, schedules, timing rules, and
the client / crew / vendor record actions.

**Not a permissions problem.** `firestore.rules:163` already allows
`allow update: if canManageProject(...) && tenantUnchanged()`. The data layer
has been ready the whole time; only the UI is missing.

**Required:** edit a job's name, event date, event type, venue, city, timezone
and linked client.

**Split by consequence, because these are not equivalent:**

| Field | Route | Why |
|---|---|---|
| name, venue, city, timezone | direct write, as clients already do | cosmetic; nothing downstream reads them as a decision |
| event date, event type | Cloud Function command | readiness, schedules, crew availability and relative-date automations all key off the date. Changing it must re-derive them, and that is server work |
| linked client | Cloud Function command | it changes who receives everything |

Editing must not be reachable on an archived job, for the same reason staffing
one is not.

## R2 — Correct something already issued *(P0)*

**Gabe:** the typo is on a proposal he has already sent.

**Today:** proposals are immutable by design, and that design is right —
`docs/architecture.md` and CLAUDE.md both state that proposal pricing and terms
are never mutated. `proposalSchema` freezes `clientSnapshot { displayName,
email }` and `eventSnapshot` at creation, which is why editing the client record
afterwards would still not have fixed his proposal.

**So the requirement is not to make proposals editable.** The schema already
carries `version` and a `superseded` status, and the UI already shows "Version
history · 1 preserved version". What is missing is the act that uses them.

**Required:** "Correct and re-issue" on a sent proposal — take the current
proposal, apply the corrected client and event snapshot, write a new version,
mark the previous one `superseded`, and send the new one. The old version stays
readable. The client sees one current proposal.

**Required alongside it:** when a correction changes the recipient, say so
before sending — "this will go to X instead of Y" — because the whole failure
above was four sends to an address nobody was reading.

## R3 — Cue must be able to correct, and must never invent a control *(P0)*

**Gabe** asked Cue to edit the wedding's name. Cue refused and named a page that
has no such control.

Two separate defects:

1. **It cannot act.** Once R1 exists, `update_project` belongs in Cue's action
   proposals beside `create_task` and `create_proposal_draft` — prepared, shown
   with the before and after, approved by a human. That is the product's own
   "AI prepares, human approves" rule, and a rename is exactly the kind of
   small, reversible act it was written for.
2. **It described a control that does not exist.** This is the fourth instance
   this week of the same shape: asked about something the retrieval does not
   carry, Cue writes a confident sentence instead of admitting the gap. The
   others were the missing package, the invented drone-operator role and the
   archived job, and all three were fixed by giving the model the fact rather
   than by asking it to hedge. Same fix here: Cue should know which fields are
   editable and where, or say it does not.

## R4 — A proposal needs a photo package *and* a video package *(P1)*

**Gabe:** "Need to be able to select a photo and video package for creating
proposal." (said twice)

**Today:** `proposalSchema.packageSnapshotId` is a single required string. One
proposal carries exactly one package. A studio selling photo and video on one
wedding cannot express it, which is not an edge case for a video-led studio —
it is the normal sale.

**Answered, 24 Sep.** *"Clients can pick either a photography package or a
videography package or can select a photography and video package. There is no
discount but need to be able to put in a discount if i want in the proposal
section."*

So: one or two packages, never a fixed bundle, and **no automatic bundle
discount** — the discount is a judgement he makes per proposal.

**Required:** a proposal carries one or two package snapshots, priced together,
with one total and one payment schedule. `resolveCoverage` already returns
`{role, count}[]` per package, so the combined crew requirement falls out of
summing them rather than needing a new concept.

**The discount is nearly free.** `selectPackage` already accepts
`discount: { type: "none" | "fixed" | percentage }`, already clamps a fixed
amount to the pre-discount total, and already flows `discountCents` into the
pricing snapshot, the proposal view, the client portal and the PDF. The entire
engine is built. `components/proposals/studio-proposal-workspace.tsx:970` sends
`discount: { type: "none" }`, hardcoded, every time. This is an input field and
a wire-up, not a feature.

**Note the blast radius** before scheduling this: the pricing snapshot, the PDF,
the booking gate, readiness coverage and the package-selection flow all assume
one package today. This is the largest item on the list.

## R5 — The proposal document is labelled wrong and is missing what he signs *(P1)*

**Gabe:** "Can we use the format i use now? I make them sign in two spots and
have legal agreement." · "Have to work on format of proposal too?"

**Today:** `cloud-run/pdf/main.py:133` hardcodes the subtitle
`PHOTOGRAPHY PROPOSAL`. Gabe's screenshot is a **Gold Cinematic Package** —
ten hours of videography, drone, gimbal, a two-song trailer — under a header
that says photography. The document contradicts what it is selling.

**Required:**
- Derive the subtitle from what is actually in the proposal — photography,
  videography, or both — rather than hardcoding one trade.
- Two signature blocks, matching how he already sells.
- The studio's legal agreement carried in the same document.

**Answered, 24 Sep.** Asked whether he wanted the proposal itself signable, he
said: *"No. I didn't realize the contract would be sent separately."*

That is not a preference, it is a discoverability failure, and it changes this
requirement rather than confirming it. He asked for two signature blocks and his
legal agreement **because he believed the proposal was the only document the
client would ever sign**. StudioCue already sends a contract as a separate,
signature-verified step — which is the design the booking gate depends on — and
he did not know it existed.

**So the signature work drops.** What replaces it:

- The proposal must say what happens next, on the document and on the screen:
  that a contract follows and is what gets signed. A quote that looks like a
  final document is what produced this.
- The contract step needs to be visible from the proposal, not discovered by
  accident. Same shape as the forwarding address that was live for weeks and
  invisible to the people it was for.

**Still required from this section:** the hardcoded `PHOTOGRAPHY PROPOSAL`
subtitle. His Gold Cinematic Package is ten hours of videography, drone and
gimbal, under a header that says photography.

## R6 — Delivery status must tell the truth *(P1)*

**Today:** the card read "Email delivery: Queued · Viewed: Not yet" for a
message that had already sent successfully. The queue was empty and every job
today succeeded, so the card was simply stale — the same refresh-after-write
shape recorded in `delivery-closeout-stretch-2026-09-18`.

**Required:** the card reflects the delivery record's real state, and a resend
does not present as the remedy for a problem that does not exist. "Sent to
<address>" is the wording that would have stopped this on the first send, since
the address itself was the fault.

## R7 — "People" reads as the wrong word *(P2)*

**Gabe:** "Maybe change people to clients?" → told it also holds crew, team and
vendors → "Gotcha. Maybe add just clients tab? Or no?"

**Today:** `People` holds Clients, Crew, Team and Vendors as tabs. The grouping
is right; the landing is not. A studio thinks about clients far more often than
about the union of everyone.

**Required:** land `People` on Clients by default, or give Clients its own
sidebar entry pointing at the same tab. Cheap, and it is the second time he has
raised it.

---

## Order

1. **R1** and **R2** — the write-once problem, and the reason he lost four
   emails. Nothing else on this list matters as much.
2. **R6** — small, and it is what made the failure unreadable.
3. **R3** — follows R1 directly; the action proposal is a thin layer over it.
4. **R5** — the document is client-facing, says the wrong trade, and does not
   tell the client a contract is coming. Gabe asked for signatures only because
   he thought this was the last document; saying so is most of the fix.
5. **R7** — cheap.
6. **R4** — the largest. The discount half is an afternoon, since the engine
   already exists and the UI simply never calls it; the two-package half is the
   real work and wants R1 settled first.

## Two notes on the testing itself

- Gabe's "can you edit the name of this wedding" was asked on
  `studio-cue.com/studio/projects/evalfix-bulk-00`, which is one of the eval
  fixtures seeded for the scale scenarios, not a real job. The answer is the
  same either way, but those fixtures are still on the tenant and are now being
  used as if they were real work. Remove them with
  `scripts/seed-eval-fixtures.mjs --remove --apply` when the eval is done.
- The typo test was a good one. It found more in an afternoon than the scenario
  suite found in two days, because it exercised the one thing no scenario
  covers: what happens after you get something wrong.

---

## Status, 24 September 2026

Built and live on production unless noted.

| # | What | State |
|---|---|---|
| R1 | Edit a job | **Shipped.** Verified end to end: the venue was changed through the form on the live DeMattia job, persisted, attributed to the real user, and audited with both before and after. Restored afterwards. |
| R2 | Correct and re-issue a proposal | **Shipped.** Supersedes rather than mutates, re-reads the client and event, lands as a draft, and says "it will go to X instead" when the recipient changes. |
| R3 | Cue | **R3a shipped; R3b built but not reliably triggered.** It no longer invents a control — asked how to rename a wedding it now answers "open the job page and click the 'Edit job' control beside the job's name", verified on production. Cue *performing* the edit is not built; see below. |
| R4 | Photo and video on one proposal | **Discount shipped**, which was the half he asked for by name. The two-package half is not built; see below. |
| R5 | Proposal document | **Shipped.** The header is derived from the package's coverage roles, so a video package no longer reads PHOTOGRAPHY PROPOSAL, and the document now says the booking agreement follows rather than only what it is not. |
| R6 | Delivery status | **Shipped.** The card names the recipient, and re-reads once after a send so the status stops sitting on "Queued". |
| R7 | Clients in the sidebar | **Shipped.** The item is labelled Clients, which is where it has always gone. |

### What is deliberately not built

**R3b — Cue performing the edit. Built, deployed, and the model will not
reliably choose it.**

The whole mechanism is in place and tested: `update_project` is a fourth action
proposal carrying `field` and `value`, the card reads the current record and
overrides exactly one field (a partial write would clear the rest by omission),
it refuses an archived job and a malformed date, it declines to offer a card
that would change nothing, and the detail line is the before and after. The
approval runner reaches the same `crmCommand` the Edit job form uses, so
authorization, the archived refusal and the two-sided audit are shared rather
than duplicated. It was reviewed against the injection tests and the closed
enum guard widened from three to four with the reasoning written down.

What does not work is getting the model to pick it. Four deploy cycles of
prompt wording produced, in order: the right intent as a `create_task` ("Update
venue to The Foundry Main Hall" — a reminder rather than the change), then no
proposal at all twice, then a polite pointer back to the Edit job control.
`actionProposalCount` was 1, 0, 0, 0.

This is the same failure as `flow.subject` and `flow.role`, which were null on
ten consecutive turns despite detailed instructions: **a rule buried in a
17.8k-character single-paragraph system instruction does not reliably reach the
output.** The fix there was to stop asking and derive it. The equivalent here is
harder — "change the venue to X" needs a field and a value pulled from free
text, which is a real parse rather than a regex over trade words — but it is the
direction that has actually worked twice.

Worth doing as its own piece, with the eval harness measuring whether the model
picks it up, rather than more wording changes measured by hand.

**R4b — two packages on one proposal.** Still the largest item on the list.
`proposalSchema.packageSnapshotId` is a single required string, and the pricing
snapshot, the PDF, the booking gate, readiness coverage and the package flow all
assume one. Worth doing on its own rather than folded into a batch.

**The signature blocks Gabe asked for.** Dropped on his own answer — he wanted
them because he thought the proposal was the last document his client would
sign. Worth confirming he is happy once he sees the new wording.
