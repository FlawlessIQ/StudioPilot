# Five new job kinds — execution plan (2026-10-15)

Quinceañera, Sweet 16, First Communion / Confirmation / Baptism, Prom, and
Vow renewal / anniversary, each run through every trade the way weddings and
bar & bat mitzvahs do.

Every phase follows `docs/adding-a-job-kind-playbook.md` (steps 0–11 and its
eleven traps). This plan says what is **different** about each kind, the
order, and what each phase must prove before the next starts.

---

## Order, and why

| Phase | Kind | Builds on | Trades | Size |
|---|---|---|---|---|
| 0 | Groundwork: generic honoree, variants and kind registries | the mitzvah build | — | M |
| 1 | Quinceañera | mitzvah (honoree, service + party) | all five | L |
| 2 | Sweet 16 | quinceañera, minus the Mass | all five | S |
| 3 | Communion / Confirmation / Baptism | portraits + church rules + group events | photographer first, hair, light DJ | M |
| 4 | Prom | group events + beauty party lists | makeup, hair, photographer, DJ (school-booked) | M–L |
| 5 | Vow renewal / anniversary | wedding | all five | S |
| 6 | Finish: help, Cue scenarios, marketing, playbook | all of the above | — | S |

- **Quinceañera first.** It's the biggest market of the five, it uses every
  trade, and its shape is the mitzvah's. Sweet 16 then reuses most of it.
- **Prom has a deadline.** Prom season is April–May, and beauty studios take
  prom bookings from February. Phase 4 must be live by **end of January
  2027**.
- **Vow renewal is small** (a wedding with a different name). It can run
  alongside any phase as a warm-up for a new session learning the playbook.

**Sizes:** S ≈ ½ day, M ≈ 1 day, L ≈ 1½–2 days of build. Each includes
tests, an emulator walk and a prod walk; content review by a real studio is
extra and owed by Conor.

---

## Decisions owed before each phase (Conor)

Answer these into the phase's section below before the build starts. They
are the playbook's step 0, specific to each kind.

**For all five**
1. **Who checks the content?** Each kind needs one real studio that does
   them to look over the run of show, forms and checklist. Name them per
   kind.
2. **Counsel.** Phases 1–4 add contract terms (church rules, minors). Ship
   before review, as with the mitzvah, or wait?
3. **Language.** Product copy stays US English (`tests/us-english-copy.test.ts`).
   Quinceañera words (quinceañera, damas, chambelanes, padrinos, la última
   muñeca) are used as the families use them, not translated. Spanish
   client-facing copy is **out of scope** unless you decide otherwise.

**Answered 2026-10-15 (Conor), for the quinceañera:** ship the contract terms
before counsel's review, with a counsel pack; US English only, with the
families' own quince words; the portrait session is out of scope (a studio
books it as its own Family & portraits job); a choreographer is a new vendor
type. Who checks the content: still to name.

