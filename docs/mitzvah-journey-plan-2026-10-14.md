# Bar & bat mitzvahs — the wedding journey, for every trade (2026-10-14)

**Outcome.** A photographer, DJ, makeup artist, hair stylist or planner runs a
bar or bat mitzvah through the same journey as a wedding, at the same weight:
consultation, agreement, deposit and balance, planning forms, a final-details
lock, a run of show, crew and an album. The family, the crew and the studio
read mitzvah words throughout. Nobody reads "the couple", "bride", "ceremony",
"first dance" or "dress on a hanger".

**Why it's mostly a re-key, not a build.** Job kinds (2026-10-02) already put
the words, steps, timings and starter content in one table per kind. The
gaps are in two places:

1. **~90 lines ask "is this a wedding?"** (`=== "wedding"`, hard-coded
   `eventTypeId: "wedding"`, `isWeddingJob`). They really mean "is this a
   full-weight celebration" or "does it use the hand-built day plan". A
   mitzvah would silently fall onto the light path at every one of them.
2. **Trade content is keyed by trade alone.** The DJ music planner, makeup and
   hair party lists, planner checklist, recommended forms and starter
   agreements are wedding content. They show on any job the studio runs.
   They need to be keyed by trade **and** kind.

Fix both generically and mitzvah becomes mostly data. The next celebration
kind (quinceañera, sweet 16) then costs one row per table.

## Status

| Phase | State |
|---|---|
| 0: re-key | **Built 2026-10-14** (branch `mitzvah-phase0`). No behavior change: 4341 tests, typecheck, functions build, lint and the production build all pass. |
| 1: kind | **Built 2026-10-14.** 4343 tests, typecheck, functions build, lint and the production build pass. |
| 2: family's side | **Built 2026-10-14.** 4346 tests, typecheck, functions build, lint and the production build pass. |
| 3: photo/video planning | **Built 2026-10-14.** 4355 tests, typecheck, functions build, lint and the production build pass. Not deployed. |
| 4: other trades | **Built 2026-10-14.** Not deployed. |
| 5: agreements | **Built 2026-10-14 as a draft for counsel.** Not deployed. |
| 6: walk | **Photographer walked on prod 2026-10-14** (FlawlessIQ, Rachel Cohen / Sam's bar mitzvah). Fixes committed, not deployed. DJ, beauty and planner walks are still owed. |

**The prod walk, 2026-10-14** (photographer, FlawlessIQ, conor+mitzvah@)

Worked:
- The kind in Settings → Job types, with wedding-weight fields.
- The three forms seeded when the type was saved.
- The public form's "Who are we celebrating?" and "Which is it?".
- The /i/ page: "Hi Rachel — tell us about Sam's bar mitzvah".
- The AI reply: "Sam's bar mitzvah photography".
- The journey's "Mitzvah details form".
- The contract step's "Mitzvah details not given yet… Ask the family", and
  the wedding-agreement warning.
- Schedule A "Mitzvah details" (Service, Party, Times) and Schedule B, in
  the prepared agreement.
- "Mitzvah brief".
- "There's no party start time yet", and the mitzvah moment chips.

Fixed (one commit after this walk):
1. **The job made when the inquiry arrived** (intake/convert.ts) dropped
   the honoree and type. It now keeps them, and is named by the type
   ("Rachel Cohen Bar mitzvah").
2. **The job header** shows "Sam's bar mitzvah".
3. **The contract's {{event.type}}** says "Bar mitzvah", not the studio's
   "Bar or bat mitzvah".
4. **Schedule B contradicted the studio's own terms.** FlawlessIQ's grant
   it "all images… for competition, advertising". Schedule B now says it
   governs where they differ, uses "the Studio" and "the Client", says
   "many" not "most", and lists competitions.
5. **The AI proposal draft offered to "document your service on Saturday
   morning".** The prompt now forbids offering the service, and the draft
   is given the honoree.
6. **A reply declining a taken date still ended "pick a time to talk".**
   The link is skipped on a conflict. This applied to every kind.
7. **The studio's new-inquiry alert** now shows "Event: Bar mitzvah" and
   "Celebrating: Sam".
8. **Wedding words on a mitzvah job** now say the job, the family or the
   client:
   - the public form's "Event date" and "Venue", now "Party date" and
     "Party venue" (and the /i/ venue)
   - proposal Change packages: "Engagement shoot… this couple"
   - "the couple signs both at once"
   - the run-of-show "This wedding" eyebrow
   - "Built from the couple's Final Schedule answers" and its DJ and
     beauty siblings
   - "This wedding stays off Today"

Open, not fixed:
- **Sending the details form with a new inquiry only works for weddings**
  ("Send a form with new wedding inquiries", INQUIRY_FORM_EVENT_TYPES).
  The "Mitzvah details" form says "Send it with new bar and bat mitzvah
  inquiries", so that promise is false until the setting is per kind.
- **FlawlessIQ's reply sign-off reads "Conor — GR Productions"** (studio
  data).
