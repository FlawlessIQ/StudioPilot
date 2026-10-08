# Execution plan: DJ, makeup and hair journeys

Conor, 2026-10-08:
- Hair and makeup are **separate journeys**, though very similar.
- These trades are **$75/month** full price; discounts come later.
- **No overtime yet** (backlog).

The brainstorm and research behind this plan is in `docs/vendor-journeys.md`.

## Status

- **Phase 0 and Phase 1 shipped 2026-10-08.** Trades live in `features/trades/trades.ts`. `LIVE_TRADES` is still photographer only, so nobody can sign up as a DJ, makeup artist or hair stylist except through a `?trade=` link. Stripe has the Pro product (`prod_VPAbQ7qidGVYdW`, $75/mo, $750/yr).
- **Walked in the emulator.** A DJ studio signed up through the real onboarding function and started on Pro, with only the event details form and no gallery or day-before email. Its job reads Played → Afterwards → Review. The server allowed the move from the day to the review for DJ and makeup studios and refused it for a photographer.
- **Phase 2 found this for the backlog:** setup ("2 of 7 answered") still asks photographer questions. Check each setup step per trade.

## Principles

- **One engine, labelled per trade.** Steps, records and commands are shared;
  a trade changes words, which steps apply, defaults and starter content.
  Never fork a component per trade. This is the same rule job kinds follow
  (`features/job-kinds/job-kinds.ts`).
- **Trade is per studio, kind is per job.** A DJ studio can still play a
  corporate party: trade × kind.
- **Photography must not move.** Every phase ends with the photographer suite
  green and a photographer job looking exactly as it did before.
- **Makeup and hair share a "beauty" core** (per-person quote, trial, party
  list, chair schedule) but are separate trades, with their own words, forms,
  packages and landing pages.
- **Every phase is walked on prod** on a test tenant before it's called done
  ([[walk-it-on-prod-or-it-is-not-done]]), with screens checked at desktop and
  phone width.

## Phase 0: guardrails (½ day)

- **0.1 Pause vendor invites for trades that aren't live.** Add `LIVE_TRADES`
  to `referral-program.ts`. `vendorInviteScheduler` invites a vendor only when
  the trade its `type` maps to is live. Photographers and videographers are
  live today. The daily sweep looks back three days, so Phase 6 runs a
  one-off sweep of vendors on upcoming booked jobs when a trade launches.
- **0.2 Backlog entries:** DJ overtime billing; vendor-plan discounts and
  referral offers; the referral button on Today; referrals between trades;
  linking timelines across vendors; one studio offering both hair and makeup.

## Phase 1: trade foundation (≈ 5–7 days)

The plumbing every trade needs. Nothing a user sees changes for photographers.

| # | Task | Where |
|---|---|---|
| 1.1 | `features/trades/trades.ts` with `TRADES = photographer \| dj \| makeup \| hair` and `TRADE_FAMILY` (makeup and hair → `beauty`). **`tradeVocab(trade)`** covers: provider, service, crew noun, details form, plan of the day, day-before checklist, done verb ("shot", "played", "done"), status labels. **`tradeProfile(trade)`** covers: `delivery`, `album`, `shotList`, `postProduction`, `trial`, `perPersonPricing`, `chairSchedule`, `musicPlanner`, `finalCallDaysBefore`, `balanceOnDay`, coverage roles. Functions mirror with a drift test, like job-kinds. | new `features/trades/`, `functions/src/trades/`, `tests/trades.test.ts` |
| 1.2 | `tenants.trade`; a missing value means photographer, so no backfill. Exposed on the workspace context, plus a server helper `tenantTrade(db, tenantId)`. | `features/tenants/schema.ts`, `features/auth/workspace-context.tsx`, `functions/src/trades/tenant-trade.ts` |
| 1.3 | Merge the two axes: `projectProfile(project, trade)` = kind profile narrowed by trade profile. Pass trade through every caller (journey, Today, booking gate, schedulers). | `job-kinds.ts:398-411` (+ mirror), `use-project-journey.ts`, `use-today-inbox.ts`, gate/scheduler callers |
| 1.4 | Journey: `shapeForProfile()` drops `delivery` and `album_review` (or retitles it "Review") when `delivery` is false. Titles at steps.ts :944/:1166/:1173/:1205 come from `tradeVocab`. | `features/journey/steps.ts`, `phases.ts` |
| 1.5 | No-delivery path: EVENT_COMPLETE → REVIEW_REQUESTED, allowed only when the trade has no delivery. Status labels per trade ("Shot"/"Editing" stay photo-only). | `state-machine.ts:32-37,120`, `state-label.ts:22-23`, functions mirror |
| 1.6 | Emails per trade: crew offer subject (:746), day-before (:1582), thank-you and event reminder copy from `tradeVocab`. Delivery, album and gallery-expiry schedulers skip no-delivery studios. | `functions/src/communications/email-templates.ts`, `post-event/jobs.ts`, `lifecycle-core.ts` |
| 1.7 | Copy guard: a photo-word regex (photo/photographer/gallery/shoot/album) with its own ratchet allowlist, next to the wedding-word one. | `tests/job-kind-copy.test.ts` (+ allowlist) |
| 1.8 | Signup asks "What do you do?" (Photography · DJ · Makeup · Hair), prefilled from `?trade=`. Onboarding stores the trade and seeds starter content **by trade**: recommended forms, standard moments, workflow templates, example packages, Schedule A categories, inquiry form fields. Photography's seed is unchanged. | `features/auth/onboarding-form.tsx`, `functions/src/saas/onboarding.ts`, `functions/src/planning/starter-questionnaires.ts`, `features/job-kinds/example-packages.ts`, `features/schedules/standard-moments.ts`, `functions/src/workflow/starter-templates.ts`, `features/contracts/event-details.ts` |
| 1.9 | **Plans:** a `vendor` plan at **$75/mo, $750/yr** (two months free, like Studio), on a new Stripe product. Env `STRIPE_PRICE_VENDOR_{MONTHLY,YEARLY}`. Wire `priceFor`, `planForPrice` and `entitlements`. Subscription page shows only the trade's plans; `billingCommand` refuses a plan the trade can't buy. Update the Console MRR model. | `config/saas-plans.ts`, `functions/src/saas/stripe.ts`, `functions/src/console/stripe-admin.ts`, `components/saas/live-subscription.tsx`, `features/console/model.ts` |
| 1.10 | Console: a trade column and filter on Studios; Sources by trade. | `components/console/pages/studios-page.tsx`, `features/console/sources.ts` |

