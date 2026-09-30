# How-to help: videos, explainers and hints — plan (2026-09-30)

StudioCue explains itself at three depths, from lightest to heaviest:

| Layer | What it is | Where it appears | How many |
|---|---|---|---|
| **Hints** | A ⓘ beside a word or field. Hover or tap it for one or two sentences. | Inline, on every screen | ~45 glossary terms, ~120 placements |
| **Explainers** | A short text guide per screen: what it's for, the steps, and what happens next | **How to** button popup · `/studio/help` · public `/how-to` | ~35, one per task |
| **Videos** | 1–2 minute narrated demos of the golden path | On top of the explainer, in the same popup and pages | **13** (wave 1 only) |

Every screen has a **How to** button. The popup behind it always has an
explainer. Where one of the 13 videos exists, the video sits on top. So
text is the baseline, and the videos are the showcase for the steps that
matter most.

Videos are made by Claude and the ElevenLabs API, working from scripts
kept in this repo. They are recorded against the seeded emulator, never
production, and Conor approves each one before it goes live.

Revision, 2026-09-30: the first draft planned 40 videos. Conor cut that to
wave 1 only, plus text explainers and a full set of hover hints.

---

## 1. What exists today

| Need | What's there | Consequence |
|---|---|---|
| Hover help | `InfoHint` (`components/ui/info-hint.tsx`), styled in `app/help.css`. It reveals on CSS `:hover`/`:focus-within`. **Only 2 uses** (booking workspace, readiness checkpoints). | Keep the name and API but rebuild the inside (§4a). Today it **doesn't open on an iPhone tap**, because iOS doesn't focus a tapped button. It is also **clipped** by any `overflow: hidden` panel or sheet. |
| Icon-only buttons | `IconButtonTitles` already titles every `aria-label`-only control. | Covered already. Hints don't duplicate it. |
| Popup | `SheetDialog` (`components/ui/sheet-dialog.tsx`). The portals nest `KitRoot` inside it. | The How-to popup reuses it. |
| One place on every studio screen | `header.ds-topbar` in `components/layout/app-shell.tsx`. **There is no shared page header**: ~30 pages write their own. | The studio button goes in the top bar, once. |
| Couple/crew top bar | `AppBar` in `components/kit/kit.tsx:82` has an `action` slot. The client fills it with the account icon; crew leaves it empty. | The portal button goes in that slot. |
| Help hub | `/studio/help` has `HelpCenter`, the setup checklist, four concepts and the example tour. | Add a Guides section. |
| Marketing shell | `MarketingLayout`. `app/page.tsx` has its **own copy** of the nav and footer. `app/sitemap.ts` is hard-coded. | A nav link has to go in both places, plus the sitemap. |
| Storage / service worker / CSP | Storage rules reject video. `sw.js` intercepts same-origin GETs. There is no CSP. | Host video cross-origin in a new read-only Storage path (§6). |
| Demo data | `scripts/seed.ts` ("Alder & Muse") + `scripts/demo-workspace.ts` + `scripts/uat/` running real functions in the emulator. | This is the recording set. All names are fictional, so everything can be public. |

---

## 2. The content

### 2a. Explainers — one per task

Every explainer follows the same shape:

- **What this is for:** one or two lines.
- **Steps:** numbered. Every UI label is written **exactly as the screen
  spells it**, in bold. A test checks these (§5).
- **What happens next:** what the couple or crew sees, and what StudioCue
  does on its own.
- **Good to know:** at most 3 bullets. Gotchas, limits, related tasks.
- **Terms:** chips linking to glossary entries.

**Length:** 120–250 words. If it needs more, it's two tasks.

