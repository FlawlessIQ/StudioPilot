# One wedding, start to finish — the journey video (plan, 2026-10-02)

The 13 how-to videos each show one task. None of them shows the thing a
photographer actually buys: **a wedding that runs for a year or more, from
the first inquiry to the album, with StudioCue keeping it moving.** This
plan adds that film, and a "What to expect" page built from the same
footage.

**Status (2026-10-02, evening):**
- **Decided by Conor:** a **general** "What to expect" page (not personalised
  to a job); dates on screen needn't be accurate, only the journey and what
  each person sees.
- **Film recorded:** 8 chapters, 6:08 joined, voice by Brian. Awaiting
  Conor's approval before `publish.ts journey journey-1 … journey-8`.
- **Page shipped:** `/studio/help/journey` (replaces the example job) and
  `/how-to/wedding-journey`; text now, videos appear once published.
  `tests/expected-timeline.test.ts` fails if a scheduler's timing and the
  page disagree.
- **§6 gaps:** the couple's week-of and crew's call-time reminders now send
  (e44620e, live). BOOKED → PLANNING stays manual; the film never claims it.
- **How it's made:** `scripts/how-to/videos/journey-<n>.ts`, the story in
  `scripts/how-to/journey/story.ts` (moves the wedding date and runs each
  scheduler, since the emulator runs none), `lib/journey-recorder.ts` +
  `lib/compose.ts` (three screens, layouts, timeline bar), `join.ts`.
  Re-cut a chapter: `make.ts journey-<n>` (it starts from the chapter
  before's snapshot), then `join.ts`.
- **Faked, and why:** the run-of-show draft answers the studio's "Generate
  draft" with a fixed, model-shaped response (no Vertex in the emulator);
  Ella's online payments are recorded through the studio's own payment
  record (no QuickBooks Payments in the emulator); the inquiry reply draft
  is written as the AI job would write it.

It serves two people:

| Who | What they need to see | Where they see it |
|---|---|---|
| **A prospect** (sales) | "This runs my whole wedding, and my couple and crew get a polished experience." | Home page hero, `/how-to/wedding-journey`, sales calls, a 60 s social cut |
| **A studio on day 1 of a trial** | "Here is what will happen over the next 14 months, when, and what I have to do — StudioCue will tap me on the shoulder." | Help & guides, a Today card while no wedding is booked, the welcome email |

Both are the same film. The trial page adds the dates and the detail.

---

## 1. What we make

1. **The film — "One wedding, start to finish."** About 4 minutes,
   1920×1080, 8 chapters, skippable from the player. Studio on a desktop,
   couple and crew on phones, side by side when one causes the other.
2. **Eight chapter clips** (25–45 s each), cut from the same recording.
   They sit on the journey page, one per stage.
3. **A 60 s teaser** (landscape) and a **30 s vertical cut** for social,
   from the same footage with their own short narration.
4. **"What to expect" page** — a timeline of the wedding, three lanes
   (You · Your couple · Your crew), each stage with its clip. In the app it
   can be **personalised to one of the studio's own jobs and settings.**

Everything reuses the existing pipeline (`scripts/how-to/`), voice (Brian),
hosting (`public/how-to/`, versioned, immutable) and player.

---

## 2. The story

One fictional couple, start to finish — never different couples per stage.
A viewer must be able to follow *one* wedding.

- **Studio:** Alder & Muse (the seed studio).
- **Couple:** **Ella & Marcus Hart**, wedding **Saturday 12 June 2027**,
  Willow Creek Barn. Ella is the portal login.
- **Crew:** a second shooter (Jamie), offered and accepted on camera.
- **Planner:** gets the run of show through the share link.
- **"Now" moves:** each chapter is filmed at the right distance from the
  wedding, and the on-screen ribbon says so.

### The timeline ribbon

A thin bar along the bottom of every frame: **Inquiry → Booked → Planning →
Wedding → Gallery → Closed**, with a marker and a label — "14 months to go",
"8 weeks to go", "Wedding day", "6 weeks after". It is what makes months of
time legible in 4 minutes, and it is the visual the journey page reuses.

---

## 3. Chapters

Timings are the code's real defaults (sources in §7). **S** = studio
(desktop), **C** = couple (phone), **R** = crew (phone), **✉** = the real
email, rendered.

| # | Ribbon | What we see | Beat the narration lands |
|---|---|---|---|
| 0 | — | Title card, then the empty ribbon draws itself | "A wedding takes a year or more to arrive. Here's every step — and what you, your couple and your crew each see." |
| 1 | **14 months to go** — Inquiry | **C** fills the inquiry form on the studio's website → **S** Today: new inquiry card, Cue's drafted reply → Approve & send → **C ✉** the reply, with their own inquiry page link | "You approve one reply. If they go quiet, StudioCue drafts the follow-ups at 3 and 7 days." |
| 2 | **13 months** — Consultation | **C** picks a call time on their inquiry page → **S** it's in the calendar → the day before, "Ahead of our call" waits for approval | "The day before, it prepares what to ask." |
| 3 | **13 months** — Booking | **S** builds the proposal → **C** chooses the package → signs the agreement → pays the retainer. **S** Booking tab ticks each one *as it happens* (side by side) → **Booked**; the job moves from Inquiries to Jobs | "Booked means two things are in: the signed agreement and the paid retainer. You don't chase either." |
| 4 | **12 months** — Crew | **S** approves the prepared staffing plan → **R ✉** offer → **R** accepts on the phone → **S** the crew slot fills | "If they don't answer in a day, it goes to the next person." |
| 5 | **12 → 6 months** — The quiet months | Ribbon runs forward. **C** Home shows what's next and when. **S** Today has nothing on the Harts | "For months, there's nothing to do. StudioCue knows what's coming and brings it to you on the right day." *(This is the line a trial studio most needs.)* |
| 6 | **6 months → 4 weeks** — Planning | **S** Today "Send the form" → **C** the questionnaire, prefilled, "Which are you?" → **S** COI requested from the venue (60 days) → billing address (8 weeks, if QuickBooks tax is on) → run of show built from their answers → published: **C** approves the timeline, **R** gets the day sheet, planner gets the share link → **4 weeks:** details lock, **C** signs off final details; final invoice goes out, autopay charges at 2 weeks | "Every one of these lands on your Today on its day. Most go out by themselves." |
| 7 | **Wedding week** | **S** readiness all green → **Ready**; the day-before checklist to approve → **R** the day sheet with call time and venue → **S** event-day screen | "When it says Ready, it is." |
| 8 | **Wedding → 10 weeks after** — After | **S** "Did this go ahead? Yes" → post-production → **R** submits hours and expenses, **S** approves → **S** releases the gallery → **C ✉** gallery email → **C** the gallery → review ask (3 days in portal, 10 days email), album reminders → **S** closeout → **Closed** | "From the first email to the album, one place." |
| 9 | — | End card. **Sales:** "Start your free trial." **In-app:** "See this for your next wedding →" | — |

**The closing number.** At the end of the story run, count from the audit
log how many things the studio approved versus how many StudioCue did by
itself, and say it: *"You stepped in N times. StudioCue handled the other
M."* It must be counted from the run, never estimated.

---

## 4. How it looks on screen

Three layouts, chosen per step in the script:

| Layout | Used for | Picture |
|---|---|---|
| **Studio** | Most studio steps | Desktop full frame, as today |
| **Phone focus** | A couple or crew moment on its own | The phone in a device frame, centred, over a softened still of the studio; a small label "What Ella sees" / "What Jamie sees" |
| **Side by side** | Cause → effect (couple signs → Booking tab ticks; crew accepts → slot fills) | Studio at ~⅔ width on the left, phone on the right, both live |

**Emails** are the real templates from
`functions/src/communications/email-templates.ts`, rendered with the story's
names into a plain, generic phone mail view. Real copy, so the film can't
promise an email the product doesn't send.

**Music:** the how-to videos have none. The sales cuts probably want a low
bed under the voice (needs a licensed track). The in-app version stays voice
only.

---

## 5. What has to be built

### 5a. Pipeline (scripts/how-to/)

- **Scenes with personas.** A step gains `on: "studio" | "couple" | "crew"`
  and `layout`. The recorder signs in up to three browser contexts at once
  (desktop 1440×810 @2×, phones 390×844 @3×) and screencasts whichever are
  on screen. Frames are already timestamped, so side-by-side sync is free.
- **Compositor.** `assemble.ts` lays out each step by its layout (ffmpeg
  `overlay`; device frame and label as a captured card), adds the ribbon,
  then the voice as today.
- **Email card.** `{ email: { template, to } }` renders the real template
  into the phone mail view.
- **Ribbon.** `{ ribbon: { at: "6 months to go", stage: "Planning" } }`.
- **Long film = chapters joined.** Each chapter records on its own (so one
  can be re-cut), and `make.ts journey` joins them. Manifest gets
  `journey` plus `journey-<n>` clips, `journey-teaser`, `journey-vertical`.

### 5b. The story fixture — the hard part

There's **no way to move the clock**, and the emulator **never runs
scheduled functions**. The UAT walks get round this by moving the wedding
date and calling the scheduler by hand. That doesn't work for one story:
the wedding date would change on screen from chapter to chapter.

**Approach (to prove in the spike):**

- **The wedding date stays fixed** (12 June 2027).
- **Browser "now"** is set per chapter with Playwright `page.clock`. Today's
  windows, countdowns and "in 6 weeks" copy are computed in the browser
  (`components/today/use-today-inbox.ts`), so they follow.
- **Server "now"**: before each chapter, `scripts/how-to/journey-fixture.mts`
  advances the Harts' job to that chapter's start and then runs the real
  scheduler cores for that window with an explicit `now` (several already
  take one — `*-core.ts`), then drains `emailJobs` with `processJobDocument`,
  as `scripts/uat/` does. Where a core reads `new Date()` itself, add an
  optional `now` parameter (emulator-only callers; production unchanged).
- **Backdating:** timestamps written during the run ("Signed 14 May") are
  rewritten to story dates by the fixture.
- **Snapshot per chapter** (`emulators:export`), so any chapter re-records
  from its own start.
- **Payments:** the couple paying on camera needs the mock payment flow to
  look real in the emulator. Check in the spike; fallback is "paid" arriving
  on the studio side while the phone shows the receipt.

### 5c. The "What to expect" page

- **Where:**
  - In the app: Help & guides → "A wedding, start to finish" (the static
    Example job page, `components/help/example-tour.tsx`, becomes this).
  - A Today card **only while the studio has no booked wedding**: "See what
    a wedding looks like, inquiry to album." Dismissible.
  - A setup-checklist row, and a link in the trial welcome email.
  - Public: `/how-to/wedding-journey` with the film, transcript and
    `VideoObject`. Home page hero: **"Watch a wedding, start to finish (4
    min)"** beside Product tour.