**Done when:**
- The photographer suite is unchanged and green.
- A DJ, a makeup and a hair tenant made in the emulator each show their own
  words, have no delivery step, and see the $75 plan.

## Phase 2: DJ journey (≈ 4–5 days)

| # | Task |
|---|---|
| 2.1 | Vocabulary: Vibe call · Music & moments planner · Run of show & MC script · DJ assigned · Load-in checklist · "We played it" · Review. |
| 2.2 | Recommended form **Music & moments planner**, in both copies of `recommended-templates.ts`. Sections: key songs (version + link), ceremony music, entrances with **phonetic names**, toast order, cake/bouquet/garter, last dance, do-not-play, genres 1–5, requests and explicit lyrics allowed. Sent at booking, due 30 days out, locked 10 days out (DJ planning-timeline defaults). |
| 2.3 | **MC script fields** on run-of-show items: song, announcement, pronunciation. Prefilled from the planner through the fact map; shown in the PDF. Covers the schedule schema, timeline editor, PDF and questionnaire fact map. |
| 2.4 | Final call 7 days out by default. |
| 2.5 | Crew: coverage role `dj` and crew specialty `dj`. Track labels D1/D2 instead of P/V (`crew-labels.ts`, `staffing-plan.ts`). |
| 2.6 | Example packages: Reception (5h), Ceremony + Reception, Full day. Add-ons: ceremony sound, cocktail hour, uplighting, monogram, photo booth, extra hour. |
| 2.7 | Schedule A for DJs: venue, load-in time, power, sound limit, vendor meal. |
| 2.8 | Load-in checklist content: day-before checklist and Cue prompts. |
| 2.9 | Inquiry form defaults: hours, ceremony yes/no, guest count, venue. |
| 2.10 | Cue: system prompt and drafts use `tradeVocab` (no "photos"). Add eval cases. |
| 2.11 | Help guides and glossary entries for DJ terms. |

**Done when:** a DJ wedding is walked on prod from inquiry to review: the
reply, a package with add-ons, signing, the retainer, the planner filled in,
the MC script approved, the final call, a DJ assigned, the final balance, the
day, and the review.

## Phase 3: beauty core, shared by makeup and hair (≈ 6–8 days)