| Stage | Explainers (✦ = has a video) |
|---|---|
| Getting started | `tour` ✦ A tour of StudioCue · `setup` ✦ Set up your studio · `import-bookings` Bring in weddings you've already booked · `packages` Packages, add-ons and your price list · `agreement` Upload your contract · `inquiry-capture` ✦ Put your inquiry form on your website · `integrations` Connect your tools · `team` Invite your team |
| Every day | `today` ✦ Work from Today · `cue` Ask Cue, then approve · `messages` Message a couple |
| Inquiry → booking | `inquiry` ✦ Answer a new inquiry · `consultation` Book a consultation · `proposal` ✦ Build and send a proposal · `contract-retainer` ✦ Get it signed and the retainer paid · `job-page` ✦ Follow one wedding start to finish · `booking-change` Change a signed booking |
| Planning | `questionnaire` Send the questionnaire · `run-of-show` Build the run of show and share it · `crew-offer` ✦ Book your second shooter · `coi` Get a venue's insurance certificate · `readiness` Know the wedding is ready · `final-balance` Collect the final balance (and autopay) |
| After the wedding | `delivery` ✦ Deliver the gallery and close out · `reviews` Ask for a review · `insights` Read your Insights |
| Admin | `people` Clients, crew and vendors · `automations` Workflows and automatic drafts · `subscription` Your plan and billing |
| Couple | `couple-tour` ✦ Your wedding portal · `couple-proposal` Choose your package and accept · `couple-sign` ✦ Sign your agreement · `couple-pay` Pay, and save a card · `couple-questionnaire` Your questionnaire · `couple-day` Timeline, files and messages · `couple-photos` Get your photos |
| Crew | `crew-offer-accept` ✦ Accept or decline a job · `crew-day` Prep and your day sheet · `crew-closeout` Hours and expenses · `crew-availability` Availability and profile |

That is **39 explainers, 13 of them with a video**. The route each one
answers for is set in the catalogue (§3). Screens with no explainer of
their own fall back to `tour` and "All guides". The button is never hidden.

### 2b. Hints — three kinds

| Kind | Looks like | Example | Rule |
|---|---|---|---|
| **Term** | ⓘ after a word of StudioCue vocabulary | "Booking gate ⓘ": "A job turns Booked only on real evidence: a signed agreement and a paid retainer, or a signature you record yourself." | The text lives in the **glossary**, so one word means one thing everywhere ([[silent-drop-of-a-named-record]]). |
| **Field** | ⓘ after a form label | "Retainer % ⓘ": "The share of the package price due at signing. The couple sees it on the proposal and the invoice." | Written inline where it's used, at most 30 words. It says **what the couple sees**, or **what changes**. |
| **Action** | Shown on hover/focus of a consequential button (desktop), and tied to it with `aria-describedby` | "Send contract": "Emails both partners a link to review and sign. Nothing is charged until they sign." | Only on buttons that **send, charge, sign or change status**. Never the only place something is explained, because phones can't hover. |

**Starting glossary** (~45 terms, confirmed during the sweep):

- **Studio:**
  - The model: Today · Job · Inquiry · Stage (New / Talking / Consult / Proposal / Signing / Closed) · Phase · Next move.
  - Cue: Cue · Prepared action · Approve & send · Automatic drafts (Send automatically / Review each time).
  - Readiness: Readiness · Checkpoint · Booking gate.
  - Money: Retainer · Final balance · Autopay · Package · Add-on · Coverage.
  - Paperwork: Proposal · Agreement · Booking change (amendment).
  - Planning: Run of show · Timing rule · Vendor share link · Crew offer · Offer to someone else · Paperwork · Certificate of insurance (COI) · Questionnaire · Consultation · Availability.
  - Intake: Forwarding address · Inquiry link · Imported booking (quiet by default) · Outside step.
  - After the wedding: Delivery · Closeout · Archive handoff · Review request · Lost.
  - Admin: Workflow · Automation run · Audit log.
- **Couple:** Retainer · Final balance · Saved card / autopay · Agreement · Change to your booking · Timeline · Questionnaire · Gallery · Add-on.
- **Crew:** Offer · Call time · Day sheet · Prep checklist · Closeout · Paperwork · Availability.

The couple and crew wordings are **separate entries** where their meaning
differs from the studio's. A retainer for a couple is "what you pay to
hold your date", not "the evidence the booking gate checks".

### 2c. Videos — wave 1 only (13)

Covered by the ✦ above: `tour`, `setup`, `inquiry-capture`, `today`,
`inquiry`, `proposal`, `contract-retainer`, `job-page`, `crew-offer`,
`delivery`, `couple-tour`, `couple-sign`, `crew-offer-accept`.