**Quinceañera:** is the separate portrait session (often weeks before, at a
park or studio) its own date on the job, or out of scope? (Same open
question as the mitzvah's decision 3.) A choreographer for the court's
dances: new vendor type, or "entertainment"?

**Sweet 16:** one kind for any 16th birthday, or a variant of a wider
"milestone birthday"?

**Sacraments:** does a photographer's communion booking have an agreement
(portraits don't) or is it paid in full with no agreement? Is a whole
class's First Communion offered as a group event (each family pays)?

**Prom:** two shapes. Which ship first?
- **A family books getting ready**: one student (or a group of friends) for
  hair, makeup and pre-prom photos. A beauty studio's main prom business.
- **The school books**: a DJ or photographer for the dance itself. The
  client is the school, so it's corporate-like and has no honoree.

**Vow renewal:** does an anniversary party with no ceremony belong here
(a variant), or under "Other event"?

---

## Phase 0 — Groundwork (no behavior change)

The mitzvah's honoree code is mitzvah-only (26 files read `mitzvahOf` or
`mitzvahType`). Make it generic once, so phases 1–4 are rows in tables.

1. **Generic honoree.** `features/job-kinds/job-kinds.ts` (+ mirror):
   - `honoreeOf(job)` → `{ name, variant }` for any kind with
     `profile.honoree`; `mitzvahOf` stays as a wrapper so stored jobs read
     the same.
   - `KIND_VARIANTS[kind]`: a list of `{ id, label }`. The mitzvah's is
     bar/bat/b'nai/b'not, stored as `mitzvahType` (kept for old jobs). New
     kinds store `occasionVariant`.
   - `vocab(kind, job)` personalises from `honoreeOf`: "Sofia's quinceañera",
     "Lily's first communion".
   - A generic `variantFromLabel(kind, label)` with the "names two variants
     → null" rule (trap 3).
2. **Inquiry + job.** `HONOREE_KINDS` becomes `journeyProfile(kind).honoree`;
   `components/job-kinds/honoree-fields.tsx` shows the kind's own variants
   (or none); `intake/convert.ts` `jobName` uses `honoreeOf` for every
   honoree kind.
3. **Registries instead of unions.** `dayPlan`, `scheduleAParts` and
   `agreementTerms` become keys into tables (`DAY_PLANS`, `SCHEDULE_A_PARTS`,
   `KIND_TERMS`), so a new kind adds an entry, not a union member plus a
   branch.
4. **One list, not four.** `OFFERED_KIND_FORMS`, `INQUIRY_FORM_KINDS` and
   `CHECKLIST_KINDS` are derived from the recommended forms and checklists
   that exist for a kind. A test fails if a kind has forms but isn't offered.
5. **A walk for any kind.** `scripts/uat/mitzvah-walk.mts` becomes
   `scripts/uat/kind-walk.mts --kind <id>`, with the per-kind answers and
   assertions in a fixture file.
6. **Guard.** A test checks every kind in `JOB_KINDS` has a vocab entry, a
   profile, example packages for every trade, and (if `honoree`) variants or
   an explicit "none". Copy-guard and branch-guard pins must not go up.

**Done when:** all tests pass with no copy change; the mitzvah emulator walk
runs through `kind-walk.mts --kind mitzvah` with the same 141 checks; prod
shows no difference.

---

## Phase 1 — Quinceañera

**Kind:** `quince`, label "Quinceañera". `jobKindFromLabel`: `quince|quinceañera|xv años|quince años`.
Honoree: the girl (or "quinceañero" — a variant if Conor wants it). Client:
the parents, often with padrinos (sponsors) paying for parts.

**Profile:** copy the mitzvah's: consultation, agreement,
deposit_and_balance, details form 90 days before, final-details lock, run of
show, crew, COI, album, exclusive day, shot list, own day plan, Schedule A
parts, honoree, Schedule B. `vendorTeam: true` (quinces book many vendors).

**Content by trade**
- **Photographer:** details form (Mass time and church, court size, padrinos,
  traditions they're doing); final schedule; shot list (the court, padrinos,
  the dress and tiara, the traditions); day plan: getting ready → Mass →
  portraits → reception with grand entrance of the court, the father–daughter
  waltz, the changing of the shoes, the last doll, the crowning, the toast
  (brindis), the surprise dance, cake.
- **DJ:** music planner (court entrance names, the waltz, the surprise dance
  mix, the father–daughter song, the toast order); night plan and MC script
  rules for each tradition.
- **Makeup / hair:** party list (the quinceañera, the damas, mom,
  grandmothers); the quinceañera sits in the bride's seat (party-list role
  words: "quinceañera", "the quince", "birthday girl").
- **Planner:** final details + checklist (Mass booked with the parish, dress
  fittings, court rehearsals, choreographer, padrinos' list, tiara, shoes,
  last doll, favors).

**Agreement:** Schedule A parts "Mass" and "Reception". Schedule B: the
church's rules (reuse the mitzvah's house-of-worship clause, worded for a
parish) and minors (the court is mostly minors). Counsel pack.

**Vendor types:** choreographer (decision above).

