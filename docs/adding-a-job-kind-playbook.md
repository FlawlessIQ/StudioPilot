# Adding a job kind — the playbook

How to add a new kind of job (a quinceañera, a sweet sixteen, a baby naming,
a vow renewal…) so it runs through every trade's journey with its own words.

It is written from the bar & bat mitzvah build (2026-10-14/15:
`docs/mitzvah-journey-plan-2026-10-14.md`, commits `e53f40ee` → `fb2161e8`).
That took about 13 commits and 80 files across five trades, plus three walks
that found 20+ problems the tests did not. Most of those problems are now
fixed for every kind, and the rest are listed under **Traps** so the next
kind avoids them from the start.

**The rule that makes this fast:** a kind is a row in a table, never an
`if (kind === "wedding")`. Behavior comes from `journeyProfile(kind)`,
words come from `vocab(kind, job)` and `tradeVocab(trade, kind)`. A new
`=== "wedding"` check fails `tests/job-kind-branches.test.ts`.

---

## 0. Decide first (the operator answers these, not the code)

Write the answers into a short plan doc (`docs/<kind>-journey-plan-<date>.md`)
before touching code. Each one maps to a switch below.

1. **Name and id.** Studio-facing label (`JOB_KIND_LABELS`), the id
   (`"quince"`), and the words a studio might type for it (for
   `jobKindFromLabel`).
2. **Which existing kind is it closest to?** Copy that profile and change
   only what differs. A mitzvah started as "a wedding without the couple".
3. **Who is the client, and who is it for?** The mitzvah's client is the
   parent; the event is the child's. If they differ, the kind needs its own
   fields (the mitzvah's `honoreeName`, `mitzvahType`) and the job is named
   for the person celebrated: "Noah Levine's bar mitzvah".
4. **Sub-types.** Bar / bat / b'nai / b'not. If the kind has variants the
   family picks, they are a field plus a label table, never separate kinds.
5. **Booking shape.** Agreement or not, deposit vs paid in full, consultation,
   how far ahead the details form goes, final-details lock, COI, album.
6. **Per trade:** what each trade's client fills in (photographer details +
   final schedule + shot list; DJ music planner; makeup/hair party list;
   planner final details) and what the day looks like for each.
7. **Agreement terms.** Anything the kind needs in the contract (the
   mitzvah's synagogue rules and minors) becomes a Schedule B that **counsel
   must review**. Shipping before review is the operator's call; record it.
8. **Vendor types** the kind books that don't exist yet (the mitzvah added
   "entertainment").
9. **Who validates the content.** Run of show, forms and checklists are
   researched, not lived. Name a real studio that runs these events.

---

## 1. The kind itself — `features/job-kinds/job-kinds.ts`

Mirrored below `// ── mirrored below ──` to
`functions/src/job-kinds/job-kinds.ts` (copy the whole tail; a test fails on
drift).

- `JOB_KINDS` — add the id.
- `JOB_KIND_LABELS` — the studio-facing name.
- `jobKindFromLabel` — a regex for the words a studio types. **Order
  matters:** put a kind whose words overlap another's first (a mitzvah has a
  "ceremony" too, so it is checked before the wedding words).
- `VOCAB[kind]` — every field of `JobVocabulary` (event, Event, yourEvent,
  theDay, clientFallback, detailsForm, schedule, brief, scheduleA,
  afterwards, dayBefore…, formAsks, musicOccasion, inquiryDayTitle,
  occasionByName…). Start from the closest kind and reword each one. Never
  "couple", "bride", "ceremony" or "wedding" unless it is one.
- `PROFILES[kind]` — the switches (see the table below).
- **Kind-specific fields** (only if decision 3 or 4 says so): a type list
  and labels (`MITZVAH_TYPES`, `MITZVAH_TYPE_LABELS`), a reader
  (`mitzvahOf(job)`), a label parser (`mitzvahTypeFromLabel` — return
  `null` when a label names two variants: "Bar or bat mitzvah" read as bat),
  and `vocab(kind, job)` personalising the words ("Sam's bar mitzvah").
- `features/job-kinds/example-packages.ts` — `EXAMPLE_PACKAGES[kind]` per
  trade, used by setup and the Packages panel.

### Profile switches