- **Length:** 60–120 s; the tour can run to 2:30.
- **Orientation:** studio videos are 1920×1080 landscape. Couple and crew
  videos are 1080×1920 portrait, recorded at a phone viewport
  ([[mobile-first-couple-crew]]).
- **Narration is written from the explainer.** The explainer is the
  outline and the video is the demonstration, so the two never disagree.
- **More videos later:** any other explainer can become a video. Add a
  script file and it slots in, with no UI change.

---

## 3. Data model

All of this lives in `features/help/`. It is framework-neutral and ships
to the browser.

```ts
// features/help/glossary.ts
export type HelpTerm = {
  id: string;                          // "booking-gate"
  term: string;                        // "Booking gate"
  hint: string;                        // ≤ 30 words, plain text
  audience: ("studio" | "couple" | "crew")[];
  explainer?: string;                  // "Learn more" → opens that explainer
};

// features/help/explainers/<stage>.ts
export type Explainer = {
  id: string;                          // "proposal" — used in URLs and ?howto=
  title: string;                       // "Build and send a proposal"
  summary: string;                     // one sentence: cards + SEO meta
  audience: "studio" | "couple" | "crew";
  stage: Stage;
  routes: string[];                    // screens it's the primary guide for
  alsoOn?: string[];                   // screens where it's listed as related
  roles?: StudioRole[];                // hide from staff shooters, etc.
  purpose: string;
  steps: string[];                     // **UI label** in bold, exactly as spelled
  next?: string;
  goodToKnow?: string[];
  terms?: string[];                    // glossary ids
  video?: string;                      // manifest id, only for the 13
};

// features/help/video-manifest.json — GENERATED by the video pipeline, never hand-edited
{ "proposal": { "version": 3, "durationSec": 94, "orientation": "landscape",
  "file": "proposal.v3.mp4", "poster": "proposal.v3.jpg", "captions": "proposal.v3.vtt",
  "chapters": [{ "at": 0, "title": "Start a proposal" }], "recordedCommit": "abc1234" } }
```

- **`helpForRoute(pathname, role)`** returns `{ primary, related[] }`. It is
  a pure function and tested.
- **Why typed data rather than MDX:** there's no MDX setup, and typed data
  lets tests check routes, labels and term ids. `**bold**` is the only
  markup, and a 10-line renderer handles it.
- **Video URLs:** built from `NEXT_PUBLIC_HOW_TO_MEDIA_BASE`. If it's
  unset, explainers still show and videos are hidden.

---

## 4. Components and placement

### 4a. `InfoHint` v2 — the hint component

It keeps the same name. The two existing uses move to the glossary form.

```tsx
<InfoHint term="booking-gate" />                    // glossary term
<InfoHint label="Retainer %">The share of…</InfoHint> // one-off field hint
<ActionHint hint="Emails both partners a link…"><button>Send contract</button></ActionHint>
```

- **Native Popover API:** the button gets `popovertarget` and the bubble
  gets `popover="auto"`.
  - **Tap and click work with no JavaScript,** including on iPhone.
  - Escape and tapping outside close it.
  - It renders in the **top layer**, so panels, sheets and table cells
    can't clip it.
  - The browsers we support (Safari 17+, Chrome, Firefox) all have it.
- **Hover opens it** on devices with a fine pointer only
  (`matchMedia("(pointer: fine)")`), after about 150 ms, and it closes
  when the pointer leaves. Touch devices never get phantom hover
  behaviour.
- **Positioning:**
  - CSS anchor positioning (`position-anchor`, with a
    `position-try-fallbacks` fallback of `flip-block`) where supported.
  - A small JS fallback that places it from `getBoundingClientRect()` on
    `toggle`, clamped to the viewport. It must not go off-screen on a
    375 px phone.
- **Tap target:** a 32 px hit area under `pointer: coarse`, while the icon
  stays 15 px.
- **Glossary term with an explainer:** the bubble ends with **"Learn more"**,
  which opens the How-to popup at that explainer.
- **Styles:** they must not depend on a `.ds-root` ancestor. Hints will sit
  inside sheets, which render outside it ([[ui-audit-2026-09-27]]). Every
  new class must exist in CSS, or the unstyled-class guard test fails.
- **In portals:** it uses kit tokens, so it matches the couple and crew
  look.

### 4b. How-to button and popup

