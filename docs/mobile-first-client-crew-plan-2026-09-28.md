# Mobile-first couple and crew experience — plan, 2026-09-28

**The ask (Conor, testing the inquiry form on his phone):** "It is not built for
mobile." Every client and crew screen was built for the web and then adapted
to phones. Couples and crew will use their phones first. Design every screen
they can see from scratch, mobile-first, to a premium standard, with one
consistent brand, one set of buttons and one layout system, ready to ship
later as iOS and Android apps.

Mockups: https://claude.ai/artifact/93XEH3xzW2xbgskX8zyEqK (a clickable
prototype of the couple flow and the crew flow).

---

## Why the 2026-09-13 mobile pass didn't fix this

`docs/mobile-parity-checklist.md` records a real foundation: bottom tab bars
for all three portals, bottom sheets, a PWA, and safe areas. Then it says
"96%+ of grids already stack" and that client/crew screens were "already
mobile-first". **That was checked by reading the CSS, not on a phone.** The
first phone test, on the first screen a couple ever sees, found this:

- **The inquiry form is wider than the phone.**
  - A ≤640px rule deliberately puts date and type side by side in 156 px
    columns (`globals.css:19253`).
  - iOS draws `input[type=date]` with a minimum width it won't give up.
  - `.inquiry-layout` is `1fr`, which means `minmax(auto, 1fr)`, and
    `.inquiry-form` has no `min-width: 0`, so the card grows and widens the
    whole page.
  - Text is cut off on the right, and inputs run past the edge (screenshot,
    2026-09-28).
- **Responsive ≠ designed for mobile.** The screens stack, but they are still
  desktop pages in a narrow column:
  - one long form instead of steps;
  - the decision at the bottom of a long page instead of in the thumb zone;
  - an email-style composer instead of a chat;
  - a 5-column status track with 9 px labels;
  - a 12-character password for a couple opening a link on their phone.

Rule going forward, the same as "walk it on prod or it is not done": **a
mobile screen is not done until it has been used on a phone.**

---

## Everything a couple can see (28 screens, 29 emails)

This is the order a couple meets each screen. "Problem today" is from the
2026-09-28 audit. Line numbers are in `components/client/live-client-views.tsx`
unless noted.

