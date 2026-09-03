# Crew workspace walkthrough — findings

Walked as **Jordan**, a second shooter, signed in as `crew@studiohub.test`
against a production build with the emulator seed on **3 September 2026**.

His two assignments, both in the past, which is what made the walk useful:

| Job | Role | Status | Event | Notes |
|---|---|---|---|---|
| Maya & Theo Johnson | Second photographer | accepted | **15 Aug** (19 days ago) | acknowledged schedule **v3**, current is **v4**; closeout **not submitted**; $800 owed |
| Sofia & Miles Carter | Lighting assistant | invited | **22 Aug** (12 days ago) | response was due 2 Aug — **expired** |

The persona question: *I shoot for four studios, I am not technical, and I want
to know what I have been booked for, where to be, what you still need from me,
and when I get paid.*

Third workspace walked, after the studio (2026-09-02) and the client portal
(2026-09-03).

---

## The shape of it

**This is the strongest of the three workspaces.** It knows the date has
passed, its expired-offer copy is the best refusal in the product, and the Jobs
page tells a subcontractor exactly what they want to know. The failures are
narrower than the portal's and mostly one kind: **the home page does not know
about the money.**

---

### CR1 · "Nothing needs you right now" — with $800 unpaid and hanging on him · blocks

The crew home reads:

> Welcome, Jordan.
> **Nothing needs you right now.**
> **NOTHING BOOKED** — No upcoming jobs right now

Meanwhile `/crew/closeout` for the wedding he shot nineteen days ago reads:

> Agreed compensation **$800.00**
> Closeout · **Not Submitted** — Hours and expenses due after the event
> Payment · **Not Scheduled** — The studio will update this after review

So he is owed $800, the studio cannot schedule payment until he submits his
hours, and his own front page tells him there is nothing to do. He is waiting
on the studio, the studio is waiting on him, and neither is told.

The cause is precise. `components/crew/live-crew-views.tsx:728` builds the
headline from exactly two things:

```js
if (pending.length)      parts.push(`${n} invitation…`);
if (acknowledgementDue)  parts.push("a schedule to acknowledge");
return parts.length ? `You have ${parts.join(" and ")}.` : "Nothing needs you right now.";
```

Closeout is not a member of that list, anywhere. The data is right there — the
prep page already renders "After the event · Hours, expenses & deliverables ·
**Not submitted**" — and the one screen he lands on does not consult it.

Both existing clauses are also correctly silent here, which is why nothing
fired: the invitation is expired so it is not `pending`, and
`acknowledgementDue` deliberately excludes events whose date has gone (with a
good comment about not claiming something is at risk when nothing is). The
omission is closeout alone.

**Fix:** add unsubmitted closeout on a past assignment to the headline, and
make it the primary action. It is the only item in this workspace with money
attached, and it is the reason a subcontractor opens the app at all.

### CR2 · The home page and the Jobs page count his work differently · doubt

Home: "You have **1** past assignment on file."
Jobs: "**2** total", listing both under **FINISHED WORK**.

`behindThem` (`live-crew-views.tsx:696`) filters `accepted` assignments whose
date has gone, so the expired *invitation* is counted by Jobs and not by Home.
Two pages, one question, two answers — the `readiness-one-truth` class, in a
workspace no guard covers.

**Fix:** one derivation of "my work", used by both. An expired invitation is
part of his history — Jobs is right to show it.

### CR3 · The event-day brief has no phone number · blocks

`/crew/event-day`, the page the prep screen labels "**Available offline**":

> **EVENT CONTACTS**
> No event contact has been shared. Use the secure studio message below.
> [Contact studio now]

A second shooter arriving at The Boro Hotel needs a number to ring. "Send a
secure message" requires signal, an app, and someone watching an inbox — and
the person he would be messaging is shooting the same wedding. On the day, this
is the single most consequential field on the page.

Nothing in the crew workspace exposes a studio phone number on any screen.

**Fix:** the brief must carry a phone number — the studio's, the lead
photographer's, or the venue's. If none is recorded, that is a gap the *studio*
should be prompted to fill before the day, not a sentence the crew reads on
arrival.

### CR4 · Thirteen routes, four navigation links, and one brief rendered four times · friction

The nav is **Today · Jobs · Schedule & prep · Account**. There are thirteen
routes. And four of them render substantially the same thing for the same
assignment:

| Route | Renders |
|---|---|
| `/crew/schedule` | VERSION 4 · role · locations · contacts · segments · *Download calendar file again* · *Acknowledge current schedule* |
| `/crew/event-day` | the same, under the heading "Event-day brief" |
| `/crew/accepted` | the same job, call time, wrap, both locations, the same two buttons |
| `/crew/prep` | a menu that links to the above |

Same content, same actions, four URLs, one of them reachable from the nav.
This is the portal's CP2 in a milder form: there, nine routes competed for one
dynamic slot; here, the duplication means it matters less which one you land
on — but it is still four pages to maintain and four places for the copy to
drift.

**Fix:** one brief. Keep `/crew/prep` as the hub it already is.

### CR5 · The page for getting more work does not ask for any · friction

`/crew/availability` shows his one window — "Aug 15, 8:00 AM to Aug 16,
12:00 AM · available · **past**" — and nothing else. No prompt to add future
dates, on the page whose entire purpose is making himself bookable, in a
workspace whose home screen says "**No upcoming jobs right now**".

