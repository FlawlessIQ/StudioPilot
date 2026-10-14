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