- **`components/help/how-to-button.tsx`:**
  - A "How to" label with a `CircleHelp` icon. The label hides at phone
    width.
  - It reads `usePathname()` and the role, then calls `helpForRoute`.
  - **Placement:**
    - **Studio:** the `ds-topbar` in `AppShell`. This one edit covers every
      studio screen, including the job tabs.
    - **Couple:** the `AppBar` `action` slot in `PortalShell`, beside the
      account icon.
    - **Crew:** the empty `action` slot in `CrewShell`.
- **`components/help/how-to-dialog.tsx`,** built on `SheetDialog` at
  `width="wide"`. It is full screen on phones and wraps in `KitRoot` in the
  portals. It contains:
  - The **video**, if there is one, with poster and captions. It plays when
    the video is tapped, not when the popup opens, because many people
    only want the text.
  - The **explainer**: purpose, steps, what happens next, good to know, and
    term chips.
  - **Related:** the `alsoOn` explainers for this screen. They swap in
    place.
  - **"All guides →"**, which goes to `/studio/help#guides` in the app and
    `/how-to` on the website.
- **`?howto=<id>`** opens the popup on load, so support replies, emails and
  Cue can link straight to a guide.
- **`components/help/explainer-view.tsx`** and **`video-player.tsx`** are
  shared by the popup, the help hub and the public pages.

### 4c. In the platform

- **`/studio/help`:** a new **Guides** section (`#guides`), grouped by
  stage, with ▶ on the 13 that have video. The **Glossary** is an A–Z list
  of every studio term, linkable at `#term-booking-gate`.
- **Setup checklist:** each row gets a "How to" link to its explainer.
- **Cue:** `helpForQuestion()` deterministically matches "how do I…" and
  "what is…" questions to an explainer or term, the same pattern as
  `outsideStepForQuestion`. Cue then shows the explainer card under its
  answer. No model call is involved.

### 4d. Public website

- **`/how-to`**, "How to use StudioCue":
  - Uses `MarketingLayout`, with audience tabs (Studios / Couples / Crew)
    and stage sections.
  - Cards show ▶ and the duration where there's a video, and open the
    popup.
- **`/how-to/[id]`** is statically generated and holds the full explainer
  as a real page. Text is what search engines index, so the explainers do
  more for SEO than the videos. Where a video exists, the page also has
  the inline player, the transcript and `VideoObject` JSON-LD.
- **`/how-to/glossary`** is the public glossary. It's useful for couples
  sent a link, and for search.
- **Wiring:**
  - Add a nav and footer link in `components/marketing/marketing-layout.tsx`
    **and** in `app/page.tsx`.
  - Add the new pages to `app/sitemap.ts`.
  - Link to `/how-to` from `/support`.
  - Add a home page hero button, "Watch the 2-minute tour".
  - Give `CapabilityGrid` items an optional `guide` id, so each shows a
    "See how" link.

---

## 5. Keeping it true

Screens change, and help that describes the old screen is worse than none
([[copy-outlives-the-change]]). Three guards:

1. **`tests/help-content.test.ts`,** added to the `npm test` list, checks
   that:
   - IDs are unique, and every glossary `term="…"` used in `components/`
     and `app/` exists in the glossary. Unused glossary terms fail too.
   - Every `routes` pattern matches a real `app/**/page.tsx`. Every studio
     nav href, client tab and crew tab has an explainer.
   - **Every `**bold label**` in an explainer appears as a string literal
     somewhere in `components/`, `app/` or `features/`.** Rename a button
     and the explainer that names it goes red.
   - Hint length is at most 30 words, and explainer length is within
     120–250 words.
   - Every `video` id exists in the manifest.
2. **`npm run how-to:check`** dry-runs the 13 video scripts' actions
   against the emulator (no recording, no ElevenLabs). It fails if a
   button a video clicks has gone.
3. **Staleness report:** lists the videos whose `recordedCommit` predates
   changes to the components behind their routes.

---

## 6. Video hosting

**Firebase Storage in the prod bucket, under a read-only public path.**
This means no new vendor, no YouTube tracking cookies and no consent
banner.

```
match /public/how-to/{file} {
  allow read: if true;
  allow write: if false;      // uploaded with gsutil only
}
```