| # | Task |
|---|---|
| 3.1 | **Per-person pricing.** Add-ons get `unitLabel` ("per person"). Packages get a minimum (people or dollars). The quote and proposal show people × price, with the minimum stated. Inquiry headcount by role (bride, bridesmaids, mothers, flower girls) prefills quantities for Cue's first quote. (`features/packages/schema.ts`, `features/pricing/package-price.ts` + mirror, proposal and contract pricing tables) |
| 3.2 | **Trial.** A booking with `purpose: "trial"` on the consultation link, as the final details call does. It's an optional step in the book phase that can come **before or after** the agreement. A trial fee is charged, or credited against the retainer. Trial notes and photos (look + products) are kept on the job and copied to the day's brief. |
| 3.3 | **Party list.** A recommended form built on the existing `repeating_group` field: name, role, services, notes. Headcount is derived from it. The lock is ~30 days out and **add only** after it; an addition goes through the existing booking change (amendment) flow. |
| 3.4 | **Chair schedule generator.** Inputs: ready-by time, earliest access, minutes per service (studio settings, with defaults: bride 75, others 40), number of artists. Output: slots per artist (A1/A2 tracks), **bride in the middle**, a warning when the window doesn't fit, and "N artists needed", which feeds the crew requirement. It writes into the run of show and reuses its editor and PDF. |
| 3.5 | Payment: a "balance due on the day" payment shape; an optional gratuity line. |
| 3.6 | A **prep guide** email (an event-reminder variant per trade), editable in the email editor. |

**Done when:** unit tests cover the schedule maths (fits, doesn't fit, artists
needed, bride in the middle) and per-person pricing, and a beauty job runs
end to end in the emulator.

## Phase 4: makeup journey (≈ 2–3 days)

- Vocabulary: Quote · Trial · Party list · Getting-ready schedule · Artists confirmed · Kit checklist · "All done" · Review.
- Party-list fields: skin type, skin notes and **allergies**, lashes yes/no, inspiration.
- Example packages: bride makeup, bridal party makeup (per person), mother of the bride, flower girl. Add-ons: lashes, airbrush, touch-up stay (per hour), travel, early start, extra artist.
- Schedule A clauses: minimum, headcount add-only after the lock, workspace (table, light, outlets), late and early-start fees, bride liable for no-shows.
- Kit checklist content and help guides.

**Done when:** a makeup wedding is walked on prod.

## Phase 5: hair journey (≈ 3 days)

- Vocabulary as makeup, plus veil and extensions.
- Party-list fields: hair length and texture, style, **extensions** (own, buy, rent, recommend), accessories, veil.
- **Extensions:** a Today task to order them 6–8 weeks out, a colour match logged at the trial, and a reminder to return rentals 3–5 days after.
- Prep guide: clean, 100% dry hair; button-up shirt; a blow-dry fee if not.
- Trial hint: book it once the veil is chosen.
- Example packages: bride hair, party hair (per person), flower girl. Add-ons: veil placement, clip-in install, extension rental, touch-up stay, travel, early start.

**Done when:** a hair wedding is walked on prod.

## Phase 6: launch (≈ 3–4 days)

- Landing pages `/dj`, `/makeup` and `/hair`, with sign-up links carrying `?trade=`. Pricing page shows $75.
- How-to guides per trade, and Cue's help.
- **Vendor invites back on per trade** (`LIVE_TRADES`), with invite copy that names the vendor's own trade, plus a one-off sweep of vendors on upcoming booked jobs for the newly live trade. Referrals resume after that (backlog).
- **Pilot:** one real DJ, one makeup artist and one hair stylist, ideally from Gabe's network, walk their own next wedding.
- Monitoring: in Console → Studios, filter by trade to watch activation.

## Deploy and verification, every phase

- `npm run typecheck && npm test && npm run lint && npm run build`
- `cd functions && npm run build`
- Functions first (all of them when shared templates change). Then
  `verify-deployed-function-freshness.sh`, the invoker script (and add any new
  scheduler to it), rules and indexes if they changed, then push and an
  explicit App Hosting rollout checked against the commit.
- Stripe: create the vendor product and prices **in test mode first**, then
  live, and set both env vars before Phase 1.9 deploys.

## Risks

- **Photographer regressions** from touching shared steps and emails. Mitigated
  by trade defaulting to photographer and by the copy guards and regression
  tests.
- **Copy debt.** About 1,900 lines mention photo words. The ratchet guard
  stops it growing; only screens a vendor sees are swept.
- **Beauty scheduling edge cases:** two locations, hair and makeup in parallel,
  late additions. v1 handles one location and one specialty per studio.
- **One studio doing both hair and makeup.** v1 makes them choose one trade.
  Allowing several trades per studio is on the backlog.

## Open decisions

1. **What the $75 plan includes.** Proposal: 2 internal users, 10 crew, 1,000 AI actions a month.
2. **Yearly price.** $750 (two months free, like Studio)?
3. **Trial before or after the agreement.** The plan supports both, with the fee credited against the retainer.
4. **Pilot users** for each trade.

## Backlog

- DJ overtime billing.
- Vendor-plan discounts and referral offers.
- The referral button on Today.
- Referrals between trades (photographer ↔ DJ ↔ makeup ↔ hair).
- The photographer's timeline setting the ready-by time for beauty studios.
- One studio offering several trades.
- Exporting a DJ's playlist (Spotify, Serato).