- "Workspace access could not be verified" showed once on Inquiry capture
  and cleared on reload.
- The public form's "Which is it?" could be clearer ("Bar or bat
  mitzvah?").
- New types are added below "General question".

**What Phase 4 did** (4360 tests, typecheck, functions build, lint and build pass)
- **The DJ: `mitzvah-music-planner`.** It asks:
  - where and when (the party)
  - the grand entrance and its names
  - the hora songs and the chair lift
  - who says the blessings, and the speeches
  - the candle lighting, with a song for each candle
  - the montage and the games
  - the dance floor and the microphones

  "Lay out the night" uses `planMitzvahNight`: the party in order, with no
  crew arriving, portraits or service. The MC script fills the hora (song
  and chair lift), the blessings, the parents' speech (the toast order,
  never the parent dances), the candles, the montage and the games.
  `djMomentsFor("mitzvah")` gives the party's chips.
- **Makeup and hair.** `mitzvah-makeup-party-list` and
  `mitzvah-hair-party-list`: "Before the party", the family as the party
  list with the family's examples, skin or hair (no veil), and good to
  know. The chair roles needed no change: mom and grandma read as mother,
  and the honoree as party.
- **The planner.**
  - `mitzvah-planner-final-details`: the service and the party, key people
    and the candle lighting, the décor and venue, guests and kids, vendors.
  - A mitzvah starter checklist (synagogue date, kids' entertainment,
    tallit and kippot, hotel block, Friday and Sunday events, montage
    photos, candle-lighting list; no license or officiant).
  - The checklist is read by kind. A studio's saved wedding list never
    reaches a mitzvah; `planningChecklists["mitzvah:full"]` would.
  - **The settings screen can't edit a mitzvah list yet.**
- **The scheduler** prefers a kind's `-final-details` form too. The
  inquiry-form suggestion never offers the new after-booking forms.
- **Guard:** `tests/mitzvah-trades.test.ts`. It found wedding words in the
  reused "Before the party" help ("the dress or the first look", "a
  bridesmaid"), now the family's.

**What Phase 5 did**
- **Schedule B: "Bar and bat mitzvah terms"** (`mitzvahTermsBlocks(trade)`
  in event-details.ts).
  - It's added after Schedule A on a mitzvah job only (`agreementTerms`,
    contracts/sources.ts `kindTerms`). Wedding agreements are unchanged and
    the golden hashes hold.
  - Two terms, in each trade's words:
    - **The house of worship:** the congregation's rules can keep cameras,
      sound or setup out of the service, and that isn't a shortfall.
    - **Children:**
      - photographer: no portfolio or marketing use of the honoree's or
        any child's images without written agreement
      - DJ: music suited to the ages
      - makeup and hair: a parent or guardian present
      - planner: the client supervises; the studio isn't childcare
- The contract step's "Wedding details not given yet… Ask the couple" now
  reads the kind's words.
- **Owed:** counsel's review of Schedule B, with the e-sign review. The
  studio's agreement itself is unchanged: a planner's "Wedding Planning
  Agreement" still shows the warning on a mitzvah job.

**Still open after Phases 4–5:**
- The checklist settings screen for a mitzvah list.
- Vendor types (Decision 5).
- The extras library's "Bridesmaid makeup" and "Veil placement" ideas.
  They're the studio's catalog, not per job.
- The planner's Cue how-to says "the wedding".

