# The journey film, onboarding and the homepage — marketing plan (2026-10-02)

We now have the asset every SaaS homepage wishes it had: a real, 6-minute,
end-to-end film of the product doing the job — one wedding, inquiry to album,
with the couple's and the crew's phones in it. This plan puts it (and the 13
how-to videos) where buyers and new trial studios will see it, and rebuilds a
homepage that has fallen behind the product.

Three workstreams, one story:

| | Who it's for | The job it does |
|---|---|---|
| **A. Onboarding** | A studio on day 1 of a trial | "Here's the year ahead, and you won't have to drive it." Gets them to setup done → first inquiry → paid. |
| **B. Video on the website** | A prospect deciding whether to trial | "Don't read about it — watch a wedding run." |
| **C. Homepage rebuild** | Everyone who lands | Says what StudioCue is *today*, in under 10 seconds, and proves it. |

---

## 0. Where we are (audit, 2026-10-02)

**The homepage is about three weeks behind the product.** Last real rewrite
was 09-10 / 09-12 (`2ab9e70`, `b075a3a`). Since then the product gained the
couple portal rebuild, the mobile crew workspace, native e-sign, autopay,
booking changes, questionnaire prefill, the details lock, delivery → reviews →
album, job kinds beyond weddings, how-to videos, and now the film.

**What's on the homepage today** (`app/page.tsx`): hero "Run every wedding
without the admin eating your week." with a hand-built mock card; a trust
strip; five feature cards; "The Sunday-night test"; Meet Cue; the readiness
engine; an integrations band; pricing; closing CTA.

**What's wrong with it, as a buyer would see it**

1. **It shows a mock, not the product.** The hero card and every "See it in
   StudioCue" / "Explore the live product" link go to `/studio-preview`, a
   static design mock with dead buttons and the *old* navigation (Home /
   Pipeline / Projects). A buyer who clicks the most prominent secondary CTA
   sees a product that no longer exists.
2. **It only shows *your* side.** The two things that most differentiate
   StudioCue from a CRM — the couple's portal and the crew's phone — appear
   nowhere on the homepage.
3. **It stops at "booked".** Nothing after the contract: no run of show, no
   details lock, no wedding week, no gallery, review or album. The film's
   biggest "oh" moments (the quiet months; the wedding week; the job closing
   itself) are invisible.
4. **No proof.** No testimonial, no logo, no video, no screenshots of the
   real app. "Most popular" sits on a plan with no customers yet
   (`config/saas-plans.ts` says so).
