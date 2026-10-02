# Beyond weddings — one journey, many kinds of job (2026-10-02)

**Outcome.** A studio that shoots weddings, family sessions, corporate events
and sports runs all of them through the same StudioCue journey. A family
filling in the inquiry form never reads "your wedding", "the couple",
"ceremony" or "dress on a hanger". A sports job doesn't nag about a final
balance, a wedding-details lock or an album. Nothing is rebuilt: the same
inquiry, proposal, agreement, payments, forms, schedule, crew, delivery and
review features serve every kind of job. The kind of job decides only four
things:

1. **Words** — what the event, the client, the day and the forms are called.
2. **Which steps apply** — e.g. no final-details lock for a 1-hour family shoot.
3. **Timings** — e.g. the details form 2 weeks out instead of 6 months.
4. **Starter content** — packages, forms, agreement, run-of-show moments.

**The rule that keeps this from becoming a rebuild:** components never branch
on kind (`if (kind === "wedding")`). They look things up — `vocab(kind).event`,
`profile.steps.finalDetailsLock`. Everything wedding-only lives in the wedding
row of those tables, not in the screens.

---

## Gabe's answers (GR Productions, 2026-10-02)

| Question | Answer | What it changes |
|---|---|---|
| Headshots — portraits or corporate? | **Corporate** | Headshots move to the corporate kind |
| Agreement for a 1-hour family shoot? | **"No. That's overkill."** | Family books **without an agreement** — the booking gate must allow it |
| Deposit or paid in full? | **Paid in full** for family and sports | Confirms the profile default; no final balance for either |
| Non-wedding volume? | **~200 jobs a year, maybe more** | Non-wedding work is likely **most of his jobs**. The light path matters more than the wording |
| Cheer — one day or a season? | **Sports; paid on the day by clients** | Sports is paid **at the event**, not at booking |

**What this means for the plan**

- **Volume decides the design.** At ~200 a year (roughly 4 a week), a family
  or sports job cannot cost the studio the wedding's ~5 hours of admin. It has
  to book itself: inquiry → package + time → pay → booked, with the studio
  tapping at most once. That is now the headline of Phase 2.
- **The booking gate becomes per kind.** Today it always needs a signed (or
  hand-attested) agreement plus a paid retainer. Family needs *payment only*;
  sports needs *neither before the day*. Same gate, different requirements —
  still evaluated server-side and recorded on the gate evidence, so the
  evidence-controlled transition stays deterministic.
- **"Paid on the day" is a new payment timing**, but not a new feature: the
  full invoice is raised due on the event date (or marked paid by hand when
  cash/card is taken on site), and the job can't close until it's settled.

**Follow-ups (Gabe, same day)**

| Question | Answer | What it changes |
|---|---|---|
| Cheer — organiser pays, or each parent? | **Both happen** | Organiser-paid days fit Phase 2. Parent-paid days are *one event, many paying clients* — promoted from "Later" to **Phase 5, group events** |
| Agreement for sports? | **No** | Sports gate = date + contact; no sports agreement template |
| Split of the ~200? | **20–40% each** | Roughly even — all three kits are needed; no kind can wait |
| Corporate — deposit + balance, or invoice after? | **Both** | Corporate payment is a **per-package choice**, not a kind default |

