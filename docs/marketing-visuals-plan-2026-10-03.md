# Fewer videos, better visuals — the marketing site, rethought (2026-10-03)

Conor's note after scrolling the live site on a phone and a laptop: it feels
like "a website with endless videos" rather than a well-thought-out
marketing tool. He likes the main video up front and the videos for the
parts of the journey; everything else should be visuals, graphics or
screenshots.

He's right, and the reason is worth naming: when every section moves, none of
them leads. Video asks for attention and time; a buyer skimming on a phone
wants to *see the point of a section in one glance*. The film earns its place
because it is the proof. The rest of the page should be the argument —
copy you can skim, with a picture that makes each claim concrete.

---

## 1. Where the videos are today (audit of studio-cue.com)

| Page | Videos / moving clips now | Keep |
|---|---|---|
| **Home** | Hero loop + "Watch the film" · six chapter stops · "three people" (1 loop + 2 phone players) · Meet Cue loop · Getting paid loop · Readiness loop | **Hero + chapter stops only** |
| `/wedding-photographers` | The film under the hero · "three people" (1 loop + 2 players) | **The film only** |
| `/features` | 4 loops (sign, timeline, proposal, crew) | **None** |
| `/for-clients` | 2 phone players (couple tour, signing) + a still | **None** (link to the tour instead) |
| `/for-crew` | 1 phone player + a still | **None** (link to the tour instead) |
| `/how-to/wedding-journey` | The film + 8 chapter players | **All** — this page *is* the film's home |
| `/how-to/[guide]` | One how-to video per guide | **All** — that's help, not marketing |
| Corporate, sports, integrations, pricing | none | — |

So: **13 embedded videos/loops come off the marketing pages**; the hero, the
chapter stops, the film on the weddings page, and the help/journey pages stay.

## 2. The rule from now on

1. **One moving thing per page, up front.** The home page's is the hero
   (loop + "Watch a wedding, start to finish"), and the six chapter stops
   are its index — thumbnails that open the film, not players on the page.
2. **Every other section gets one still visual**, chosen by what the copy
   claims:
   - *A screen claim* ("the reply is already written") → an **annotated
     screenshot**: the real screen, cropped to the card the copy talks about,
     with 1–3 numbered pins.
   - *A flow claim* ("proposal → agreement → retainer → final → autopay") →
     a **diagram**, built in the page (HTML/SVG in the design system), not an
     image.
   - *A people claim* ("your couple and your crew get their own app") →
     **phone screens** in the film's device frame, two or three side by side.
3. **Video becomes a link, not an embed.** Where a how-to video exists,
   the section says "Watch the 1-minute tour →" and opens it in the
   existing film dialog. Nobody scrolls past a player they didn't ask for.
4. **Some sections stay text-only.** Not every section needs a picture;
   rhythm matters (visual / text / visual), and icons carry the rest.
5. A test keeps it this way (§6).

## 3. The visual kit (built once, used everywhere)

| Component | What it is | Used for |
|---|---|---|
| `AnnotatedShot` | A real screenshot (WebP, 1× and 2×), cropped to one card, in the film's rounded window frame, with numbered pins + a short legend. Pins are HTML over the image, so text is crisp, accessible and editable. | Today's prepared reply; the booking gate; the readiness checklist; the run of show |
| `PhoneScreens` | 2–3 real phone screens in the film's bezel, slightly staggered; on phones a swipeable row (scroll-snap) with dots | Couple pages, crew pages, "three people" |
| `ThreePeople` | One composition: a cropped desktop job page in the middle, Ella's phone on one side, Jordan's on the other, each labelled | Home + weddings page |
| `PaymentTrack` | A five-step diagram with the Harts' real numbers: Proposal $6,500 accepted → Agreement signed online → Retainer $1,950 paid → Final balance $4,550 due 2 weeks before → Autopay | Home "Getting paid", `/integrations` QuickBooks |
| `CueDoesCueNever` | Two columns: what Cue drafts / what only you can do (payments, signatures, permissions) | Meet Cue, `/features` |
| `TimelineStrip` | The six-stop bar (already built for the chapter stops) as a static graphic | Weddings page, journey page header |

All screenshots are **of the same wedding as the film** (Ella & Marcus
Hart, Alder & Muse, Jordan), so the whole site tells one story, and none
shows demo noise like the "$6,265 overdue" headline.

### How the screenshots are made (repeatable, not hand-cropped)

`scripts/marketing/screens.ts` — a shot list run against the how-to stack:
each shot names the journey snapshot to start from (so the Harts are at the
right stage), who's signed in (owner / Ella / Jordan), desktop 1440 or phone
390 @3×, the route, the element to crop to, and anything to hide (Feedback
tab, How-to button). Output: `public/marketing/<name>.webp` + `@2x`,
committed, each under ~120 KB. A UI change → re-run, review, commit.

## 4. Page by page