| Switch | What it turns on | Mitzvah |
|---|---|---|
| `consultation` | a call before the proposal | true |
| `agreement` / `payment` | the booking gate; `deposit_and_balance`, `paid_in_full`, `on_the_day`, `invoice_after` | true / deposit_and_balance |
| `detailsFormDaysBefore` | when the details form goes (null = none) | 90 |
| `finalDetailsLock` | the lock + client sign-off before the day | true |
| `runOfShow`, `crew`, `coi`, `album`, `billingAddressRequest`, `exclusiveDay` | those steps | all true |
| `planningTimeline` | uses the **studio's wedding timeline** setting instead of its own day count | false |
| `shotList` | shot list + client must-take uploads (photo trades) | true |
| `vendorTeam` | the client is asked for their vendor team | false |
| `dayPlan` | which built day plan (`"wedding"`, `"mitzvah"`, null = AI/rules) | "mitzvah" |
| `partner` | the inquiry asks a partner's name | false |
| `scheduleAParts` | which required parts Schedule A lists | "mitzvah" |
| `honoree` | the job carries who it celebrates | true |
| `agreementTerms` | adds a kind Schedule B to the agreement | "mitzvah" |

A new value for `dayPlan`, `scheduleAParts` or `agreementTerms` widens the
union type and needs its content (steps 5 and 6). `planningTimeline: false`
is right for every kind but the wedding: **check every reader of it** (see
Traps 7).

---

## 2. The inquiry and the job it makes

- `features/leads/inquiry-form-config.ts` (+ mirror
  `functions/src/intake/inquiry-form-config.ts`): `dayFieldsForKind(kind)`
  (date/city/venue/guests/COI defaults for a new type), and any kind list
  such as `HONOREE_KINDS`. Mind the defaults per trade: a mitzvah row asks
  the guest count even of a makeup artist.
- `features/leads/schema.ts`, `features/leads/public-intake-validate.ts`
  (Zod-free, diffed against the schema by a test),
  `functions/src/crm/public-lead.ts` — accept and store the new fields.
- `components/crm/lead-intake-form.tsx` — the fields on step 1 under the
  type choice; date and venue labels ("Party date"); clear the fields when
  the family switches type.
- `components/job-kinds/honoree-fields.tsx` — the shared field pair, reused
  by `create-project-form.tsx` and `project-edit.tsx`.
- `functions/src/intake/convert.ts` — copy the fields onto the job and
  **name the job for whoever it is for** (`jobName`).
- `functions/src/intake/new-inquiry-alert.ts` — the studio's email shows them
  (the "Celebrating" row).
- `functions/src/ai/intake-prefill.ts`, `features/crm/project-prefill.ts`,
  `lib/ai/project-intake-client.ts` — a job started from a pasted message
  reads them too.
- `components/setup/setup-conversation.tsx` — offer the kind in setup.

---

## 3. Every trade's words — `features/trades/trades.ts`

Mirrored to `functions/src/trades/trades.ts`.