- **Corporate gets two payment shapes**, chosen on the package (and
  changeable on the job): *deposit + balance before* (the wedding mechanics)
  or *invoice after the event* (full invoice raised the day after, due in the
  studio's terms, e.g. 30 days). Both keep the agreement.
- **Parent-paid sports days need one stopgap now.** Until group events ship,
  the studio books the day as one job (the organiser as client) and records
  the day's takings by hand as "paid on the day". Honest, not ideal: no
  per-parent receipts or galleries yet.

---

## Where it stands today (mapped 2026-10-02)

More groundwork exists than you would expect, but it is half-wired.

**Already there**

- The inquiry form has studio-defined types, each with a **kind** —
  `wedding | portraits | sports | corporate | other | general`
  (`features/leads/inquiry-form-config.ts`, mirrored in functions). Each kind
  already decides which "your day" fields show (`dayFieldsForKind`).
- Workflow (readiness) starters exist for wedding, corporate and sports
  (`features/workflows/starter-templates.ts`); sports already drops retainer,
  questionnaire, COI and final balance.
- Questionnaire starters exist for the same three
  (`features/questionnaires/starter-templates.ts`).
- Packages carry `eventTypeId`; the portal filters packages by it.
- Contacts already have `corporate_contact` and `guardian` types and a
  `company` field. The client portal role is the neutral `client`.
- Per-project switches exist: `insuranceRequired`, `albumIncluded`,
  `reviewRequestsSkippedAt`, `clientAutomationsPausedAt`.

**What's broken or missing**

| # | Problem | Where |
|---|---|---|
| B1 | **The job forgets its kind.** Lead → job copies `eventTypeId` + label but drops `eventKind` and `eventTypeKey` | `functions/src/intake/convert.ts:120,171` |
| B2 | **Email/Gmail capture forces `eventTypeId: "wedding"`** even when the label says "Corporate" | `functions/src/intake/capture.ts:463` |
| B3 | **Changing a job's type changes the label only**, so label and id drift | `functions/src/crm/commands.ts:3567` |
| B4 | **Portraits and Other get nothing** — no workflow (`no_active_template`), no planning form, no portal packages | `functions/src/workflow/commands.ts:1811` |
| B5 | **Two taxonomies.** `eventTypeTemplates` (wedding/corporate/sports/school/business/other) is seeded and has rules but **nothing reads it** | `features/event-types/schema.ts` |
| B6 | Create-job, package, workflow, questionnaire, timing-rule forms and Cue's enums hard-code **Wedding/Corporate/Sports** | `components/crm/create-project-form.tsx:37`, `ai/copilot.ts:155` … |
| B7 | **The journey ignores kind.** 15 fixed steps; a sports job still shows retainer, questionnaire, COI, final balance even though its workflow skips them | `features/journey/steps.ts:358` |
| B8 | **Wedding-only schedulers run for every job** — final-details lock + sign-off (28 days), planning form (6 months), final balance (28 days) | `functions/src/planning/final-details.ts:147`, `planning-timeline.ts:28`, `operations/invoice-scheduler.ts:79` |
| B9 | **"Unknown kind = wedding"** in schedule moments and Schedule A — safe today, wrong the moment other kinds are real | `features/schedules/standard-moments.ts:168`, `features/contracts/event-details.ts:93` |
| B10 | **Date clash assumes one booking per day** — wrong for family sessions (several a day) | `features/booking/gate-requirements.ts` |
| B11 | Final-balance timing disagrees with itself: journey/Today say ~45 days, scheduler raises at 28 and makes it due at 14, the notice goes at 30 | `features/today/inbox.ts:60` vs `invoice-scheduler.ts:79` |

**The wording.** ~630 files match wedding terms; there is **no vocabulary
layer** — no `eventNoun()`, no `clientLabel()`, no i18n. Densest first:

1. AI prompts + planning backend (`functions/src/ai/*`, `planning/job-facts.ts`)
2. Help (`features/help/explainers.ts`, `glossary.ts`, video transcripts)
3. **Client portal** (`components/client/*`, `server/client/*`) — "Your wedding", "Wedding day · version n"
4. Today + job page (`features/today/inbox.ts`, `live-project-detail.tsx`, `wedding-brief.tsx`)
5. Agreement / Schedule A (`features/contracts/event-details.ts`, `document.ts` + mirrors)
6. Emails (`functions/src/communications/email-templates.ts`, `lifecycle-core.ts`)
7. Inquiry page, crew screens (lightest)

---

## The design

### 1. Kinds — the fixed list the product understands

Keep the stored enum values (no data migration of existing values); give them
studio-friendly names.

| Kind (stored) | Shown as | Covers |
|---|---|---|
| `wedding` | Wedding | weddings, elopements, engagements* |
| `portraits` | Family & portraits | family, newborn, maternity, seniors |
| `corporate` | Corporate & events | conferences, company events, galas, **all headshots** (Gabe) |
| `sports` | Sports | games, team/individual days, cheer, tournaments |
| `other` | Other event | parties, bar/bat mitzvahs, anything else with a date |
| `general` | General question | inquiry only — never becomes a job kind |

\* Engagement sessions are a wedding-adjacent portrait shoot; studios can
file them under either. Decision for the studio, not the product.

A studio's **job types** (its own labels — "Cheer", "Mini sessions",
"Headshots") each point at one kind. That list already exists as the inquiry
form's types; it becomes **Settings → Job types** and the one source of truth.
`eventTypeTemplates` is deleted (B5).