### Home
| Section | Today | New visual |
|---|---|---|
| Hero | Loop + Watch film | **Keep** |
| One wedding, start to finish | Six chapter stops | **Keep** (thumbnails open the film at each chapter) |
| You, your couple and your crew | 1 loop + 2 phone players | **`ThreePeople`** still composition + "Watch the couple's tour →" link |
| Meet Cue | Loop | **`AnnotatedShot`** of Today's *Prepared for you*: ① "Drafted in your voice" on Ella's reply ② "One tap to send" ③ "Waits for you — never sends money or signatures". Keeps the "17 emails" line. |
| Getting paid | Loop | **`PaymentTrack`** diagram + a small phone crop of Ella's *Your next payment* card |
| Booked isn't ready | Loop | **`AnnotatedShot`** of the wedding-week readiness: ① checkpoints ticked ② "the one thing left" ③ "who owns it" |
| Not just weddings | Icons | Keep (text + icons) |
| GR Productions | Text | Keep (text; a logo later if Gabriel sends one) |
| Integrations, pricing, FAQ, closing CTA | Static | Keep |

Net: the home page goes from **6 moving/playable elements below the hero to
none**. The only motion is the hero; the chapter stops are a menu into the
film.

### `/wedding-photographers`
- Keep **the film** under the hero (it's this page's main video).
- "Three people" → `ThreePeople` still.
- The six stage sections (Inquiry → consultation … Delivery → review →
  closeout) each get a **small annotated crop** or stay text-only,
  alternating — never more than one visual per section.

### `/for-clients`
- Replace the two players with **`PhoneScreens`**: Ella's Home (countdown +
  next step) · Proposal · Agreement signed · Timeline · Photos. Swipe on a
  phone.
- "Watch the couple's 1-minute tour →" (opens `couple-tour` in the dialog).
- Sections ("Decide without a phone call", "Pay without handling card
  details", …) get one small crop each where it helps (the proposal's
  Accept, the payment card, the gallery card) and stay text elsewhere.

### `/for-crew`
- **`PhoneScreens`**: the offer · the day sheet (with *Read before you shoot*)
  · the call-time reminder · hours & expenses.
- "Watch the 1-minute tour →" (`crew-offer-accept`).

### `/features`
- Remove the four loops. "Cue drafts. You decide." → `CueDoesCueNever`;
  "A job cannot be marked booked by mistake" → annotated booking-gate crop;
  "Twelve things happen without you" → a clean numbered list graphic.
  The rest stay text + icon.

### Corporate & sports
- Text-only today. Add **one** visual each from the demo's corporate and
  sports jobs (the brief / the consent questions), so they don't look
  thinner than the wedding page. Lower priority.

### Unchanged
`/how-to/wedding-journey` (the film's home), the how-to guides, pricing,
integrations (gets `PaymentTrack` in the QuickBooks block, optional), the
trial-checkout teaser inside the app (that's onboarding, not the website),
and the social clips (they're for Instagram, not the site).

## 5. Mobile

- Visuals sit **below** their copy, full width, never side by side.
- `PhoneScreens` becomes a swipeable row showing one screen and a peek of
  the next; `ThreePeople` stacks to the desktop crop with the two phones
  overlapping its lower corners.
- Pins become numbered markers with the legend underneath (no hover).
- Budget: home page ≤ 1.5 MB on first load excluding the film; hero loop
  is the only video request; every image `loading="lazy"` except the hero
  poster.

## 6. Keeping it this way

`tests/marketing-media-budget.test.ts`:
- Marketing pages render at most **one** video/player, except the home page
  (hero only — chapter stops must be images/buttons) and the how-to pages.
- Every `AnnotatedShot`/`PhoneScreens` image has alt text describing what it
  shows, exists in `public/marketing/`, and is under 150 KB.
- No marketing page imports the `mk-loop-*` media (the loops stay published
  but unused; they can go in social posts).

## 7. Order of work (≈ 2 days)

| Step | What |
|---|---|
| 1 | Shot list + `scripts/marketing/screens.ts`; capture ~16 screens from the journey snapshots; review them as a contact sheet before any page changes |
| 2 | Build the kit: `AnnotatedShot`, `PhoneScreens`, `ThreePeople`, `PaymentTrack`, `CueDoesCueNever` |
| 3 | Home: swap the five sections; remove the loops and players |
| 4 | Weddings, for-clients, for-crew, features |
| 5 | The media-budget test; page-weight and phone checks; screenshots at 1440 and 375 of every changed page on prod |
| 6 | Corporate & sports visuals (if wanted) |

## 8. Decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | Keep the film embedded on `/wedding-photographers`, or make it a "Watch" button like the home page? | Keep it — it's the page's main video, and buyers on that page want proof |
| D2 | Keep the trial-checkout teaser inside the app? | Yes — it's onboarding, not the website |
| D3 | Corporate & sports visuals now or later? | Later (step 6), after the wedding pages land |