| # | Moment | Screen today | Problem today | Mobile-first design |
|---|---|---|---|---|
| 1 | First contact | `/inquiry` (`lead-intake-form.tsx`) | Overflows the phone. One long 14-field form. **StudioCue's logo, not the studio's** | **Three short steps** (you → your day → your story), one question group per screen. Studio brand on top. Sticky Continue. COI question in step 2 (H3) |
| 2 | Studio replies | `/i/[token]` (`couple-inquiry-page.tsx`) | Slot list scrolls inside a 560 px box. The aside heading pushes the card off screen. Cancel has no confirmation | **Details, then book a call**: day chips across the top, times as big rows, the format as a segmented control, a confirm sheet |
| 3 | Consultation invite | `/schedule/consultation` | Same slot picker as #2 | Same component as #2 |
| 4 | Portal invite | `/auth/client-invite` | Marketing column above the form. **12-character password** | **"Welcome, Harper & Devin"**, then Continue with Apple / Google, or email me a link. No password to invent |
| 5 | Sign in (return) | `/auth/login`, magic link, reset | Studio-first copy. Google sign-in only for studios | The same passwordless screen as #4 |
| 6 | Home | `/client` `LiveClientHome` L611 | Long page. The 4-column "Reserve your date" track shrinks to 11 px labels | **One "next step" card at the top**, a countdown, then a vertical journey list |
| 7 | Proposal | `/client/proposal` L1440 | The decision is at the very bottom. The aside is 300 px wide | Package card, **add-ons as toggles (H2)**, total, then a **sticky "Review & sign"** bar |
| 8 | Choose package | `/client/package` L1801 | `minmax(310px)` overflows below 360 px | Merged into #7. The studio picks before sending (H2 Q8), so the couple just reviews |
| 9 | Contract | `/client/contract`, `contract-signing.tsx` | The whole contract inline, with the sign panel at the very bottom | **Sectioned reader** with progress, then **Sign sheet** per section (H2: terms → coverage) |
| 10 | Pay retainer | `/client/payments` L2223, `client-autopay.tsx` | The card form sits inline in the page. "Continue to secure payment" opens a new tab | **Amount due, one button.** Apple Pay / Google Pay / card in a sheet. The schedule is below |
| 11 | Files | `/client/documents` L1060 | OK, but files open outside the app | **List + in-app preview sheet (H1)** |
| 12 | Messages | `/client/messages` L1202 | Email-style composer with a Subject field. "Reply" is 12 px text | **Real chat**: bubbles, a pinned composer, attachments from the camera or files |
| 13 | Questionnaire | `/client/questionnaire`, `client-questionnaire-form.tsx` | Every section on one page. Inputs are disabled during autosave, which drops the keyboard. Radios render as `<select>` | **One section per screen**, progress, choice chips, autosave that never blurs the field, "Finish later" |
| 14 | Timeline | `/client/schedule` L2437 | Approve is one tap with no confirmation. The change request uses a long `<select>` | **Vertical day timeline.** Approve in a sheet, and change requests go **on the item** ("Ask about this") |
| 15 | Final payment | `/client/payments` | Same as #10 | Same as #10, plus autopay on/off as a row |
| 16 | Delivery | `/client/delivery` L2647 | 2 columns until 760 px, a 240 px art block, an 11 px "Copy" | **"Your photos" and "Your film" (H4)**: cover image cards, the access code with a large copy button, an Open button |
| 17 | Album | `/client/delivery` (album) | A 5-column track with 9 px labels | Vertical steps, and proof approval in a sheet |
| 18 | Review | `/client/reviews` L2925 | Fine; the card padding is 34 px | A thank-you card with a single CTA |
| 19 | Details | `/client/project` L988 | A 2-column grid until 620 px | Merged into Home, as a "Your day" sheet |
| — | Portal shell | `portal-shell.tsx` | StudioCue brand. "More" opens a left drawer. The loading shell jumps | **Studio-branded app bar + 4 tabs** (Home · Plan · Messages · Files), no drawer |
| — | Emails (29) | `email-templates.ts` | Each CTA lands on a desktop-first page. `inquiry_acknowledgement` has no CTA | **Every CTA deep-links to one screen** (universal/app links later). Fix the empty CTA |
| — | External | Stripe / QuickBooks invoice, gallery, review site, Zoom | Leaves the app with no way back | Opened in an in-app browser sheet with a return to StudioCue. Pay is native where possible (#10) |

## Everything a crew member can see (16 screens, 5 emails)

| # | Moment | Screen today | Problem today | Mobile-first design |
|---|---|---|---|---|
| 1 | Invitation | `/auth/crew-invite` (`accept-crew-invitation.tsx`) | 12-character password | Passwordless, the same as the couple's (#4) |
| 2 | Offer | `/crew/pending`, `assignment-actions.tsx` | 3-column facts. Decline has no confirmation. The fee may be hidden | **Offer card**: role, date, call time, venue map, fee, respond-by countdown. **Sticky Accept / Decline**, and Decline asks for a reason in a sheet |
| 3 | Today | `/crew` `LiveCrewHome` | Card grid. The next job is buried | **"Next up" hero** (date, call time, drive time), then the to-dos |
| 4 | Jobs | `/crew/jobs` | Every card expanded, so a very long page | Compact rows (per the "mobile queues must be compact" rule). Tap opens the job |
| 5 | Prep | `/crew/prep` | A job picker `<select>` and 4 tiles | Merged into the **job page**: brief, requirements, documents |
| 6 | **Day sheet** | `/crew/schedule` (event-day) | The time column wraps ("Aug 19, 10:00 AM") **in the phone's zone, not the event's**. The action bar is stacked on the tab bar. There is no shot list | **The wedding-day screen:** Now/Next, the address with Directions, tap-to-call contacts, **family formals and must-have shots**, do-not-photograph, the timeline in the event's zone. **Works offline** |
| 7 | Requirements | `/crew/requirements` | Row actions wrap awkwardly | A checklist with one action per row |
| 8 | Documents | `/crew/documents`, `/crew/profile` uploads | Upload labels stack with no grouping | **Scan with camera** / choose a file, with the status per document |
| 9 | Closeout | `/crew/closeout` | `datetime-local` pickers. Only one expense line | Hours with a stepper (prefilled from the schedule), expenses as a repeatable list with a **receipt photo**, deliverable links, Submit |
| 10 | Availability | `/crew/availability` | A 5-column form. Delete has no confirmation | **Month calendar**: tap days to block, swipe a row to delete (with undo) |
| 11 | Profile / account | `/crew/profile`, `/crew/account` | Comma-separated lists | Chips for trades and gear. Account merges into Profile |
| — | Shell | `crew-portal-shell.tsx` | Breakpoints disagree (860/760/650). No notifications | **4 tabs (Today · Jobs · Calendar · Me)**, a notifications bell, push later |
| — | Emails (5) | `crew_invitation` … | `final_schedule_published` links without `?assignment=`. `crew_reminder` is never queued | Deep-link every CTA to its job. Wire up or delete `crew_reminder` |

---

## The design system (one kit for couple, crew, web and native)

**One source of truth:** `design/tokens.json` (colour, type, space, radius,
motion, elevation). It generates CSS variables for the web and a theme
object for React Native, so the web and the apps can't drift apart.

- **The studio's brand leads.** A couple is buying *FlawlessIQ*, not
  StudioCue. The app bar shows the studio's logo or monogram. The studio's
  colour drives buttons, progress and links, clamped automatically so it
  meets 4.5:1 contrast on the paper colour. "Powered by StudioCue" sits in
  the footer only. The data already exists: `emailBranding.primaryColor`
  and `logoUrl`.
- **Palette (default):**
  - ground Ivory `#F7F3EC`, paper `#FFFDF9`, line `#E8E0D3`;
  - ink `#1D1A16`, secondary `#5F554A`, caption `#6F655A` (all ≥4.5:1 on
    ivory);
  - studio accent (default Forest `#2D5A45`), accent-soft `#E4EDE7`;
  - brass `#8A6A3A` for status labels;
  - danger `#A63C3A`.
- **Type:** Fraunces (display: screen titles 30/34, section 22/28) and
  Instrument Sans (UI: body 16/24, secondary 15, caption 13, eyebrow 12
  caps tracked). Inputs are always 16 px, so iOS never zooms. Everything
  scales with Dynamic Type.
- **Layout:**
  - 20 px side gutters and an 8 px grid;
  - a single column **always**;
  - no side-by-side fields under 430 px;
  - **one primary action per screen, sticky in the thumb zone**;
  - secondary actions go in sheets;
  - scrolling happens in the page, never in a box inside it.
- **Components** (web now, the same contract in native later):
  - App bar: a large title that collapses on scroll, the studio mark, one
    right-hand action;
  - Tab bar: 4 tabs, 24 px icons + 12 px labels, safe-area padding;
  - Sheet: grab handle, snap points, keyboard-aware;
  - Sticky action bar;
  - Buttons: primary 52 px, secondary, text, destructive, and
    Apple/Google Pay;
  - Field: label above, hint and error inline, the right keyboard and
    `autocomplete`;
  - Stepper, Choice chips, Segmented control;
  - List row: leading icon, title/subtitle, trailing value/chevron;
  - Card, Timeline, Chat bubble + composer, File row + preview sheet;
  - Progress ring and bar, Skeletons, Empty state, Toast/Undo.
- **Motion and feel:**
  - 200–250 ms ease-out;
  - press states on every tappable element;
  - haptics on confirm (native);
  - optimistic updates with undo;
  - reduced-motion honoured.
- **Targets:** every tap target is at least 44×44 pt. Every destructive or
  irreversible action gets a confirmation sheet, never one tap.

---

## Web now, iOS and Android next

**Build the mobile-first web screens first.** Couples arrive from email and
Instagram links and will not install an app to reply to an inquiry. The web
has to be excellent on its own.

For the stores, design now for what native will require:

- **Sign in with Apple is mandatory** in the App Store if Google sign-in is
  offered to couples or crew (guideline 4.8). Plan passwordless auth with
  Apple, Google and a magic link from day one.
- **In-app account deletion** is required for App Store apps that create
  accounts (5.1.1(v)). Couples and crew need a "Delete my account" path.
- **Payments for a real-world service** (the wedding) are exempt from
  in-app purchase. Stripe, Apple Pay and Google Pay are allowed.
- **Deep links:** every email CTA becomes a universal link (iOS) and app
  link (Android) that opens the app if it's installed and the web if not.
  Routes need to be stable and meaningful now.
- **Push notifications** replace the nudges that are currently emails (offer
  expiring, schedule changed, gallery ready). Email stays the fallback.
- **Offline:** the crew day sheet and the couple's timeline must work with no
  signal at a barn venue. The service worker already caches `/crew/schedule`;
  make it the design rule for those two screens.
- **Camera and files:** W-9 and insurance scans, receipt photos, and
  questionnaire uploads use native pickers.

**How to get into the stores:**

- **Recommended: Capacitor**, wrapping the new mobile-first web screens as
  one native app, with native plugins for push, camera, haptics, sign-in
  and payments. Weeks, not months, and one codebase.
- **The alternative is Expo / React Native** (the roadmap's 2026-09-13 note
  recommended it for the *studio* app). It gives more native feel, but
  every screen is built twice.
- **Either way:** the tokens and component contracts above are
  platform-neutral, so choosing Capacitor now doesn't block a move to Expo
  later.

**One app or many:** recommended is **one "StudioCue" app with couple and
crew modes, branded as the studio inside**. Per-studio white-label apps can
come later as a premium tier.

---

## How this changes the build queue (H1–H5)

Four of the five queued items redesign client or crew screens:

- **H1** preview sheet;
- **H2** proposal + sign + add-ons;
- **H3** COI question on the inquiry;
- **H4** "Your photos / Your film".

Building them on today's desktop-first components and then rebuilding them
for mobile is paying twice. **Recommended:** put the mobile foundation (M1)
first, then build each H-item's client/crew surface directly in the new kit.
The studio-side (desktop) parts of H1–H4 are unaffected.

## M0 — done 2026-09-28

- **Overflow fixed.**
  - The inquiry form is one field per row under 640 px.
  - `.inquiry-layout` is `minmax(0, 1fr)` and `.inquiry-form` has
    `min-width: 0`.
  - Every input on a phone gets `max-width: 100%; min-width: 0`.
  - Date and time inputs drop the native appearance, so iOS respects their
    width. The picker still opens.
- **Guard:** `e2e/mobile-no-horizontal-overflow.spec.ts`. It covers 27
  couple, crew and public routes at 360/390/430 px, in Chrome **and**
  Safari's engine (the `iphone-webkit` project). It fails if a page is wider
  than the screen, or if any two fields share a row. The side-by-side rule
  is what catches the iPhone bug: no desktop engine sizes a date input the
  way iOS does, so a width check alone passed the broken page in both
  engines. Its fast half is `tests/mobile-layout-rules.test.ts`, which runs
  in `npm test`.
- **Run it** against a mock build (no Firebase needed):
  ```bash
  NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_AUTH_MODE=mock npm run build
  NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_AUTH_MODE=mock npm run start &
  PLAYWRIGHT_CHANNEL=chrome npx playwright test e2e/mobile-no-horizontal-overflow.spec.ts --project=desktop-chromium --project=iphone-webkit
  ```
  `PLAYWRIGHT_CHANNEL=chrome` uses the installed Google Chrome.
- **The mock build works again.** `AppShell`'s `useSearchParams()` had no
  Suspense boundary, which only mattered once mock mode let the build
  prerender the studio shell. That was what blocked every e2e run on this
  machine.
- **Not covered by automation:** how iOS itself draws controls. Each phase
  still ends with a walk on a real phone.

## M1 — done 2026-09-29 (1145c75, 9fd3ec7, ca234b5)

- **Tokens:** `design/tokens.json` is the one source. It generates
  `app/kit-tokens.css` (`npx tsx scripts/generate-kit-tokens.ts`), and a
  test fails on drift.
- **Studio theme:** `features/design/studio-theme.ts`. Any studio colour is
  used exactly if it reads at AA against white, paper and ivory. A pale one
  keeps its hue and is darkened until it does.
- **Kit:** `components/kit/kit.tsx` + `app/kit.css`, scoped to `.kit`:
  - KitRoot, Screen, AppBar with the studio mark;
  - Button, Field, TextArea, Choices, Toggle;
  - Card, List/Row, Pill, Note, Steps;
  - Actions (sticky, thumb zone), TabBar.
  - Live at **/kit** (`?color=%23RRGGBB`).
- **Studio brand:** `features/branding/tenant-brand.ts`, mirrored in
  functions. Portals, the inquiry page and both invitation previews now
  show the studio.
  - The client invitation page never showed a logo saved in Settings; that
    is fixed.
  - The portal accent is the clamped studio colour. Emerald's `#0ea372`
    read at about 3:1 under white text.
- **Passwordless:** Google on every invitation (checked against the invited
  address), and on couple and crew sign-in. The emailed sign-in link now
  works for crew too.
- **Not done:**
  - **A first-time invitee with no Google account still sets a
    password.** Letting the invitation link itself sign them in is a
    security decision (see below).
  - **The light public shell** (H5 1.5) moves to M2, where the inquiry page
    is rebuilt in the kit.
  - **Sign in with Apple** waits for an Apple developer account.

### Open: should the invitation link sign a first-time invitee in?

- **Today:** the invitation arrives by email, and the person then sets a
  password, or uses Google if their address is a Google account.
- **The option:** the invitation token, which was emailed to that address,
  signs them straight in (a server-minted sign-in), the way a magic link
  does. It's the smoothest path for couples and crew with no Google account.
- **Trade-off:** anyone the invitation email is forwarded to could sign in
  as that person, until it's accepted or expires. That's the same exposure
  as a magic link.
- **Recommended:** yes, single-use and expiring with the invitation, with a
  "not you?" line.

## Phases

| # | Phase | What | Notes |
|---|---|---|---|
| M0 | **Stop the bleeding (now)** | Fix the inquiry overflow; a "no horizontal overflow" check on every couple/crew route at 360/390/430 px; fix the mock-mode build that blocks e2e (`/studio/schedules` prerender) | Small. The overflow check is the guard the 09-13 pass lacked |
| M1 | **Foundation** | `tokens.json` → CSS vars; the mobile kit (above); a light public shell (also H5 1.5); studio white-label theming with contrast clamping; passwordless sign-in (Apple/Google/magic link) | Everything after builds on it |
| M2 | **Front door** | Inquiry in 3 steps (+ COI, H3), `/i` details + book a call, the invite/welcome screen | The screen that converts |
| M3 | **Booking** | Home, proposal + add-ons, Review & sign (H2), pay (Apple/Google Pay) | Proposal/sign content depends on H2 |
| M4 | **Planning** | Questionnaire stepper, timeline + approve sheet, chat, files + preview (H1) | |
| M5 | **After the wedding** | Your photos / Your film (H4), album, review | |
| M6 | **Crew** | Offer, Today, Jobs, **offline day sheet with shot list**, documents with camera, closeout, availability calendar, profile | Day sheet data: family formals and must-haves from the questionnaire |
| M7 | **Native — parked (web only for now)** | Capacitor app: push, deep links, Sign in with Apple, account deletion, camera, haptics, store listings | Needs Apple and Google developer accounts |

**Every phase ends with a walk on a real phone**: iPhone Safari and Android
Chrome, at 360/390/430 px, with the Dynamic Type size increased. Also check
screenshots at those widths in a guard test.

---

## Decisions — answered by Conor, 2026-09-28

1. **Brand:** couples see **the studio's** brand. "Powered by StudioCue"
   appears in the footer only.
2. **Stores:** **web app only for now.**
   - No Capacitor or Expo work yet, so M7 is parked.
   - The kit stays platform-neutral (tokens.json, component contracts),
     so a store app later isn't blocked.
   - Deep links and account deletion are still designed in.
3. **When there is a store app:** **one StudioCue app** with couple and crew
   modes, branded as the studio inside.
4. **Sign-in:** **passwordless** for couples and crew.
   - On the web now: Google and an emailed sign-in link.
   - Sign in with Apple is added when an Apple developer account exists. It
     becomes mandatory the day there is an iOS app.
5. **Order:** **foundation first.** M0 (the overflow fix + a guard) now, then
   M1, then the couple and crew parts of H1–H4 are built directly in the
   new kit. The studio-side work on H1–H4 is unaffected.
6. **Tabs:** 4 each.
   - Couple: Home · Plan · Messages · Files. Payments lives in Home's next
     step and in Plan.
   - Crew: Today · Jobs · Calendar · Me.

## The questions as they were asked (recommendation first)

1. **Whose brand does a couple see?** *Recommended:* the studio's, with
   "Powered by StudioCue" in the footer only.
2. **Getting into the stores:** *Recommended:* **Capacitor**, wrapping the
   mobile-first web, over rebuilding in Expo/React Native.
3. **One app or per-studio apps:** *Recommended:* one StudioCue app with
   couple and crew modes, branded as the studio inside.
4. **Passwordless for couples and crew** (Apple, Google, magic link; no
   12-character password): *Recommended:* yes.
5. **Sequencing:** *Recommended:* M0 now, then M1 **before** the H1–H4
   client/crew screens, so they're built once, in the new kit.
6. **Tabs:** *Recommended:* couple = Home · Plan · Messages · Files; crew =
   Today · Jobs · Calendar · Me.