- **Deploy:** `firebase deploy --only storage`. This is a separate step.
- **Upload:** use `Cache-Control: public, max-age=31536000, immutable` and
  versioned filenames (`proposal.v3.mp4`).
- **Service worker:** because the video is cross-origin, `sw.js` never sees
  its range requests.
- **Cost:** about 6–12 MB per video, so 1,000 plays is about $1.20 of
  egress. R2 is the escape hatch, reached by changing
  `NEXT_PUBLIC_HOW_TO_MEDIA_BASE` only.

---

## 7. Video pipeline (Claude + ElevenLabs)

Everything lives in `scripts/how-to/`. None of it ships in the app bundle.

```
scripts/how-to/
  videos/<id>.ts      # narration + actions, one file per video
  lib/voice.ts        # ElevenLabs client + content-hash cache + pronunciation list
  lib/recorder.ts     # Playwright driver + overlays (cursor, click pulse, spotlight)
  lib/captions.ts     # character alignment → WebVTT
  lib/assemble.ts     # ffmpeg → mp4 + poster + vtt; writes the manifest entry
  cards/              # HTML title/outro cards, captured like any page
  make.ts · check.ts · publish.ts
```

### Script file

```ts
export default defineHowTo({
  id: "proposal",
  start: { snapshot: "demo-workspace", as: "owner", viewport: "desktop" },
  steps: [
    { chapter: "Start a proposal",
      say: "When a couple is ready for pricing, open their inquiry and choose Create the proposal draft.",
      do: [{ goto: "/studio/leads" },
           { click: { role: "link", name: "Julia & Piotr Nowak" } },
           { spotlight: { role: "button", name: "Create the proposal draft" } },
           { click: { role: "button", name: "Create the proposal draft" } }] },
    // …
  ],
});
```

Buttons are located by role and visible label, the same words the
narration uses. When a label changes, the script fails instead of the video
going quietly stale.

### Voice

- **Endpoint:** `POST /v1/text-to-speech/{voice_id}/with-timestamps`
  returns the audio plus per-character timings. Those timings drive both
  the captions and the step timing.
- **Settings are locked in one config:** voice, model, settings and a fixed
  `seed`, so every video sounds like the same narrator. Current models
  can be confirmed with `GET /v1/models`.
- **Continuity:** `previous_text`/`next_text` are set on each step, so
  delivery flows across step boundaries.
- **Cache:** audio is keyed by a hash of the text and settings, and stored
  in `.how-to-cache/` (gitignored). Re-cuts after a UI change cost nothing
  unless the words changed.
- **Key:** `ELEVENLABS_API_KEY` in `.env.local` only. It is never committed
  and never reaches the app.
- **Budget:** 13 videos × ~1,400 characters × ~2 for retakes is **~36k
  characters**. That fits a low paid tier for one month. A **paid plan is
  required for commercial use**.

### Recording

- **Where:**
  - Emulators and the demo seed, snapshotted once with
    `emulators:export`, then re-imported fresh before each video.
  - Real functions run in the emulator, the same as `scripts/uat/`
    ([[local-uat-harness]]).
  - The app runs as a production build (`npm run build && npm run start`).
  - **Never recorded on prod.**
- **Audio first:**
  1. Generate the narration for each step.
  2. The recorder notes each step's start time *tᵢ* and runs its actions.
  3. It waits until `tᵢ + audioᵢ + 0.4s` before the next step.
  - Picture and voice line up by construction.
- **Capture method: settled by the phase-0 spike.** Playwright
  `recordVideo` is simple but soft on text. A CDP `Page.startScreencast`,
  assembled at a constant 30 fps, is crisp. Pick on legibility.
- **Overlays,** injected with `addInitScript`:
  - A visible cursor moving on an eased path.
  - A click pulse.
  - A spotlight ring on the element being talked about.
  - Typing at a human pace.
- **Hidden:** the `.firebase-emulator-warning` banner and demo-mode
  notices.
- **Viewports:** studio at 1920×1080. Couple and crew as a 390×844 phone at
  3× scale, padded to 1080×1920 on the brand background.
- **AI text on screen:** record with the deterministic mock AI provider,
  and never read a Cue draft aloud.