- **Shape:** the ribbon across the top; under it, stages in order. Each
  stage: *when* · *what StudioCue does by itself* · *what you approve* ·
  *what your couple sees* · *what your crew sees* · its clip. On a phone,
  one lane at a time.
- **Personalised (in the app):** "Show this for: [pick a job]". Every
  stage then gets a real date from that job's wedding date **and this
  studio's settings** — planning form timing, lock days, COI lead days,
  autopay, review link, album in package. Anything switched off shows as
  "Off for your studio — turn it on in Settings."
- **One source of truth:** a pure `features/journey/expected-timeline.ts`
  built from the same constants the schedulers use
  (`features/planning/planning-timeline.ts`, the COI lead days, the
  invoice and review offsets). A test fails if a scheduler's offset and the
  page disagree — otherwise this page goes stale the first time a default
  changes ([[copy-outlives-the-change]]).

---

## 6. Things the film must not promise (fix or leave out)

The timeline walk found gaps between what a viewer would assume and what
ships today. Each is either fixed before filming or left out of the
narration:

| Gap | Today | Recommendation |
|---|---|---|
| **No week-of reminder to the couple** | `event_reminder` template exists; nothing queues it | **Build it** (small): it's the email a couple expects |
| **No call-time reminder to crew** | `crew_reminder` exists; nothing queues it | **Build it** with the above |
| **Consultation reminder** | `consultation_reminder` never queued; "Ahead of our call" covers it | Fine — film "Ahead of our call" |
| **BOOKED → PLANNING** | Only by hand | Decide: move automatically when the planning form opens, or never mention "Planning" as a stage the studio changes |
| **Readiness checkpoint reminders** | Defined (7 days before, 1 day overdue); sender not confirmed | Confirm before claiming |
| **No demo job at EVENT_COMPLETE / REVIEW_REQUESTED / CLOSED** | — | The story fixture covers it |