**What Phase 3 did**
- **Three photographer forms** with `eventTypeId: "mitzvah"`:
  - **Mitzvah details** (`mitzvah-details`): the family; who it celebrates
    and how to say their name; the synagogue, the service time, its
    photography rules, and the portrait session; the party (location,
    start and end, guests, kids, kids' room); and coverage.
  - **Mitzvah final schedule** (`mitzvah-final-schedule`): the details
    again, plus family names, the candle lighting in order, and "Your
    party, in order" with suggested times.
  - **Mitzvah shot list** (`mitzvah-shot-list`): the wedding list's ids,
    with the candles added.
- **Seeding.** Signup still seeds wedding forms only (`recommendedFor`
  defaults to wedding). A studio gets the mitzvah forms the first time it
  saves an inquiry form offering the kind (crm `setInquiryForm`,
  `OFFERED_KIND_FORMS`), only ones it has never had. The library shows
  them to every photographer.
- **The day plan:** `planMitzvahDay` (features/schedules/mitzvah-plan.ts),
  picked by `planBuiltDay` from `dayPlan: "mitzvah"`.
  - The party start is the anchor. Before it come family portraits. After
    it come cocktails and the kids' room, entrance, hora, blessings,
    speech, dinner, candles, montage, dancing, cake and the last dance.
  - The service is placed only when given, as "Service (no photography)"
    when the synagogue says so. Coverage never starts at the morning
    service.
  - A second team takes the kids' room.
  - The portrait session is noted as its own date.
  - Mitzvah "Add a moment" chips, also in the AI copy.
- **Schedule A:** `scheduleAParts` is now `"wedding" | "mitzvah" | null`.
  - A mitzvah requires the Service, the Party and the Times. Its labels
    and missing list say "Service" and "Party".
  - The synagogue, temple and service words, and the party words, are read
    only for a mitzvah.
- **The crew sheet:** the mitzvah answers reach the crew brief. The
  synagogue's photography rules are first under "Before you shoot".
- **The scheduler:**
  - A kind off the planning timeline gets its own final schedule as the
    planning form, never its shot list (`planningFormTemplate`).
  - Its own shot list (`shotListTemplateFor`), also when the form is sent
    by hand.
  - **This also changes weddings, but only for a studio with no chosen
    planning form:** the fallback no longer picks a shot list, and prefers
    a final schedule.
- **Switches on for mitzvah:** `shotList`, `dayPlan: "mitzvah"`,
  `scheduleAParts: "mitzvah"`. The vendor-team ask and the planning
  timeline stay off.
- **Guard:** `tests/mitzvah-planning.test.ts`.

**What Phase 2 did**
- **Every client surface passes the job to `vocab`.**
  - The portal: `useClientVocab`.
  - Emails: the worker adds `honoreeName` and `mitzvahType` to their values.
  - The month-out and day-before drafts: the scheduler and the Cue draft
    facts.
  - The /i/ page: the preview carries the honoree.
  - The inquiry link line.
  - The AI's first reply: its facts and prompt say to write to the
    parents about their child.
  - So they read "Sam's bar mitzvah", and "For Sam's bar mitzvah" on the
    day-before note.
- **Pulled forward from Phase 4:** `tradeVocab(trade, kind)`, with mitzvah
  overrides.
  - The planner's day is "The celebration", and its day-before list is the
    candle list, tallit and kippot, tips and décor. No license or rings.
  - Makeup and hair kits name no bride.
  - A hair trial has no veil.
  - Emails, the drafts and the portal schedule pass the kind.
  - The guard below found these leaks. The rest of Phase 4's trade content
    (the DJ planner, chair roles, the planner checklist) is still owed.
- **Guard:** `tests/mitzvah-client-copy.test.ts`.
  - It renders every client email of every trade for a bar mitzvah, plus
    the lifecycle drafts, and fails on wedding, couple, bride, ceremony or
    dress.
  - It checks the day-before note and the inquiry link name the honoree.

**What Phase 1 did**
- **`mitzvah` is a job kind**, labelled "Bar & bat mitzvah".
  - Its profile is the wedding's weight: a call, an agreement, a deposit
    and balance, a lock, a run of show, crew, an album and a whole day.
  - The details form goes 90 days before.
  - The wedding-only steps stay off until their mitzvah content exists:
    planning timeline, shot list, vendor-team ask, built day plan,
    partner, and Schedule A's required parts.
  - The `honoree` switch is on.
- **`vocab(kind, job)`** names the honoree: "Sam's bar mitzvah", "The
  b'nai mitzvah", or "your celebration" when the job doesn't know.
  - `mitzvahOf()` reads `mitzvahType` and `honoreeName`, then falls back
    to the type's label.
  - Most callers still pass the kind alone. Phase 2 passes the job.
- **`jobKindFromLabel`** catches mitzvah, b'nai, b'not and bimah before
  the wedding words.
- **The job carries `mitzvahType` and `honoreeName`.**
  - createProject and updateProject accept both.
  - A job made from an inquiry inherits the inquiry's.
  - New job and Edit job show both fields (`HonoreeFields`) when the
    chosen type's kind has an honoree.
- **The public inquiry form** has a "mitzvah" kind, with the wedding's day
  fields.
  - A mitzvah type asks "Who are we celebrating?" and "Which is it?".
  - All three intake checks keep those answers only for a type that asks
    (`asksHonoree`).
  - The default form is unchanged: a studio adds the type itself.
- **Pickers.** Setup's "What do you shoot?" offers mitzvah to every trade;
  beauty studios now see it too.
- **Example packages** for a photographer, DJ, makeup artist, hair stylist
  and planner.
- **Cue** knows the kind:
  - "Mitzvah" is in the read-in's type list.
  - The overview carries the honoree.
  - The prompt says to write to the parents about their child.
  - Prompt size pin: 19906.
  - **A2/A4 plus a mitzvah turn are owed on prod.**
- **Not yet looked at on screen.** The new fields appear only on a mitzvah
  type, which no studio has yet. The Phase 6 walk screenshots them.

**What Phase 0 did**
- **Six profile switches** in `journeyProfile`: `planningTimeline`, `shotList`,
  `vendorTeam`, `dayPlan`, `partner`, `scheduleAParts`. They are on for
  weddings only, pinned in `tests/job-kinds.test.ts`.
- **Every gate reads its switch now**:
  - the details-form date and the form at booking
  - the scheduler's planning form and shot list
  - the shot-list upload and its job card
  - the couple vendor ask
  - the inquiry link's partner and ceremony asks
  - the lead form's partner field
  - Schedule A's required parts and title (`kindDetails`, passed in, since
    event-details has no imports)
  - "Lay out the day" (`dayPlanOf`) and the AI moments instruction