- `KIND_VOCAB[trade][kind]` — only what differs from the trade's wedding
  words: `detailsForm` (the form's real name), `kitChecklist`, `trialHint`
  (null — there's no veil), `prepGuide`, `dayName`, `dayBefore`…
- **Pass the kind wherever the job is known.** `tradeVocab(trade)` alone
  reads as a wedding. Places that needed it for the mitzvah:
  `features/journey/steps.ts` (both `tradeVocab` calls),
  `components/client/kit/client-plan.tsx`, `client-questionnaire.tsx`,
  `client-schedule.tsx`, `components/planning/inquiry-event-form-setting.tsx`,
  `components/projects/live-project-detail.tsx` (trial card),
  `features/today/inbox.ts` (trial invite),
  `functions/src/communications/email-templates.ts`.
  Find the rest with:
  ```bash
  grep -rn "tradeVocab([^,)]*)" components app features lib functions/src | grep -v test
  ```
  and ask, at each one, "is a job in hand here?"
- A form name mid-sentence uses `formNameInSentence()`, never
  `.toLowerCase()` (it turned "MC" into "mc").

---

## 4. The client's side (portal, `/i/`, emails, Cue)

- `components/client/live-client-views.tsx` `useClientVocab()` reads
  `vocab(jobKindOf(project), project)`. **The portal API must send the new
  fields:** `app/api/client/portal/route.ts` (the project payload). Missing
  there, the portal fell back to the type label and got it wrong.
- `components/inquiries/couple-inquiry-page.tsx` (`/i/`), and
  `functions/src/intake/inquiry-link.ts`.
- `functions/src/communications/email-templates.ts`,
  `lifecycle-core.ts`, `lifecycle-scheduler.ts`, `features/messaging/render.ts`
  — pass `eventKind` and the new fields into every client email.
  `tests/mitzvah-client-copy.test.ts` renders every client email for every
  trade and fails on a wedding word: copy it for the new kind.
- **Cue:**
  - `functions/src/ai/copilot.ts` `compact()` has an allow-list of record
    fields. **Add the new fields** or Cue never sees them and guesses
    ("Rachel Cohen's bat mitzvah").
  - `functions/src/ai/message-draft.ts` — add the fields to the lead and
    project context, and one sentence to `MESSAGE_DRAFT_RULES` on how to
    write to this kind's client.
  - `functions/src/ai/studio-voice.ts`, `functions/src/booking/public-scheduling.ts`,
    `functions/src/operations/ai-pdf.ts`, `jobs.ts` — kind words in their
    prompts and PDFs.
  - Client email prompts use `tradeInstruction(trade, { forClient: true })`
    (no how-to facts). Keep it that way for any new client prompt.
  - `tests/cue-eval.test.ts` pins the copilot prompt size: update the pin.

---

## 5. Planning content, per trade

- **Forms:** `features/questionnaires/recommended-templates.ts` (text-mirrored
  to `functions/src/planning/recommended-templates.ts`). Ids follow
  `${kind}-details`, `${kind}-final-schedule`, `${kind}-shot-list`,
  `${kind}-music-planner`, `${kind}-makeup-party-list`,
  `${kind}-hair-party-list`, `${kind}-planner-final-details`. Help text must
  not assume another trade ("when your photographer arrives").
- **Seeding:** add the kind to `OFFERED_KIND_FORMS` (recommended-templates)
  so `setInquiryForm` (`functions/src/crm/commands.ts`) copies its forms in
  when a studio first offers the kind.
- **Inquiry form per kind:** add it to `INQUIRY_FORM_KINDS`
  (`functions/src/intake/inquiry-form.ts`) and render
  `<InquiryEventFormSetting kind="…" />` on `app/studio/questionnaires/page.tsx`.
- **The day:** a plan file like `features/schedules/mitzvah-plan.ts`
  (`planMitzvahDay`, `planMitzvahNight`), picked by
  `features/schedules/built-day.ts` `planBuiltDay`; standard moments
  (`features/schedules/standard-moments.ts`, `functions/src/ai/schedule-moments.ts`);
  DJ MC-script rules (`features/schedules/mc-script.ts` + mirror);
  crew brief rules (`features/questionnaires/crew-brief.ts`,
  `functions/src/planning/crew-brief.ts`).
- **Beauty party lists:** `features/schedules/party-list.ts` (+ mirror)
  `ROLE_WORDS` — the person celebrated sits where the bride does; strip
  "mother **of the** …" before matching.
- **Planner checklist:** `KIND_CHECKLISTS` + `CHECKLIST_KINDS` in
  `features/planning/planning-checklist.ts` (+ mirror). The settings screen
  shows a tab per `CHECKLIST_KINDS` entry and saves under `"<kind>:<scope>"`.
- **Schedulers:** `functions/src/planning/planning-form-scheduler.ts` —
  `planningFormDue`, `sendPlanningFormAtBooking`, `shotListTemplateFor`.

---

## 6. The agreement

- `features/contracts/event-details.ts` (identical copy at
  `functions/src/contracts/event-details.ts` below line 30): the Schedule A
  labels for `scheduleAParts`. **Check label collisions** — "Service" was
  both the synagogue service and the DJ's package (now "Booked").
- Schedule B: a terms function like `mitzvahTermsBlocks(trade)`, wired
  through `functions/src/contracts/sources.ts` (`kindTerms`) and
  `features/contracts/document.ts` (+ mirror). It says it governs conflicts.
- `features/contracts/sample.ts` starter agreements must not hardcode
  "wedding".
- Write a counsel pack like `docs/mitzvah-schedule-b-counsel-review.md`.

---

## 7. Vendor types (only if decision 8 adds one)

Six lists: `features/vendors/schema.ts` `VENDOR_TYPES`,
`features/vendors/team.ts` (labels + `VENDOR_TEAM_CATEGORIES`),
`features/vendors/couple-team.ts`, `functions/src/planning/vendor-section.ts`
(type + matching regex + label), `functions/src/planning/vendor-team.ts`,
`functions/src/planning/vendor-credits.ts`. A type with no trade is never
invited (`vendorTypeIsLive` stays false).

---

## 8. Tests and guards

Add one test file per kind (model: `tests/mitzvah-trades.test.ts`,
`tests/mitzvah-planning.test.ts`, `tests/mitzvah-client-copy.test.ts`) and
**add it to the `test` list in `package.json`** — `npm test` does not glob.

The guards that will fire, and what to do:

| Guard | Fires when | Do |
|---|---|---|
| `tests/job-kind-branches.test.ts` | a new `=== "wedding"` | use a profile switch |
| `tests/job-kind-copy.test.ts` | wedding words in code paths | reword; re-pin down with `JOB_KIND_COPY_WRITE=1` |
| mirror checks (`tests/job-kinds.test.ts`, `tests/trades.test.ts`, `tests/preloaded-forms.test.ts`…) | a `functions/` copy drifted | copy the tail below the marker |
| `tests/us-english-copy.test.ts` | British spelling | fix |
| `tests/cue-eval.test.ts` | prompt size changed | update the pin |
| text pins (dj-journey, preloaded-forms, vendor-phase2, public-inquiry-form…) | copy they pin changed | update the pin to the new wording |

---

## 9. Traps (each one cost a walk to find)

1. **Name the job for who it is for.** The parent's name + label reads as
   the parent's event to the family ("Welcome to Dana Levine Bar mitzvah").
2. **API payloads drop new fields.** The portal route, Cue's `compact()`,
   the message-draft context — each has its own field list.
3. **Labels that name two variants** ("Bar or bat mitzvah") must parse to
   none, not the second.
4. **`tradeVocab(trade)` without the kind** reads as a wedding (form names,
   the veil hint). Pass the kind wherever the job is known.
5. **Lowercasing a name** loses initials. Use `formNameInSentence`.
6. **Schedule A label collisions** between the kind's parts and a trade's
   package row.
7. **Gates on `planningTimeline`** silently skip every other kind: the vendor
   form never went out at booking. Gate on what the code needs
   (`dayPlan`, a form existing), not on "is it the wedding timeline".
8. **AI prompts carrying studio how-to** leak screen names into client
   emails. Client prompts use `forClient: true`.
9. **Role words** in parsers (party lists) only know wedding roles.
10. **Starter text and help text** hardcode the wedding or the photographer.
11. **A tab opened after an `await`** is blocked on an iPhone. Use
    `openInNewTab()` (`lib/open-in-new-tab.ts`).

---

## 10. Walk it — tests never found these

**Emulator** (an hour): copy `scripts/uat/mitzvah-walk.mts` and change the
kind, fields and forms. For each trade: save the inquiry form offering the
kind → public inquiry → job fields and name → to booked → the agreement's
schedules → the form sent at booking → the trade's plan (night plan, chairs,
checklist) → the portal payload and every client email checked for wedding
words. Run it with `functions/.env.local` sourced:
```bash
set -a; . functions/.env.local; set +a
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx tsx scripts/uat/<kind>-walk.mts
```

**Prod, per trade** (Spin Theory DJs, Glow by Ana, Jess Styles Bridal,
FlawlessIQ — all one Chrome sign-in via `/auth/workspaces`):

1. Settings → Job types: add the kind; read "What each kind does".
2. Questionnaires: the kind's form was copied in; the helper text names it.
3. Public inquiry (`/inquiry?studio=<slug>`): the kind's fields appear and
   the labels read right.
4. The job: its name, subtitle, journey steps (form name), trial card.
5. Cue's reply draft: names the person, no wedding words, no screen names,
   doesn't ask how they heard of the studio.
6. Proposal → booking link: Schedule A labels, Schedule B wording.
7. **The family's side** (the operator signs in a private window, ideally
   on a phone): the invite, the agreement, signing, the signed copy
   download, the Plan tab.