### 2. Every job knows its kind (data)

Project gets two fields, both written by every path that makes a job:

- `eventKind` — one of the kinds above. **Drives words, steps, timings.**
- `eventTypeKey` — the studio's own type id. **Drives the label and
  per-type overrides.**

`eventTypeId` stays as the template-matching key and is set to the kind (it
already is for everything except wedding). One resolver,
`jobKindOf(project)`, reads `eventKind`, falling back to `eventTypeId`/label
for old records, and **falls back to `other`, never `wedding`**, once the
backfill has run (B9).

### 3. Vocabulary — the words

`features/job-kinds/vocabulary.ts`, mirrored to `functions/src/job-kinds/`
with a diff test (same pattern as `inquiry-form-config.ts`). One row per kind:

| Key | Wedding | Family & portraits | Corporate | Sports | Other |
|---|---|---|---|---|---|
| `event` | wedding | session | event | event | event |
| `yourEvent` | your wedding | your session | your event | your event | your event |
| `theDay` | the day | session day | event day | game day | the day |
| `clientFallback`† | the couple | the family | the client | the team | the client |
| `detailsForm` | Wedding details | Session details | Event details | Event details | Event details |
| `schedule` | Wedding-day timeline | Session plan | Run of show | Game-day plan | Run of show |
| `brief` | Wedding brief | Session brief | Event brief | Event brief | Event brief |
| `scheduleA` | Wedding details (Schedule A) | Session details (Schedule A) | Event details (Schedule A) | Event details (Schedule A) | Event details (Schedule A) |
| `afterwards` | After the wedding | After your session | After the event | After the event | After the event |
| `dayBeforeChecklist` | dress on a hanger, rings, flowers, invitations | outfits laid out, colours coordinated, little ones fed & rested | on-site contact, parking, badges, agenda | uniforms, roster, arrival time | on-site contact, timings |

† **Names beat nouns.** Most copy should say "Emma & James" or "Acme Corp"
via a `clientRef(project)` helper; the noun is only the fallback. This also
dodges "the couple **are**" vs "the client **is**" grammar.

**What does not change:** stored values and code identifiers
(`awaiting_couple`, `owner: "couple"`, `couplePackageView`, `couple-*` hint
keys, the `/client` route). Renaming those is churn with no user-visible gain.
Only visible copy moves.

### 4. Journey profiles — which steps, when

`features/job-kinds/journey-profile.ts` (mirrored). Defaults per kind; a
studio can override any of them per job type in Settings → Job types.

| Step | Wedding | Family & portraits | Corporate | Sports |
|---|---|---|---|---|
| Consultation | on | **optional, off** | optional | **off** |
| Proposal | on | **"Book & pay"** — package + price + pay link in one step | on | on (or none — see cheer question) |
| Agreement (booking gate) | on | **off** (Gabe: overkill) | on | **off** (Gabe) |
| Payment shape | retainer + final balance | **paid in full at booking** (Gabe) | **per package: deposit + balance, or invoice after** (Gabe) | **paid in full on the day** (Gabe) |
| Booking gate needs | agreement + retainer | **payment** | agreement (+ deposit when that shape is chosen) | **date + contact only** |
| Details form sent | 6 months out | **2 weeks** | 4 weeks | 2 weeks |
| Final-details lock + sign-off | 28 days | **off** | **off** | **off** |
| Run of show (AI) | wedding moments | **off** (session plan optional) | corporate moments | sports moments |
| Crew | on | **off** (solo default) | on | on |
| COI to venue | when venue requires | **off** | on | when venue requires |
| Billing address request | on | **off** (paid up front) | on | off |
| Day-before email | wedding checklist | family checklist | corporate checklist | sports checklist |
| Delivery | on | on | on | on |
| Album | if included | if included | off | off |
| Review request | on | on | on | on |
| One booking per day (clash check) | **yes** | **no** | yes | no |