- **The wedding's words moved into `vocab`**, word for word:
  - `formAsks`, `dayBeforeLine`, `dayBeforeLetter` and `prepSentence`
  - `timesChanged` and `finalDetailsHolds`
  - `musicOccasion`, `aboutYours`, `whenQuestion` and `dateAsk`
  - `newClient`, `yourClient`, `Clients` and `othersLikeYou`
  - `typicalDay`, `inquiryDayTitle` and `occasionByName`
- **`BEFORE_KINDS`** names "a record from before kinds reads as a wedding",
  where copy always has.
- `vocab()` and `journeyProfile()` take any value; anything that isn't a
  kind, like an inquiry's "general", reads as "other".
- **DJ moments** come from `djMomentsFor(kind)`. Only the wedding row
  exists.
- **New guard**, `tests/job-kind-branches.test.ts`:
  - It counts `"wedding"` comparisons outside features/job-kinds and pins
    them at 13 files, down from about 47 checks. The pins can only come
    down.
  - What's left is legitimately wedding:
    - the studio's legacy wedding type id: `template-key`,
      `public-lead`, `capture`, `inquiry-form`, `inquiry-form-setting`,
      `onboarding`
    - the wedding's own day plan (`isWeddingJob`)
    - the wedding-agreement warning
    - the setup picker's beauty list
    - the journey film
- The copy guard's pins came down in 7 files.

**Deferred from Phase 0 to the phase that writes their content.** Keying
these by kind changes more than code:
- **Recommended forms are already keyed by kind** through their
  `eventTypeId`. A mitzvah form is a new entry with `eventTypeId:
  "mitzvah"`, so there is nothing to re-key.
- **Planner checklist** (Phase 4): the studio saves its list per tier. A
  per-kind list changes the stored shape and the settings screen.
- **Starter agreements** (Phase 5): the studio has one agreement. A
  per-kind agreement is a new choice for the studio, and it waits on
  counsel.
- **`tradeVocab` day-before, kit and trial lists, and the chair roles**
  (Phase 4): add a `kind` argument when the mitzvah rows exist, so the
  override's shape comes from real content.

