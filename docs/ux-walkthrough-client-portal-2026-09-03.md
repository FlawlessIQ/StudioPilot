# Client portal walkthrough — findings

Walked as **Maya Johnson**, the bride on the seeded `wedding-booked` project:
a wedding at The Foundry on **15 August 2026**, walked on **3 September 2026**
— so the event was **19 days ago**. Signed in as `client@studiohub.test`
against a production build with the emulator seed.

The persona question at every screen: *I am not technical, my photographer sent
me a link, and I want to know what I owe, what I still have to do, and where my
photographs are.*

This is the first walk of a workspace other than the studio's. The three guards
added on 2026-09-02/03 (`error-copy-coverage`, `journey-preconditions`,
`readiness-one-truth`) hold the mechanical classes on the studio side, so none
of what follows is a rediscovery of those — but note that **none of them cover
the portal**, and two of the findings below are the portal's own version of
defects already fixed on the studio side.

---

## The shape of it

The portal is not uniformly weak. Two pages are the best client-facing copy in
the product, and four share one piece of filler. The failures cluster around a
single architectural choice: **the portal derives everything from the stage the
studio maintains, and never from the calendar or the records.**

---

### CP1 · The portal never looks at the date · blocks

Nineteen days after the wedding, the Overview reads:

> **Your next action** — Continue planning your event
> *Review the planning information and complete anything your studio has shared.*
> [Continue planning]
>
> **What happens next** · 50% DONE · **Planning** — Complete details and
> approve the event plan. **NOW**

And the questionnaire asks her for the **ceremony time** of a wedding that has
happened.

The portal *has* the date — the hero metric is "**19 days since your day**",
computed with `daysUntilEvent` at
`components/client/live-client-views.tsx:527`. It is used for that counter and
for nothing else.

The notion of "past" the portal does use is
`portalStageIsBehind(milestones, area)`
(`features/client/portal-stage.ts:37`), which returns true when a **gating
milestone is complete** — that is, when the studio has advanced the project. So
"past" means "the studio moved on", never "the day has been and gone".

The studio side already reconciles these two. `features/journey/steps.ts` has
`eventBehindThem`, `preparationIsMoot`, and an `event_day` step that flips to
"**Did this go ahead?** The date passed N days ago and this job is still marked
planning." A preparation step the event overtook is struck through rather than
ticked. None of that reaches the client, who is the wrong person to ask about a
stale stage in any case.

**Fix:** give the portal the same calendar awareness. Past the event date,
planning areas stop asking and say what is true — the studio has not updated
the project yet, and there is nothing for the couple to do about it. The
milestone strip should not read "Planning · NOW" three weeks after the day.

### CP2 · Nine pages compete for one navigation slot · blocks

The portal nav is hardcoded (`components/layout/portal-shell.tsx:145`):

```
Overview · [one dynamic slot] · Project records · Payments · Messages
```

The dynamic slot is `nextAction.href`. Everything else —
`/client/schedule`, `/client/contract`, `/client/proposal`, `/client/delivery`,
`/client/reviews`, `/client/project`, `/client/package` — is listed in the
component's own `contextualRoutes` set, nine entries, and is reachable **only
if the next-action resolver happens to point there**.

For this couple it pointed at the questionnaire, so a run of show holding a live
decision was reachable only by typing the URL. `/client/schedule` renders:

> **VERSION 4 · CLIENT REVIEW** · Your event-day schedule
> **YOUR DECISION** — Is this schedule ready?
> [Approve this version] [Request changes]

The server already computes the answer and nobody asks it.
`server/client/portal-experience.ts:465` returns a `ClientNavigation` with a
flag per area — `schedule: Boolean(availability.schedule || index >= 5)`, and
PLANNING is index 6, so **`schedule: true`**. `ClientNavigation` is exported,
typed, populated, and **never consumed**: no component references
`navigation.*`.

The comment beside the hardcoded Payments entry shows this class was hit
before — *"Payments had no entry at all, so a couple with an outstanding
balance could not reach the page that shows it"* — and was fixed by hardcoding
one more link rather than by wiring the navigation the server was already
sending.

**Fix:** consume `ClientNavigation`. The data is there and correct.

### CP3 · A revised schedule is invisible, because approval never reopens · blocks

Why the resolver pointed at the questionnaire: it reads **client-owned
readiness checkpoints**, and every one of them on this project is `complete` —
including `schedule-approved`, while schedules v3 **and** v4 sit at
`client_review`.

That is not broken seed data, it is the normal sequence:

1. studio publishes v3 → couple approves it → `schedule-approved` completes
2. studio revises the timeline → v4 goes out for review
3. `checkpointIsSatisfied` short-circuits on `status === "complete"`
   (`features/readiness/score.ts`), so recomputation can only ever *satisfy* a
   checkpoint, never reopen one

So after any single approval the checkpoint is complete for the life of the job,
and every later revision is invisible to the portal's next action. Readiness
also reports "Final run of show approved" as satisfied. The studio's *journey*
still shows it correctly — `run_of_show` reads the current schedule's status and
reports "With the client to approve" — so the two studio surfaces disagree,
which is the `readiness-one-truth` class in a place that guard does not reach.