Chrome-walk traps: refs go stale after typing — click by coordinates; the
first click after a page load can be lost — check the field took; a
background tab drops typing; the workspace switcher list scrolls, so check
which studio opened.

---

## 11. Ship

Functions first, all of them (shared modules), then the app:

```bash
cd functions && npm run build && cd ..
firebase deploy --only functions --project production
./scripts/configure-production-function-invokers.sh studiohub-prod us-east4
./scripts/verify-deployed-function-freshness.sh studiohub-prod us-east4
# spot-check a bundle, e.g. operationsTaskWorker's email-templates.js
git push origin main
firebase apphosting:rollouts:create studiohub --git-branch main --project production --force
```
Confirm the rollout reached SUCCEEDED **on your commit**.

---

## Done when

- [ ] Plan doc written with the operator's answers (step 0)
- [ ] Kind row, vocab, profile, fields, example packages (1)
- [ ] Inquiry fields → job, named for who it's for (2)
- [ ] `KIND_VOCAB` for every trade; kind passed at every job-aware call (3)
- [ ] Portal payload, emails, Cue compact + draft context (4)
- [ ] Forms per trade, seeding, inquiry-form setting, day plans, checklist, schedulers (5)
- [ ] Schedule A labels, Schedule B + counsel pack, starter text (6)
- [ ] Vendor types if needed (7)
- [ ] Kind test files in `package.json`; every guard green (8)
- [ ] Traps 1–11 checked by hand (9)
- [ ] Emulator walk green for every trade; prod walk per trade; family side walked on a phone (10)
- [ ] Functions fresh, invokers applied, rollout on your commit (11)
- [ ] Counsel review and a real studio's content review booked