How it plugs in — no new features, just reads:

- **Journey** — `projectJourney` takes the profile; an off step reads "Not part
  of this job" (or is hidden) instead of nagging. Also align it with the
  workflow's checkpoint subset (B7).
- **Schedulers** — `final-details`, `planning-form`, `invoice-scheduler`,
  `billing-address-request`, `consultation-prep`, lifecycle day-before: one
  `journeyProfileFor(project, tenant)` check at the top of each (B8).
- **Today** — only offers cards for steps that are on.
- **Booking gate** — `bookingGateRequirements` (and its functions mirror,
  `tests/booking-gate.test.ts`) takes the profile's `gate` —
  `{ agreement: boolean, payment: "before_booking" | "on_the_day" | "after_event" | "none" }`.
  For corporate the package's payment shape picks `before_booking` (deposit)
  or `after_event`.
  A requirement the profile turns off is satisfied by the profile, and the
  profile used is written onto the gate evidence so a later audit can see
  *why* a job booked without a signature. Blocker copy ("the agreement isn't
  signed") only appears for requirements that apply.
- **Payment shape** — "paid in full" is a 100% `retainerRule`; the final
  balance already skips when nothing is owed (`final-invoice.ts:150`). The
  package editor gets a plain "Paid in full at booking" choice. "Paid on the
  day" raises the full invoice due on the event date and shows a "Take
  payment" card on the day; marking it paid by hand covers cash/card on site.
- **Book & pay** (family) — the proposal the client opens already shows the
  package, the price and the pay button, with no agreement step; paying
  books the job. Reuses proposal + invoice + gate; nothing new is stored.
- **Timings** — `tenants.planningTimeline` becomes the wedding row; other
  kinds use their profile timing unless the studio overrides.
- **Clash check** — `eventDateAvailable` reads `profile.exclusiveDay` (B10).

### 5. Starter kits — the content

Per kind, seeded at onboarding and offered to existing studios:

| Kit item | Wedding | Family | Corporate | Sports |
|---|---|---|---|---|
| Workflow (readiness) | exists | **new** | exists | exists |
| Details form (questionnaire) | exists | **new** | exists | exists |
| Example packages | exists | **new** (mini / full session) | **new** (half / full day, headshots) | **new** (game / team day) |
| Agreement template | exists | none (Gabe) | **new — counsel review** | none unless confirmed (minors → counsel) |
| Run-of-show moments | exists | n/a | **new** (arrivals, keynote, awards, headshots) | **new** (warm-ups, team photo, play, awards) |
| Email templates | via vocab | via vocab | via vocab | via vocab |

`other` falls back to a generic kit (B4) — never the wedding one.

Onboarding gains one question: **"What do you shoot?"** (multi-select) →
seeds the job types and kits.

### 6. Minors (sports, family)

From `docs/product-spec.md` § Safety and privacy, applied here:

- The client is always the adult — parent/guardian, coach, or organisation.
  Use the existing `guardian` contact type.
- No child accounts, no messaging children, no birthdates, no face matching.
- Children's names only where the studio types them (shot list, roster).
- Agreement templates for minors need counsel before they ship.

---

## Phases

Each phase ships on its own and is walked on prod before the next
(see the "walk it on prod" rule).

### Phase 0 — Every job knows its kind (data truth) · S

- `eventKind` + `eventTypeKey` on projects; written by convert, capture,
  create-job, import, Cue, AI-PDF intake. Fix B1, B2, B3.
- `jobKindOf()` resolver + backfill script for existing jobs (read label →
  kind; FlawlessIQ and GR jobs are all weddings today).
- Settings → Job types (promoted from the inquiry form editor); every
  hard-coded Wedding/Corporate/Sports picker reads it (B6).
- Delete `eventTypeTemplates` (rules, seed, lifecycle list) (B5).
- Generic fallback templates so `portraits`/`other` jobs get a workflow and a
  form (B4).
- Job page: change the job's type (re-applies profile; warns if forms already
  went out).