The product already reasons about this distinction elsewhere, deliberately:
`crew-acknowledged` is separate from `crew-accepted` precisely because *"a
second photographer who accepted the job in March has not thereby read the
timeline approved in June."* The same argument applies to the couple and it was
not made.

**Fix:** `schedule-approved` should track the **current version**, as crew
acknowledgement does. Either reopen it when a later version enters
`client_review`, or derive it from the current schedule rather than from a
stored completion.

### CP4 · "Required" is presented as "missing" · doubt

The questionnaire says:

> Submitted · 50% answered
> *Submitted with some questions unanswered. **The ones marked required are the
> ones your studio is still missing.***

Two fields carry a `REQUIRED` badge. One of them, **Ceremony time, already
contains `16:30`**. `required` is a static template attribute
(`components/planning/client-questionnaire-form.tsx:31`), not a computed
"outstanding" — so the sentence is false for every required field that has been
answered, which is half of them here. Only `familyPhotoList` is genuinely
missing.

She cannot act on it either way: every field and both buttons are disabled after
submission, which the copy above does explain ("Message them to reopen it").
So she is told to look at two fields, one is already filled, and she cannot edit
either.

**Fix:** mark the *outstanding* ones from their values and name them —
"Still needed: **Family photo list**" — rather than pointing at a static
attribute.

### CP5 · The right sentence is computed, then filtered away · doubt

`live-client-views.tsx:594` builds an "Event schedule" artifact whose detail
reads exactly what the couple needs — `Version 4 · awaiting your review`, with
`href: /client/schedule`. Then:

```js
const availableRecords = artifacts.filter((artifact) => artifact.ready);
```

A schedule awaiting review is not `ready`, so the tile, its sentence and its
link are all discarded, and the Overview reads "**No approved records yet**".

This is A20's shape exactly — the journey spine computing "Shooting this one
solo" and rendering only a tick. An artifact awaiting the client is not a
record, but it is the single most important thing on the page.

**Fix:** render awaiting-you artifacts as what they are — the next thing to do —
rather than dropping them for failing a records filter.

### CP6 · One empty state, four pages · friction

`/client/payments`, `/client/documents`, `/client/delivery` and
`/client/reviews` all render the same block verbatim:

> **Nothing to complete yet**
> *<one page-specific sentence>*
>
> **WHAT HAPPENS NEXT**
> Your studio prepares this area
> You'll be notified when it changes
> Only approved project details appear here

"Nothing to complete" is the wrong verb three times out of four — she has
nothing to *pay*, nothing to *collect*, nothing to *read*. And "Only approved
project details appear here", repeated on every empty page, is StudioCue
reassuring itself about its own data model.

**Two pages in the same portal show how to do it**, and they are the best
client-facing copy in the product:

> **No agreement is held here** — Your booking was completed without the
> agreement being signed through StudioCue. Message your studio if you need a
> copy of it.

> **No proposal is held here** — Your project moved past this step without one
> being sent through StudioCue. Your studio has the details — message them if
> you would like a copy.

Each says why it is empty, what that means, and what to do. They come from
`portalPastNotice` (`features/client/portal-stage.ts:48`), which covers only the
areas that have a "moment gone" concept.

**Fix:** extend that treatment to the other four. Each has a specific, true
reason for being empty.

### CP7 · "Your studio will confirm this" — after the wedding · friction

`/client/project` lists **Lead photographer: Your studio will confirm this**,
nineteen days after that photographer shot the wedding. Same root as CP1.

### CP8 · Nothing about when the photographs arrive · friction

Nineteen days post-wedding, the one thing this couple wants is their gallery.
`/client/delivery` says:

> Nothing to complete yet
> *Your secure gallery details will appear after delivery.*

No expected date, no typical turnaround, no indication anything is in progress —
on the page that exists to answer that question, at the moment it is the only
question. The studio has a `postProductionRecords` stage and a delivery due
date; neither reaches the couple.

**Fix:** say where the work is and when it is expected. "Your photographs are
being edited — your studio expects to deliver by <date>" is worth more than
every other sentence on this page combined.

---

## Worth copying, not fixing

- **`/client/messages`** names the studio ("Message Alder & Muse"), explains
  what attachments are allowed and that they are "securely scanned before
  studio access", and offers a real compose box with a subject. No jargon, no
  hedging.
- **`/client/contract` and `/client/proposal`** — see CP6.
- **The questionnaire's disabled state** is honest: fields and buttons are
  genuinely disabled and the copy explains why and what to do instead. Only the
  "required means missing" sentence is wrong.

---

## What this walk says about the guards

Three of eight findings are the portal's version of a defect already fixed on
the studio side — CP1 (`eventBehindThem`), CP3 (`readiness-one-truth`), CP5
(A20's discarded reason). The guards are all scoped to studio surfaces:
`journey-preconditions` drives `projectJourney`, `readiness-one-truth` scans for
a formula and a stored-field read, and neither knows the portal exists.

So the pattern from the studio walk repeats one level up: **a class fixed in one
workspace is not fixed in the product.** Worth extending the guards to the
portal's own derivations before walking the crew workspace, which is the third
one and has had no walk at all.