---

## How a mitzvah runs (what the defaults are built on)

From synagogue policies, mitzvah DJ planning forms and photographer guides.
**This needs checking with a studio that shoots them. See "Decisions" at the
end.**

**The people**
- **The client is the parents.** They inquire, sign, pay and fill in the
  forms. The honoree is the child, aged 12 or 13.
- Emails go to the parents and name the child: "Sam's bar mitzvah".
- **Bar** is a boy. **Bat** is a girl. **B'nai** is twins or siblings, or a
  mixed group. **B'not** is girls.
- Families usually know the date 1–3 years ahead, because the synagogue
  assigns it. They book vendors 9–18 months out.

**The shape of it: up to three parts, often on different days**

| Part | When | Photo/video rules |
|---|---|---|
| **Portrait session.** Torah, tallit, bimah and family portraits. | At the final rehearsal, or a weekday morning service, 1–3 weeks before. | Usually the **only** time the open Torah can be photographed. |
| **The service.** Torah reading, aliyot and the speech. | Usually Saturday morning (Shabbat). Sometimes Monday or Thursday, or Saturday afternoon (Mincha). | **Often no photography or video at all** on Shabbat, especially in Conservative and Orthodox synagogues. Reform synagogues vary. Some allow a portrait window, for example 9–10 AM. |
| **The party.** | Saturday night after Shabbat ends, or Sunday. | Fully covered. |

**The party, in its usual order.** This is the run-of-show skeleton.
1. Cocktail hour. Often there is a separate kids' room with its own
   entertainment. A second shooter covers it.
2. Grand entrance. Family introductions, then the honoree.
3. **Hora.** The chair lift for the honoree, then the parents, sometimes the
   grandparents. 10–15 minutes.
4. **Blessings.** The motzi over the challah and the kiddush over the wine.
   An honored relative says each one.
5. Parents' speech and toast. Sometimes the honoree speaks too.
6. Dinner.
7. **Candle lighting.** 13 or 14 candles. Each honoree or group is called up
   with a short rhyme or introduction and their own song. The usual order:
   a memory candle, grandparents, aunts and uncles, cousins, family friends,
   the honoree's friends, siblings, parents, then the honoree.
8. **Montage.** A photo slideshow of the honoree growing up.
9. Dancing, with games and motivational dancers. Kids against adults.
   Mixed ages all night.
10. Cake, then the last dance.

**What each trade needs from the family**
- **Photo/video.**
  - The synagogue and its photography rules.
  - The portrait session date.
  - The candle-lighting list, which doubles as the must-get groups.
  - Family names.
  - The kids' room, yes or no.
- **DJ / MC.**
  - Adult and child guest counts.
  - The entrance order and the pronunciation of every name.
  - The hora songs, and who goes up in the chair.
  - Who says each blessing.
  - **The candle-lighting roster in order, with a song and an introduction
    for each.** Due about two weeks before.
  - The montage file, its format and its length.
  - Must-play and do-not-play lists.
  - Microphones: a lavalier for the honoree, handhelds for the toasts.
- **Makeup/hair.**
  - A chair list: the mother, the honoree, siblings, grandmothers.
  - Usually the party afternoon, not the service morning.
  - The trial is optional.
- **Planner.**
  - Synagogue and clergy dates, and the tutor.
  - The mitzvah project.
  - Kippot and tallit.
  - Friday dinner and Sunday brunch.
  - Invitations 6–8 weeks out.
  - The candle list and the montage photos, sent to the DJ.
  - The sign-in board, favors and hotel block.
  - **No** marriage license and **no** officiant.

**Crew day sheet**
- "Service: no photography" in red when that applies.
- Dress code: a kippah in the sanctuary, modest dress.
- The flash and phone rules for the sanctuary.
- Most guests are children.

---

## Data shape

- `eventKind: "mitzvah"`. This is a new `JobKind`, labelled
  **"Bar/Bat Mitzvah"**.
- Two new optional job fields, written at inquiry or conversion and editable
  on the job:
  - `mitzvahType`: `"bar" | "bat" | "bnai" | "bnot" | null`.
  - `honoreeName`: the child's first name. The parents stay the client and
    the contact.