A subcontractor with no future availability and no upcoming work is exactly the
person the page exists for, and it says nothing to him.

**Fix:** when every window is in the past, lead with adding one. "Studios can
only offer you work on dates you have marked — add your next few months."

### CR6 · The product explains its own architecture, three ways · friction

- `/crew/documents` — "**Private by default** · Client contracts, invoices, and
  galleries are never exposed."
- `/crew/accepted` — "**Privacy boundary active** · Client invoices and
  unrelated project data remain hidden."
- `/crew/availability` — "Availability helps studios plan; **accepted
  assignments remain authoritative**."
- `/crew/requirements` — "**Provider and studio evidence remain authoritative.**"

Four variations of StudioCue reassuring itself about its own data model.
"Privacy boundary active" is a system state, not a sentence for a second
shooter, and none of them answers a question he was asking. The portal has the
same habit ("Only approved project details appear here", on four pages).

**Fix:** say it once, in his terms, where it could plausibly worry him — the
documents page — and drop the rest. "Only the paperwork for your own jobs is
here. You never see the couple's contract or their photographs."

### CR7 · Smaller things

- "**Download calendar file again**" is unconditional, so it says "again" the
  first time.
- "Not **S**ubmitted", "Not **S**cheduled" — title-cased statuses beside
  sentence-cased copy, on the closeout page.
- The closeout form asks for "Extra minutes" with no explanation of what
  counts, on the form that determines his pay.

---

## Worth copying, not fixing

The best refusal copy in the product is here:

> **This offer has expired**
> The studio's response deadline has passed, so it can no longer be accepted.
> Message them if you are still available and they can re-offer it.

It states the fact, the reason, the consequence, and the one thing he can still
do — and it appears on both `/crew/jobs` and `/crew/pending`, consistently.
Compare the studio side's "That checkpoint could not be updated."

Also strong:

- **"The day has passed"**, on both the prep and schedule pages. This is the
  calendar awareness the **client portal entirely lacks** (CP1) — the crew
  workspace reads the date and says so, while the portal asks a couple to keep
  planning a wedding three weeks gone.
- **`/crew/jobs`** gives a subcontractor everything he opens the app for in one
  card: role, status, arrival and wrap, locations, **the rate**, and the
  responsibilities he is being paid for. No jargon.
- **`/crew/requirements`** — "2 of 2 complete", each item named with its due
  date and where it landed.
- The home headline's own comment records two earlier fixes of exactly the
  class this walk found again: a template that "concatenated counts without
  handling zero", and a count that "was stated and then nothing on the page
  could act on it". The reasoning was right; closeout was simply never added.

---

## Across the three workspaces

| | Studio | Client portal | Crew |
|---|---|---|---|
| Knows the event date has passed | yes | **no** | yes |
| One derivation of "what needs me" | now yes | no | **no** |
| Routes reachable from navigation | most | 5 of 12 | 4 of 13 |
| Explains its own data model to the user | some | 4 pages | 4 pages |
| Best-in-product refusal copy | — | contract, proposal | expired offer |

Two classes now appear in **all three**: a quantity with more than one
derivation, and routes the navigation cannot reach. Both are mechanical enough
to guard, and the three existing guards cover only studio surfaces — which is
the same finding this document's predecessor ended on, one workspace later.

---

## Fixed — 2026-09-03

**CR1.** `features/crew/closeout-moment.ts` decides when a work record is his,
and the crew home now names it. Verified on screen:

> **You have 1 work record to send in.** · [Send in your hours]
> *Your hours and expenses* — Send in your work record for Maya & Theo Johnson
> **$800.00 is waiting on it** — your studio cannot schedule payment until the
> hours are in. · [Send it in]

The closeout page uses the same predicate rather than its own copy of the
submitted test, so the two cannot disagree. `needs_changes` counts as his
again — the studio asked him for something, and the closeout page already says
"The studio requested changes". Nothing is due before the day, which is the
mirror of the acknowledgement defect that once led the page thirteen days after
the wedding.

**CR3.** The reason nothing was ever shared: **nothing in the product could
share it.** `assignment.contacts` had no schema field, no command and no studio
control, so the `tel:` links this panel has always rendered had nothing to
render. The tenant record had no phone either.

So `eventDayPhone` is now part of studio identity — settable in Settings →
Studio identity, written and audited by `tenantIdentityCommand`, delivered to
the crew bundle (crew already read their tenant under `isActiveMember`), and
shown on the brief as a real `tel:` link:

> **Alder & Muse** · Studio · no contact set for this job · **(555) 010-4477**

Two things this shook out, both verified by clearing the field and rebuilding:

- The href needed `normalizePhone`, or it dialled `tel:(555) 010-4477` —
  parentheses and a space.
- `text()` in `live-crew-views.tsx` defaults to **"Pending"**, not `""`, so the
  absent case rendered a contact row whose number read "Pending" and whose link
  dialled nothing. The empty branch now says what is true and where to fix it:
  "No phone number is on file for your studio. Ask them to add one in
  Settings → Studio identity, and use the secure message below in the meantime."

A per-job contact is still the better answer, and the studio has no way to set
one. That remains open.

**Still open from this walk:** CR2 (home counts 1 past assignment, Jobs counts
2), CR4 (four routes render one brief; 13 routes, 4 nav links), CR5
(availability asks for nothing when every window is past), CR6 (four variants
of the product explaining its own data model), CR7 (smaller copy).