---

## 7. Where the timings come from

| Moment | Default | Source |
|---|---|---|
| Inquiry follow-ups | 3 and 7 days; close offered at 14 | `functions/src/intake/follow-ups.ts:23-25` |
| "Ahead of our call" | 1 day before | `functions/src/booking/consultation-prep.ts:40` |
| Contract reminders | 3 and 7 days after sending | `functions/src/contracts/reminders.ts:18` |
| Crew offer window | 24 h, then the next person | `functions/src/crew/offer.ts:67` |
| Planning form | 6 months before | `features/planning/planning-timeline.ts:28` |
| Questionnaire due | event details 180 days, final schedule 35 days; reminders 14 and 3 days before due | `features/questionnaires/recommended-templates.ts:206-219` |
| COI requested / due | 60 / 14 days before | `functions/src/coi/automation.ts:52,181` |
| Billing address | 8 weeks (QuickBooks tax only) | `functions/src/billing/billing-address-request.ts:33` |
| Schedule confirmation + final-invoice notice drafts | 30 days | `functions/src/communications/lifecycle-core.ts:33-34` |
| Final invoice / due | 28 / 14 days before | `functions/src/operations/invoice-scheduler.ts:80`, `booking/final-invoice.ts:155` |
| Details lock | 28 days | `features/planning/planning-timeline.ts:31` |
| Autopay | on the due date, retry after 3 days | `functions/src/billing/autopay-core.ts:21,145` |
| Day-before checklist | 1 day | `functions/src/communications/lifecycle-core.ts:35` |
| Review ask | 3 days (portal), 10 days (email) after delivery | `functions/src/post-event/release.ts:222` |
| Album reminders | 7 and 14 days after delivery | `functions/src/post-event/release.ts:305` |

---

## 8. Order of work

| Phase | What | Done when |
|---|---|---|
| **0. Spike** | Fixed-date story with browser clock + fixture; one side-by-side step (couple signs → Booking tab ticks); one email card; ribbon | A 20 s clip Conor approves **for the look** |
| **1. Words** | Full narration for chapters 0–9, teaser and vertical cut, written into the scripts | Conor approves the words — before any recording, because it's cheap to change here |
| **2. Gaps** | §6: week-of couple + crew reminders; the PLANNING decision | Shipped and walked on prod |
| **3. Pipeline + story fixture** | §5a, §5b; snapshots per chapter | `make.ts journey --check` runs every chapter green |
| **4. Record** | Chapters one by one; Conor approves each; join; teaser; vertical | All approved |
| **5. Journey page** | Static first (public + in-app), then personalised; the parity test | Walked on prod, desktop + phone |
| **6. Publish** | Upload, manifest, home hero, `/how-to`, Today card, welcome email | Plays on prod; screenshots at both sizes |

**Guards:** journey scripts join `how-to:check`; the staleness report covers
them; the parity test keeps the page honest.

**Voice budget:** ~4 min film + teaser + vertical + retakes ≈ 15k
characters on the existing ElevenLabs plan.