- `vocab(kind, job?)` takes the job, so the event word reads
  "bar mitzvah", "bat mitzvah" or "b'nai mitzvah". When the type is unknown
  it falls back to "mitzvah". `yourEvent` becomes "Sam's bat mitzvah" when
  there is a name.
- The service date and synagogue, and the portrait session date, go in the
  **details form and the run of show** in v1, not in new job dates. The
  **party date is the event date**, because that's when the crew works and
  what `exclusiveDay` should block. (Multi-date jobs are Decision 3.)

**Mitzvah profile.** These are the wedding's values except where noted.

| Switch | Value |
|---|---|
| `consultation` | true |
| `agreement` | true |
| `payment` | `deposit_and_balance` |
| `detailsFormDaysBefore` | **90** (the wedding uses the studio's planning timeline) |
| `finalDetailsLock` | true. The candle list locks at 2 weeks. |
| `runOfShow` | true |
| `crew` | true |
| `coi` | true |
| `billingAddressRequest` | true |
| `album` | true |
| `exclusiveDay` | true |

**Words (`vocab`)**

| Word | Mitzvah |
|---|---|
| `event` | "bar mitzvah" / "bat mitzvah" / "b'nai mitzvah", falling back to "mitzvah" |
| `clientFallback` | "the family" |
| `Day` | "Mitzvah day" |
| `detailsForm` | "Mitzvah details" |
| `schedule` | "Mitzvah run of show" |
| `brief` | "Mitzvah brief" |
| `scheduleA` | "Mitzvah details (Schedule A)" |
| `afterwards` | "After the celebration" |

The day-before checklist:
- the candle-lighting list, final and in order
- the tallit, kippot and anything for the portraits
- the montage file sent to the DJ

---

## Phases

Each phase ships alone and keeps every existing kind byte-for-byte the same.
Order is by authority: features → server → functions → lib → UI.

### Phase 0: stop asking "is it a wedding?" (no behavior change)

This is the real work, and it pays off for every kind after this one.

- Add profile switches to `JourneyProfile`. Each one names what a wedding
  branch actually means:

  | Switch | What it replaces |
  |---|---|
  | `studioPlanningTimeline` | `detailsFormOpensOn`'s wedding branch |
  | `dayPlan: "built" \| "ai"` | `isWeddingJob` in "Lay out the day" and `schedule-moments.ts` |
  | `shotList` | the scheduler, upload and job-page gates |
  | `formAtBooking` | `planning-form-scheduler.ts:269` |
  | `vendorTeam` | `couple-team.ts`, `vendor-team.ts` |
  | `secondClient` | the partner field on lead intake |
  | `requiredScheduleAParts` | `event-details.ts:181` |

- Replace every `=== "wedding"` branch (47 lines) with the switch it means.
- **Copy branches** go to `vocab`:
  - `journey/steps.ts`
  - `messaging/render.ts` and `lifecycle-core.ts`
  - `email-templates.ts`: 5 sites
  - `inquiry-link.ts`
  - `couple-inquiry-page.tsx`
  - `client-reviews.tsx`
- **Hard-coded `eventTypeId: "wedding"`** gets a kind or a studio default:
  - The Gmail capture default and the public lead default: the studio's
    first kind, not `"wedding"`.
  - Imports
  - Workflow starters
  - Timing-rule editor
  - Package form
- **Key trade content by trade and kind.**
  - `RecommendedQuestionnaire` gains `kinds: JobKind[]`.
  - `recommendedFor(trade)` becomes `recommendedFor(trade, kind)`.
  - The same applies to `DJ_MOMENTS`, the chair `PartyRole`s,
    `starterAgreementFor`, the planner checklists and `trades.ts`'s
    `dayBefore`, `kitChecklist` and `trialHint`.
  - Each is a `Partial<Record<JobKind, …>>` with today's content as the
    wedding row and the fallback.
- **Run-of-show PDF:**
  - The title comes from `vocab(kind).schedule`, not from a regex on the
    name.
  - Venue grouping comes from a per-kind venue list (getting ready /
    ceremony / reception becomes the kind's own venues).
- **New guard test:** no `=== "wedding"` (or `"wedding"` literal compares)
  outside `features/job-kinds/`, pinned like the copy guard, so the count
  only comes down.
- **Done when:**
  - All suites pass and the wedding snapshot tests are unchanged.
  - The guard count is at or near zero.

### Phase 1: the mitzvah kind

- **Core** (`job-kinds.ts` and its mirror):
  - `JOB_KINDS` and the label.
  - `vocab(kind, job)`.
  - The profile above.
  - `jobKindFromLabel`: `/mitzvah|b'?nai|b'?not|bimah/`, checked **before**
    the wedding regex, because `/ceremony/` matches wedding first.
  - Update `tests/job-kinds.test.ts:52`, which pins "Bar mitzvah" → `other`.
- **Job fields:**
  - `mitzvahType` and `honoreeName`, added to the project schema, the lead
    schema, `createProject`/`updateProject` and the conversion.
  - Rules tests stay green: they are studio-writable fields with no
    authority.
- **Intake:**
  - Inquiry form kind "Bar/Bat Mitzvah". `dayFieldsForKind` adds: honoree
    name, bar/bat/b'nai, the synagogue, the party venue, the party date, and
    adult and child guest counts.
  - The prefill regex already spots `ba[rt] mitzvah` as an occasion. Promote
    it to the kind.
  - The Cue enums at `copilot.ts:181,2168,1073`.
- **Pickers:**
  - Setup's "What do you shoot?": add it for **every** trade, including DJ
    and beauty, whose lists exclude other kinds today.
  - Settings → Job types, the package form, imports, reports, the projects
    filter, the workflow form and the timing-rule editor. TypeScript catches
    most of these through `Record<JobKind,…>`.
- **Example packages:**
  - Photo: "Mitzvah — service portraits + party" and "Party only".
  - DJ: "Mitzvah party with MC".
  - Makeup/hair: "Mitzvah family glam".
  - Planner: "Mitzvah planning" and "Day-of coordination".
  - No prices, as for every kind.
- **Done when:**
  - A studio can add the kind.
  - An inquiry for "Sam's bar mitzvah" lands as a mitzvah job with the
    fields filled.
  - It books through the full gate.

### Phase 2: the family's side (client portal, `/i/`, emails)

- Every client surface already reads `vocab`/`useClientVocab`. With
  `vocab(kind, job)` they read "Sam's bat mitzvah".
- Sweep for wedding words in client code that Phase 0 missed. Extend
  `tests/job-kind-copy.test.ts` so that a mitzvah job rendering any of
  *couple, bride, groom, ceremony, first dance, wedding* fails.
- Review asks say "other families", not "other couples".
- Album reminders work unchanged.
- **Minors.** Nothing client-facing ever addresses the honoree, and no email
  ever goes to them: the contact is always the parent.

### Phase 3: photo/video planning content

- **Recommended forms** (`kinds: ["mitzvah"]`, photographer):
  - *Mitzvah details*: the family, the honoree and pronunciation, the
    synagogue and its **photography rules** (none / portrait window /
    allowed), the portrait session date and place, the party venue and
    time, and the kids' room.
  - *Final schedule*: the day in order, with suggested times.
  - *Shot list*: family groups, the **candle-lighting list as must-get
    groups**, people to capture and sensitivities. The crew-brief
    allowlist already carries these field ids.
- **Day plan:**
  - `planMitzvahDay` sits beside `planDay`, with the same mechanics: form
    time, then studio rule, then the usual time.
  - The anchor is **the party start**. The portrait session and service
    lines come from the form on their own dates.
  - Milestones:
    - Crew arrive
    - Family portraits
    - Cocktail hour (and kids' room)
    - Grand entrance
    - Hora
    - Blessings
    - Parents' speech
    - Dinner
    - Candle lighting
    - Montage
    - Dancing and games
    - Cake
    - Last dance
  - The second shooter takes the kids' room and the cocktail hour.
- **Standard moments:** add a `mitzvah` row to `KIND_STANDARD_MOMENTS` and
  its AI copy.
- **Schedule A:** the required parts for a mitzvah are the party venue, the
  party start, the synagogue and the honoree.
- **Crew day sheet:**
  - A "Service rules" banner: no photography, or the portrait window only.
  - Dress code.
  - The candle list, as the groups to get.

### Phase 4: the other trades

- **DJ:**
  - A *Mitzvah music & MC planner* with these sections:
    - Grand entrance: the order, the pronunciations, the songs.
    - Hora: the songs, and who goes up in the chair.
    - Blessings: who says each one.
    - **Candle lighting**: a repeating row of honoree, relationship,
      introduction and song.
    - Montage: the file, the length, when it plays.
    - Games and dancers.
    - Must-play and do-not-play.
    - Microphones.
  - It is due 14 days before the event.
  - `DJ_MOMENTS[mitzvah]` and the MC script read the candle rows as one
    announced line each.
  - "Lay out the night" works unchanged.
- **Makeup/hair:**
  - Chair roles become honoree, mother, family and child. They replace
    bride and party.
  - The party list form is retitled.
  - The kit and day-before lists get mitzvah rows, with no bridal wording.
  - The trial is optional, and the veil hint is dropped.
- **Planner:**
  - A *mitzvah* planning checklist: the synagogue date, the tutor, the
    mitzvah project, the invitations, kippot and tallit, the candle list,
    the montage photos to the DJ, the sign-in board, favors, the hotel
    block, and the Friday dinner and Sunday brunch.
  - It drops the license and the officiant.
  - *Final details* adds the rehearsal and portrait session, and the
    service.
  - `trades.ts` stops calling the planner "Wedding planner" everywhere. The
    signup hint becomes "Weddings, mitzvahs and events".
- **Vendor types:** add *Synagogue / clergy*, *Entertainment / dancers* and
  *Montage / video*, if the vendor network should invite them (Decision 5).

### Phase 5: agreements (counsel)

- Each starter agreement gains a mitzvah variant, picked by trade and kind,
  with two clauses weddings don't need:
  1. **House-of-worship rules.** The studio follows the congregation's
     photography and video rules. Moments those rules exclude are not a
     shortfall.
  2. **Minors.** Most subjects are children. Portfolio and marketing use of
     their images needs the parents' **separate opt-in**, off by default.
- The non-wedding warning at `native-contract-step.tsx:217` already fires on
  wedding words. It now also fires the other way round: a wedding agreement
  on a mitzvah job.
- This goes to counsel with the e-sign review, which is still owed. Until
  then, mitzvah jobs use the studio's own agreement plus the warning.

### Phase 6: walk it

- Emulator: `scripts/uat/cycle.sh` with a mitzvah persona per trade.
- **Prod:** walk one mitzvah on FlawlessIQ, inquiry → booked → planning →
  run of show PDF → crew sheet. Use plus-addresses for the parents and the
  crew.
- Screenshot each new screen at desktop and phone.
- Run the layout and contrast guards.
- Deploy functions first, and **run the freshness script.**
  `operationsTaskWorker` renders every email this changes.

---

## Size

| Phase | Size | Risk |
|---|---|---|
| 0: re-key | Largest: ~90 sites, plus trade content keyed by kind | Regressing weddings. The snapshot and guard tests carry it. |
| 1: kind | Medium. TypeScript finds most sites. | The mirror files must match. |
| 2: client copy | Small once 0 is done | |
| 3: photo content | Medium: forms plus `planMitzvahDay` | Domain accuracy |
| 4: other trades | Medium: four content sets | Domain accuracy |
| 5: agreements | Small code; the legal text is the long pole | Counsel |
| 6: walk | 1 day | |

Phases 0–2 can ship before any mitzvah content exists. The kind would then
work with the generic "Event" content. 3 and 4 make it good.

---

## Decisions (Conor, ideally with a studio that shoots mitzvahs)

1. **Who validates the run of show?**
   - Does Gabe shoot mitzvahs?
   - If not, is there a mitzvah DJ or photographer in the vendor network who
     would review the forms? The content above is researched, not lived.
2. **One kind or a family of kinds?** Recommended: `mitzvah` now, built on
   Phase 0's generic switches, so a quinceañera or sweet 16 is a row later.
   Alternative: a single "celebration" kind with variants.
3. **The portrait session and the service as their own dates?**
   - v1 keeps one event date (the party) and puts the others in the form
     and the run of show.
   - Real multi-date jobs (a crew offer for the portrait session, a
     calendar hold) are a bigger change across crew, calendar and
     `exclusiveDay`. Worth it if studios sell them as separate bookings.
4. **The minors' image opt-in.** Should it apply to every kind with
   children (family sessions, sports), not just mitzvahs?
5. **Vendor network.** Invite synagogue-adjacent vendors (montage,
   motivational dancers), or leave the vendor types alone?