**Built 2026-10-15.** Kind `quince` (no variants; the honoree is named),
forms for every trade, `planQuinceDay`/`planQuinceNight` (the court's waltz
its own line), MC-script songs per tradition, the quinceañera in the bride's
chair, a planner checklist, Schedule A "Mass"/"Reception", Schedule B
(`quinceTermsBlocks`; counsel pack `docs/quince-schedule-b-counsel-review.md`),
a Choreographer vendor type. Emulator walk: quince 156/156, mitzvah 154/154.
The walk found, and this phase fixed, Schedule A filing the job's venue under
"Mass" (the mitzvah's under "Service" too), the court's waltz song never used,
and the form request naming the job twice. Kept: the honoree sits in the middle
chair, not last (chair-plan.ts, so a late morning never rushes her).

**Done when:** `kind-walk.mts --kind quince` green for all five trades; prod
walk per trade (DJ, makeup, hair, FlawlessIQ photographer; planner via
emulator); family side signed on a phone; counsel pack written.

---

## Phase 2 — Sweet 16

**Kind:** `sweet16`, label "Sweet 16". Honoree, no variants. Client: the
parents.

**Profile:** the quince's without the service: no Mass, Schedule A part
"Party" only, `vendorTeam: true`.

**Content:** reuse the quince's party plan and the mitzvah's candle lighting
(16 candles is a sweet-16 tradition); grand entrance; optional
father–daughter dance; DJ: candle-lighting list, entrance, games; beauty:
the birthday girl + friends; planner checklist without church items;
photographer shot list (candles, friends, family, the cake).

**Agreement:** Schedule B: minors only (no house of worship).

**Done when:** as Phase 1, with only the differences walked on prod (DJ and
one beauty trade).

---

## Phase 3 — Communion, Confirmation & Baptism

**Kind:** `sacrament`, label "Communion, confirmation & baptism". Variants:
first communion, confirmation, baptism (christening). Honoree: the child (a
baby for baptism).

**Profile:** like Family & portraits, plus church rules: no consultation,
agreement per decision, `paid_in_full`, details form 14 days before, no
final-details lock, small crew, no album by default, not an exclusive day
(several in a weekend), Schedule B church rules.

**Content:** photographer-led. Details form (church, time, the priest's photo
rules, godparents, the party after); shot list (the child, godparents,
family, the certificate, the cake); a short day plan (church → portraits →
party). Hair: a communion girl's hair (light party list). DJ: party only,
light.

**Group mode:** a whole class's First Communion as a group event: add
`BY_KIND.sacrament` to `features/group-events/words.ts` (child / parent),
mini-session times for portraits after the Mass, a QuickBooks invoice per
family (already built for group events).

**Done when:** emulator walk for photographer and hair; prod walk on
FlawlessIQ as a single family and as a class group event.

---

## Phase 4 — Prom (live by end of January 2027)

**Kind:** `prom`, label "Prom". Two shapes (decision above):
- **Getting ready (family books):** honoree = the student; client = a
  parent. Profile: no consultation, light agreement (deposit) or none per
  decision, details form 14 days before, beauty-led. Party list with the
  student and friends; a group of friends uses group-event mode (each family
  pays for its own chair). Pre-prom photos at home or a park.
- **The dance (school books):** no honoree; client = the school (corporate
  words). DJ and photographer only. Agreement with the school, COI likely.

**Content:** beauty party list and chair plan (many young clients, one
start time), prep guide for teens, minors clause (a parent present, products
suited to age, already in the mitzvah's beauty Schedule B), photographer
shot list for pre-prom groups; DJ dance plan (school rules: clean edits,
end time).

**Done when:** emulator walk for makeup, hair and photographer (getting
ready) and DJ (school); prod walk on Glow by Ana and Jess Styles with a
friends-group booking.

---

## Phase 5 — Vow renewal / anniversary

**Kind:** `vow_renewal`, label "Vow renewal & anniversary". Variants: vow
renewal (a ceremony), anniversary party (no ceremony) — per decision.
`partner: true`; no honoree (it's the couple).

**Profile:** the wedding's, with its own details-form timing (90 days), no
marriage license or officiant paperwork in the planner checklist, Schedule A
wedding parts (ceremony only for the vow-renewal variant). Copy: "your vow
renewal", "your anniversary celebration"; the couple is right here.

**Done when:** emulator walk for all trades; prod walk on one trade.

---

## Phase 6 — Finish

- **How-to and help:** guides, glossary and hints name the new kinds
  (`features/help/explainers.ts`); re-cut any how-to video that lists job
  types.
- **Cue:** a scenario per kind in `docs/cue-scenarios.md` (reply to an
  inquiry, "what's outstanding on Sofia's quinceañera"), run on prod.
- **Setup and marketing:** setup offers the kinds by trade; example packages
  per kind; a marketing page per kind if SEO wants it.
- **Playbook:** add every new trap these phases found.
- **Memory:** one note per kind, linked from the mitzvah note.

---

## Each phase, the same rhythm

1. Decisions answered (above) → the phase section updated.
2. Build in playbook order (steps 1–8); `npm run typecheck && npm test &&
   npm run lint`, `cd functions && npm run build`.
3. `scripts/uat/kind-walk.mts --kind <id>` green for every trade.
4. Deploy all functions → invokers → freshness → bundle spot-check → push →
   rollout on the commit.
5. Prod walk per trade (playbook step 10), family side on a phone by Conor.
6. Fix what the walk finds; ship again; update the playbook's traps.

## Not in this plan

- Multi-day South Asian weddings (several events under one booking) — a
  separate project.
- Milestone birthdays, graduation and retirement parties — "Other event"
  covers them until studios ask.
- Spanish client-facing copy (decision 3).