### Phase 1 — Words (vocabulary + sweep) · L

- `vocabulary.ts` + `clientRef()` + mirror + diff test.
- Sweep in risk order — **client-facing first**, because a family reading
  "your wedding" is the embarrassing failure:
  1. Emails + lifecycle drafts
  2. Client portal
  3. Public inquiry page + `/i/` link
  4. Agreement / Schedule A (parts per kind: getting ready / ceremony /
     reception for weddings; location + times for everything else)
  5. Today + job page (`wedding-brief.tsx` → brief)
  6. Cue + AI prompts (pass kind + vocab into every prompt; drop the
     Wedding/Corporate/Sports enums)
  7. Crew screens
  8. Help: explainers + glossary through vocab where generic. **Videos stay
     wedding** and are labelled "shown with a wedding" — re-record later.
- **Guard test** (`tests/job-kind-copy.test.ts`): scans user-visible strings
  in `components/`, `app/`, `functions/src/communications/` for
  wedding/couple/ceremony/bride/groom outside the vocabulary and the wedding
  kit. Starts with an allowlist that **can only shrink**.

### Phase 2 — Steps, timings and the light path (journey profiles) · M–L

**Most important phase, given ~200 non-wedding jobs a year.**

- `journey-profile.ts` + mirror; per-type overrides in Settings → Job types.
- **Booking gate per profile** — family books on payment alone, sports on
  date + contact, weddings and corporate unchanged.
- **Book & pay** for family; **paid on the day** for sports.
- Journey, Today and the six schedulers read the profile (B7, B8).
- **Today at volume** — a family job that books itself should produce no
  cards until delivery; group same-day sports jobs into one row (compact rows,
  never expanded cards on mobile).
- "Paid in full at booking" in the package editor; clash check per profile
  (B10).
- Fix the final-balance timing disagreement while in there (B11).

### Phase 3 — Starter kits + onboarding · M

- Family, corporate, sports kits (packages, forms, run-of-show moments,
  agreement drafts).
- "What do you shoot?" at onboarding; "Add a kind of work" for existing
  studios.
- Agreement templates go to counsel (with the e-sign review already owed).

### Phase 4 — Walk each kind on prod · S (needs a person for the client side)

On FlawlessIQ, one job per kind, inquiry → closed: a family session, a
corporate event, a sports day. Screenshot every screen at desktop + phone.
Then GR Productions' first real non-wedding job (Lynn's cheer photos).

### Phase 5 — Group events (each parent pays) · L — new shape

Gabe: parent-paid cheer days are real and common. One event, many buyers.

- The job is the event (organiser as the studio's contact, optional).
- A **shareable sign-up link** per event: a parent picks a package, gives
  name + email + the athlete's name, and pays (or chooses "pay on the day").
- Each parent is a **participant** on the job, not a separate job — so Today
  shows one event, not 60 jobs.
- On the day: a roster with paid / unpaid, "Take payment" per parent.
- Delivery per participant (their athlete's photos), review ask per parent.
- Minors rules apply in full: the parent is the client, no child accounts,
  no birthdates, no face matching.
- Needs its own design doc before building — it is the one genuinely new
  structure in this plan.

### Later — not in this plan

These need new *shapes*, not new words, so they are deliberately out:

- **Multi-session jobs** — sports seasons, school picture days, corporate
  retainers. The journey is built on one date; these need many.
- **Mini-session days** — one date, many families, time slots (shares
  most of Phase 5's machinery; do it straight after).
- **Model/guardian releases.**
- **Corporate extras** — POs, repeat clients without a new agreement each
  time. (Invoice-after itself is in Phase 2.)

---

## Decisions

**Settled by Gabe (2026-10-02):** headshots → corporate; no agreement for
family or sports; paid in full for family (at booking) and sports (on the
day); cheer is paid by organisers *and* by parents; the ~200 split roughly
evenly (20–40% each); corporate uses both deposit + balance and invoice-after.

**Still open:** none blocking Phases 0–4. Phase 5 (group events) needs its
own design doc and a walk-through of one real cheer day with Gabe.