- **Dates:** never say a date in the narration, because the demo dates are
  relative to today.

### Assembly (ffmpeg)

- **Audio:** each step's clip is placed with `adelay` at *tᵢ*, then `amix`,
  then `loudnorm` to −16 LUFS.
- **Video:** H.264, `yuv420p`, CRF ~22, 30 fps, **`-movflags +faststart`**
  so it starts playing before it has fully downloaded.
- **Also produced:** a poster JPEG, WebVTT captions (at most 2 lines of 42
  characters), and the chapters, transcript and commit written to the
  manifest.

### Claude's loop per video

1. **Draft** the narration from the explainer, and walk the screen in the
   emulator first.
2. **Voice** it, and check each step's audio length against its action.
3. **Record and assemble.**
4. **Self-review:** pull 1 frame per step and look for the wrong screen, a
   spinner, an error toast, the cursor off target or clipped text. Check
   that audio and captions end together.
5. **Send the MP4 to Conor. Nothing is published without his approval.**
6. **Publish:** upload, bump the version, and commit the manifest.

---

## 8. Build order

| Phase | What | Who | Done when |
|---|---|---|---|
| **1. Foundation** | `features/help/*` model and tests, `InfoHint` v2 and `ActionHint`, How-to button and popup (text only), `/studio/help` Guides and Glossary, public `/how-to`, `/how-to/[id]`, `/how-to/glossary`, nav, footer and sitemap. Launches with ~6 explainers: `tour`, `today`, `inquiry`, `proposal`, `contract-retainer`, `job-page`. | Claude | Walked on prod at desktop and phone ([[look-at-every-new-screen]]), and a tap on a hint works on iPhone |
| **2. Explainers + hints, area by area** | One walk per area produces **both** the explainers and the hints for those screens: ① inquiry → booking ② planning ③ setup, settings and integrations ④ delivery, reviews and insights ⑤ couple portal ⑥ crew portal ⑦ admin | Claude writes, **Conor skims each area** | All 39 explainers and ~120 hints in place, and the content test is green |
| **3. Video spike** (parallel with 2) | Voice samples, then **Conor picks**. Capture-method spike on `today`. | Claude + Conor | One approved MP4 |
| **4. Pipeline + 13 videos** | `scripts/how-to/*`, then the 13 wave-1 videos | Claude makes, **Conor approves each** | All ✦ videos live in the popup and on `/how-to` |
| **5. Joins** | Cue `helpForQuestion`, setup checklist links, "See how" on marketing pages, home page tour button | Claude | — |
| **Ongoing** | Content test on every change; `how-to:check` before releases; re-cut what's flagged | Claude | — |

**Deploy notes:**
- Only phases 3–4 need the storage rules deploy and
  `NEXT_PUBLIC_HOW_TO_MEDIA_BASE` in `apphosting.yaml`.
- No Cloud Functions change is involved.
- Create and verify the App Hosting rollout explicitly, per CLAUDE.md.

---

## 9. Decisions for Conor

1. **Voice:** choose from samples. US English is recommended, to match the
   US market and copy.
2. **Hosting:** Firebase Storage (recommended).
3. **Music bed:** none (recommended).
4. **Public URL:** `/how-to`, "How to use StudioCue" (recommended).
5. **ElevenLabs:** a paid tier, with `ELEVENLABS_API_KEY` in `.env.local`.
   This isn't needed until phase 3.
6. **Review:** skim each explainer area, and approve each video.

## 10. Risks

- **Another session is editing the marketing layouts right now**
  (`app/*/layout.tsx`, `app/app-styles.ts`). Coordinate before touching
  `marketing-layout.tsx` or `app/page.tsx`, and stage by path.
- **Hint overload:** a ⓘ on every label turns into noise. A hint earns its
  place only if a new studio owner would otherwise stop and wonder, or if
  it says **what the couple sees** or **what changes**. Aim for 2–4 per
  screen, not 15.
- **Hover isn't phone-friendly:** action hints are desktop-only, so
  anything essential goes in visible copy or the explainer, never only in a
  hover.
- **Label drift:** the bold-label test covers explainers, and
  `how-to:check` covers videos. Glossary hints can't be machine-checked for
  truth, so the area walk re-reads the glossary each time an area changes.