5. **Small accuracy debts:** Stripe missing from integrations; `/integrations`
   still says e-sign is "coming soon"; `/pricing` lists SMS as a billed extra
   (SMS doesn't exist); no meta descriptions on `/pricing`, `/integrations`;
   `/for-crew`, `/for-clients`, `/support` missing from the sitemap; every
   page shares one OG image.

**Onboarding today:** Register → verify email → create workspace → Stripe
checkout (card required) → `/studio/setup` (7 questions) → Today. There is
**no welcome or trial email of any kind**, no video anywhere in the path, and
the setup count is stated three ways (setup: 7, Today card: "of 5", the setup
video and journey page: 6). The `setup` how-to video is stale ("six short
questions", and "What do you shoot?" is now first).

---

## 1. Assets to make first (everything else uses these)

All from footage we already have — no new recording except where noted.

| Asset | Length / shape | Source | Where it's used |
|---|---|---|---|
| **The film** | 6:08, 16:9, 8 chapters | done | Journey pages, homepage modal, onboarding, sales |
| **Chapter clips** | 8 × 15–65 s | done | Journey page stages, contextual help in the app |
| **Teaser** | 60–75 s, 16:9, voiced | re-cut of the film + new narration (Brian) | Homepage "Watch", trial checkout page, email, YouTube pre-roll |
| **Hero loop** | 12–18 s, silent, captioned, ≤ 2 MB | cut: Ella's inquiry → Today card → Send → Ella's phone | Homepage hero (autoplays muted) |
| **Feature loops** | 6 × 6–10 s, silent | cuts from chapters (Today card, proposal accept, signing, crew accept, timeline approve, gallery) | Homepage sections, feature pages |
| **Vertical cuts** | 3 × 30 s, 9:16, voiced + captions burned in | phone footage + new narration | Instagram/TikTok/Shorts: "Your couple's side", "Your crew's side", "A wedding year in 30 seconds" |
| **Poster frames / OG images** | 1200×630 per page | stills from the film | Every marketing page's social card |
| **Re-cut `setup` video** | ~60 s | re-record (`make.ts setup`) | Setup page, How-to |

Pipeline notes: the journey pipeline already composes layouts, captions and
the music bed (`scripts/how-to/`). Cutdowns are a `join.ts`-style step with a
shot list, not new recordings. Silent loops need no voice; the teaser and
verticals need ~1,500 characters of new narration (well inside the ElevenLabs
plan).

---

## 2. Workstream A — onboarding: let new studios see the year ahead

The trial is 14 days; a wedding is 12–18 months. The film is how a new studio
*feels* the long tail they're buying before they've booked a single job.
Principle: **show it once, at the moment of most doubt, then point at the
right chapter at the right moment.**

### The moments, in order

| # | Moment | Route | What they see | Why here |
|---|---|---|---|---|
| A1 | **Starting the trial** (card required) | `/studio/subscription` (pre-trial) | The 60 s teaser beside "Start your 14-day trial", plus "Nothing charged for 14 days" | The card wall is the biggest drop-off point; show what's on the other side of it. |
| A2 | **First landing in setup** | `/studio/setup` | A slim banner: "Before you start: watch a wedding run, start to finish (6 min)" → opens the film in a modal. Collapses once watched. Each setup question gets its How-to clip (re-cut `setup`). | They're about to configure something they've never seen run. |
| A3 | **First Today, empty** | `/studio` | Upgrade the existing `JourneyTodayCard`: poster + play inline (modal), "6 minutes · inquiry to album". Stays until watched or the first booking, then disappears. | Today is empty on day 1; the film fills the silence with what's coming. |
| A4 | **Help hub** | `/studio/help` | The film at the top of "Getting started". | Where people go when unsure. |
| A5 | **"What happens next" on every job** | Job page, journey rail | A small "▶ What happens next" link on the job's current phase opens *that phase's chapter* (Booked → ch. 4–5; Planning → ch. 6; Wedding week → ch. 7; After → ch. 8). | The film's real value is months later, when a studio meets "the details lock" for the first time. Contextual, never a nag. |
| A6 | **First booking** | Booking confirmed | A one-time note: "Booked! Here's what happens over the next months" → chapter 5–6. | The moment they cross into the part of the product they haven't seen. |

### The trial email sequence (none exists today — build it)

Studio-facing, plain and short, signed **"the StudioCue team"** (never Conor,
per the feedback-email rule). Each skips itself if its goal is already met.

| Day | Email | Goal / skip if… | Video |
|---|---|---|---|
| 0 | **Welcome** — "Your studio's ready. Here's a wedding, start to finish." | — | Film (poster links to `/studio/help/journey`) |
| 1 | **Finish setup** — "Seven questions, most answered in place" | setup complete | `setup` |
| 2 | **Get your first inquiry in** — form on your site, or forward one | an inquiry has arrived | `inquiry-capture` |
| 5 | **Try Cue** — "Ask it anything about a job" | Cue used | `today` |
| 9 | **Bring in the weddings you've already booked** | an import or 3+ jobs exist | (import guide) |
| 11 | **Trial ends in 3 days** — what's set up, what isn't, nothing charged till day 14 | — | — |
| 14/15 | **You're on Studio** / **Your trial ended** (with a one-click way back) | — | — |

Mechanics: these are product email jobs (`emailJobs`) driven by a daily
scheduler reading trial start + setup/activation state — same pattern as the
billing-address and review schedulers. Include a one-click "fewer emails"
preference. Add each to the email templates studio so wording is editable.

### Fix while we're there

- One setup count everywhere (it's **7**): Today card "of 5", the journey
  page and the `setup` video say otherwise.
- Re-record `setup` (stale narration).

### Measure

Product events (`operations/product-events`): `film_play`, `film_25/50/75/100`,
`chapter_play {n, from: onboarding|job|help}`, plus the existing setup,
first-inquiry, first-booking and paid events. Funnel: **trial started → film
played → setup complete → first inquiry → first booking → paid.**

---

## 3. Workstream B — video on the website

Hosting stays as built: versioned MP4s in the public Storage path, our own
player, captions on, no third-party trackers or consent banner.

| Page | Add | Notes |
|---|---|---|
| **Home** | Hero loop (muted, autoplay, `playsinline`, poster for reduced-motion and slow connections) + **"Watch a wedding, start to finish · 6 min"** opening the film in a modal with sound. New "start to finish" section with chapter thumbnails. "Your couple / your crew" phone clips. | See §4 for the full layout. On phones: poster + play, no autoplay. |
| **`/how-to/wedding-journey`** | Already wired for the film + chapters (switches on at publish). Add `VideoObject` JSON-LD with `hasPart` Clips per chapter. | Earns rich results ("key moments") in Google. |
| **`/how-to`** | The film as the featured video at the top. | |
| **`/for-clients`** | `couple-tour`, `couple-sign` (portrait) + chapter 3/6 phone moments. | This page currently has no visuals of the portal at all. |
| **`/for-crew`** | `crew-offer-accept` + chapter 4/7 phone moments. | |
| **`/wedding-photographers`** | The film, high on the page. | The most relevant page for the film. |
| **`/features`** | One feature loop per section. | |
| **`/studio-preview`** | **Retire it.** Redirect to `/how-to/wedding-journey`. Rename every "Explore the live product" / "Product tour" link to "Watch a wedding, start to finish". | The stale mock is the single most misleading thing on the site. |
| **Sales** | Send the film as pre-call homework; open demos with the teaser. | |

**Off-site distribution** (the film is marketing gold outside the site too):
- **YouTube:** the film (chapters as YouTube chapters) + each how-to video, titled for search ("Wedding photography CRM walkthrough — inquiry to album"), linking back to the trial. YouTube is for discovery only — the site keeps its own player.
- **Instagram / TikTok / Shorts:** the three verticals, then one chapter moment a week.
- **Wedding-photographer communities** (Facebook groups, forums): the film as "here's a full wedding run in our tool", not an ad.

**SEO hygiene, same release:** meta descriptions on `/pricing` and
`/integrations`; sitemap adds `/for-crew`, `/for-clients`, `/support`; a
distinct OG image per page from film stills; canonical URLs on the marketing
pages.

---

## 4. Workstream C — the homepage rebuild

### Positioning

**Stay wedding-led** — it's the beachhead, the real pilot (GR Productions) is
a wedding studio, and the film is a wedding — but stop selling "less admin"
in the abstract and sell **the whole wedding, run for you, with your couple
and crew in it.** The other kinds (portraits, corporate, sports) get a band,
not the headline.

The core claim, in one line: **"Every wedding, inquiry to album — prepared
for you, approved by you."**

What makes it different (say these, show these): (1) Cue *drafts* the next
step and waits for a yes — it never sends money, signatures or permissions on
its own; (2) your **couple** gets a real app; (3) your **crew** gets a real
app; (4) it runs the **whole year**, not just booking.

### Proposed layout (top to bottom)

1. **Hero**
   - Eyebrow: For wedding photographers
   - H1 (options to test): **"Every wedding, inquiry to album — already prepared."** / "Your next wedding, run start to finish." / keep "Run every wedding without the admin eating your week."
   - Sub: "StudioCue drafts every next step — the reply, the proposal, the agreement, the timeline, the crew offer — and waits for your yes. Your couple and your crew each get their own app."
   - CTAs: **Start your free trial** · **▶ Watch a wedding, start to finish (6 min)**
   - Proof chips: 14-day trial · Nothing charged for 14 days · Setup in minutes
   - Media: the **hero loop** (real product), replacing the mock card.
2. **"One wedding, start to finish"** — the six-stop timeline bar from the film (Inquiry · Booked · Planning · Wedding · Gallery · Closed). Each stop: a thumbnail that plays its chapter in the modal, and one line of what StudioCue does there. The signature section; nobody else can show this.
3. **"Three people, one wedding"** — You (desktop Today) · Your couple (portal on a phone) · Your crew (day sheet on a phone). Silent loops.
4. **Meet Cue — it prepares, you approve.** Keep, but swap the illustration for a real Today "Prepared for you" loop, and keep the guardrails list (never records a payment, signature or permission).
5. **Getting paid** — proposal → agreement → retainer → final balance → autopay, via QuickBooks or Stripe; "StudioCue never takes a cut of client payments." *(E-sign wording depends on decision D2.)*
6. **"Booked isn't ready"** — keep the readiness section, with a real clip of the wedding-week chapter.
7. **Not just weddings** — portraits, corporate, sports: one line each, linking to their pages (add a portraits page).
8. **Proof** — a quote and logo from the pilot studio, *only with permission* (D3). Until then, no fake social proof; the film is the proof.
9. **Integrations** — QuickBooks, **Stripe**, Google Calendar, Zoom, Dropbox.
10. **Pricing** — unchanged plans; drop "Most popular" until it's true.
11. **FAQ** (new) — Do my couples need to download anything? Can I bring in weddings I've already booked? What does the AI do on its own? (Nothing that sends money or signatures.) Is my card charged during the trial? Do you take a cut of payments? Can I switch from HoneyBook / Dubsado / Táve / 17hats?
12. **Closing CTA** — "Your next wedding is already being prepared." Trial + Watch.

### Copy principles
- Show, don't claim: every claim has a clip or a real screen next to it.
- Name what the couple and crew see — it's what competitors can't show.
- No invented proof, numbers or customers. The one number we have is real: *"17 emails to Ella and Jordan. StudioCue wrote every one."*
- Keep "AI" second to the outcome; "prepares, you approve" is the brand.

### Test
Ship the rebuild, then A/B the hero headline (2 variants) and hero media
(loop vs. still + play) once there's enough traffic (≈ 1,000 visitors per
arm). Measure visitor → trial start, and film play rate.

---

## 5. Order of work

| Phase | What | Effort |
|---|---|---|
| **1 — this week** | Publish the film + chapters · onboarding A2–A4 (setup banner, Today card with inline play, Help hub) · homepage: "Watch" button opens the film in a modal · retire `/studio-preview` · fix setup counts · re-record `setup` · Stripe on integrations, SMS off pricing, "Most popular" off · meta/sitemap fixes · `VideoObject` on the journey page | ~2 days |
| **2 — next** | Cut the teaser, hero loop, feature loops and verticals · homepage rebuild (§4) · video on `/for-clients`, `/for-crew`, `/wedding-photographers`, `/features` · per-page OG images · A1 (teaser on trial checkout) | ~4–5 days |
| **3 — then** | Trial email sequence · A5–A6 contextual chapters on the job page · analytics + funnel · YouTube + social distribution · testimonial section once permitted · A/B tests | ~1 week + ongoing |

---

## 6. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| D1 | Publish the film and its chapter clips now | **Yes** — needed by everything else |
| D2 | How to talk about e-sign: native signing is still per-studio pending counsel review | Finish the counsel review, switch it on for everyone, then say "Agreements signed online, in StudioCue". Until then: "Send agreements to sign online" without naming the vendor. |
| D3 | Ask GR Productions (Gabe) for a quote and logo use | **Yes** — the one real proof point we can have |
| D4 | Website analytics | A cookieless tool (no consent banner) so we can measure the funnel at all |
| D5 | Wedding-led homepage with a "not just weddings" band | **Yes** (vs. a kind-neutral homepage) |
| D6 | Trial emails from "the StudioCue team", with a "fewer emails" option | **Yes** |
