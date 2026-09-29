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

## M2 — done 2026-09-29 (23d9476, 33754d2, and the welcome-screen commit)

- **Inquiry form:** three steps (you, your day, your story), one field per
  row, and chips instead of selects. Each step is checked before the next
  opens. A refusal focuses its field, and a final refusal reopens the step
  that holds it.
- **Personal inquiry link and consultation invite:** kit screens with a
  shared day/time picker (`components/kit/slot-picker.tsx`). They no longer
  scroll inside a box, and cancelling asks in the page.
  - **Bug fixed:** the consultation invite printed times in the phone's time
    zone under a line saying they were the studio's.
- **Welcome screens:** the client and crew invitations are the studio's
  welcome, with the password field above the fold. `InvitationJoin` (all
  three invitation types) is kit markup; the staff page embeds it.
- **Tests:** `e2e/mobile-couple-inquiry-link.spec.ts` walks both booking
  flows at 390 px in Chrome and WebKit against stubbed scheduling
  responses. It blocks service workers: in WebKit a request through the
  app's worker skips `page.route`.
  - `e2e/client-invitation-flow.spec.ts` was stale. It followed a link
    removed when invitations took the password inline, and nothing had run
    it here. It's rewritten.
- **Waiting on a functions deploy** (`firebase login --reauth`): the
  studio's colour and logo in the scheduling and crew-invitation previews.
  Until then those pages use the default colour.
- **Not in M2:**
  - **The COI question** joins with H3, when the server can store it.
  - **The light public shell** is still open. The kit pages still load the
    app-wide CSS.

## M3 — done 2026-09-29

- **Portal frame:** the couple's portal is a kit shell with the studio's bar
  and 4 tabs (Home · Plan · Messages · Files). Rebuilt screens bring their
  own layout (`KIT_CLIENT_ROUTES` in `components/layout/portal-shell.tsx`).
  Every other client page renders unchanged inside a design-system wrapper
  (wider on a desktop) until its phase.
- **Home:** one next step (or "Reserve your date"), the countdown, and the
  journey. Records moved to Files.
- **Plan:** a new hub listing everything by stage (from the server's
  `navigation`), plus account, project switching and sign-out. It replaces
  the sidebar and the "More" drawer.
- **Proposal:** the decision is the sticky bar, with the total beside it:
  accept → confirm, or request changes (at least 10 characters). Add-ons
  show as lines after the package.
- **Agreement:** StudioCue's own signing keeps its logic and every word of
  consent. The document keeps its own sheet styles, and signing happens in a
  bottom sheet in the studio's colour. The Dropbox Sign / DocuSign handoff
  moved to the sticky bar.
- **Payments:** the amount due next leads, with one sticky "Pay $X
  securely" to the hosted invoice, then the schedule. Card autopay keeps
  its form for now.
- **Mock mode now has a project** (`features/client/mock-project.ts`), so
  Home and Plan can be walked. Accepting a proposal answers locally in mock
  mode.
- **Checked:** walked at 375 px. The native signing sheet was rendered via a
  temporary fixture (not committed); it had no padding, which is fixed.
  Phone guard plus M2 flows: 70/70 in Chrome and WebKit.
- **Suite rot:** a baseline run of the old suites on 1c44056 showed **15
  failing tests before M3**. These suites had never run here. M3 broke 3
  (proposal title size, the payments link name, and the inset check needing
  kit surfaces), and all 3 are updated. The 15 older ones are a separate
  task.

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

## M4 — done 2026-09-29

- **Questionnaire:** one section per screen, with progress, choice chips
  instead of `<select>`, and a review that lists what's still needed (tap
  one to jump to it). After sending, it becomes a read-only copy of what the
  studio has.
- **Three data-loss bugs fixed along the way:**
  - A save sent only the visible fields, and the server replaced the whole
    map. That wiped the studio's internal-only answers, and any answer
    hidden behind a condition, on every autosave. Now the client sends every
    answer, and the command merges them. The command also ignores a client's
    write to internal-only or locked fields.
  - The autosave after Submit set the status back to in progress. The form
    now locks after sending, and the command refuses a client save once it's
    submitted.
  - A fresh `{}` default re-ran the load effect, which put stored answers
    back over typing. Fields are no longer disabled during autosave, which
    was dropping the phone keyboard.
- **Timeline:** a vertical day in the wedding's own time zone, named on the
  page.
  - Approving happens in a sheet that names the version.
  - "Ask about this" on each moment starts a change request about that
    moment.
  - The portal now returns `changes_requested` versions. Before, the
    timeline vanished after a couple asked for changes.
  - The command only lets a couple answer a version that's in
    `client_review`.
- **Messages:** a chat with bubbles, day separators, and a composer pinned
  above the tabs.
  - No Subject field. The subject the studio's inbox needs is derived from
    the page the question came from, the studio message being answered, or
    the first line.
- **Files:** two lists: what the studio shared, then the booking's records.
  - Photos preview in a sheet.
  - PDFs open in the phone's own viewer, per the H1 mobile rule.
- **Checked:** walked at 375 px. 26/26 of the new and updated flows pass in
  Chrome desktop, Android Chrome and iPhone WebKit, and the phone guard
  passes on every route. Of the old spacing suite, one studio-only check
  (Reports/Leads panel insets on mobile) still fails; M4 doesn't touch those
  pages. The delivery critical path waits for M5.

## Claude's local UAT run — 2026-09-29

The UAT plan (https://claude.ai/artifact/6YceAoMyXeJ1heiCuqXgKh) was played
against the real app and the real Cloud Functions in the Firebase emulator.
Couples used iPhone WebKit and crew used Android Chrome, with the phone in
Los Angeles and the weddings in New York. Every outcome was checked in
Firestore too. Real iPhone Safari (iOS Simulator) was used for a visual check.

- **Result:** 45 of 45 runnable tests pass. 5 couldn't run here: the studio's
  inquiry-link and invitation flows (M2-2/3/4), iOS Text Size (X-2), and a
  couple choosing a package (M5-6, covered by the mock e2e).
- **The run found 13 real bugs.** All are fixed, and each has a guard in
  `tests/uat-local-run-2026-09-29.test.ts`:
  1. **Inquiry step 2 silently refused Continue** unless the couple tapped an
     event type. The Wedding chip looked selected, but the value was empty.
     Phase 1's no-defaults change caused it, and it was live on production.
  2. **A real couple saw demo data flash** ("Highlight film · RIVERA27")
     while their records loaded. Live mode started from the mock records.
  3. **Crew couldn't answer an offer in the app.** `respondAssignment`
     needed the project on their membership, which is only granted on
     acceptance. Now an offer addressed to them is enough, and acceptance adds
     the project.
  4. **With no signal, crew were sent to "Create your workspace · Start
     14-day trial".** Firestore answered "no memberships" from its cache. Now
     the server is asked before anyone goes to onboarding.
  5. **The day sheet didn't open with no signal**, despite saying it would.
     The sign-in check needed a network, and the saved copy was found only
     through the job list. There is now an offline pass for someone this
     phone already verified, the saved copy is found from the link, and the
     couple's brief (formals, do-not-photograph) is in it.
  6. **Multi-select questions rendered as a text box** in the kit
     questionnaire.
  7. **Proposal refusals read "could not be saved"**, because the generic
     error text ran before the proposal's own messages.
  8. **Signing out sent couples and crew to "Sign in to your studio"**, with
     "Start a free trial".
  9. **The loading screen told couples it was checking their "studio
     access".**
  10. **A crew save blanked the screen** ("Opening your work…") and lost
      "Saved.", because refresh flipped back to loading.
  11. **The camera and file buttons wrapped** ("Take a / photo") on a Pixel
      7.
  12. **The emailed-link confirm page was the old StudioCue page.** The logo
      and eyebrow overlapped, and the form sat halfway down the iPhone screen.
      It is now in the kit (seen in real Safari).
  13. **A new studio would have got an error, not onboarding,** after the fix
      for bug 4, because the server's "none here" answer was treated as a
      failure. Caught before shipping.
- **How to rerun it:** the scenario and runner live outside the repo (Claude's
  scratchpad). The recipe: fresh emulators, seed, add Jobs A/B/C with three
  couples and the seed's crew member, a production build with
  `NEXT_PUBLIC_CLIENT_MAGIC_LINK=1`, then a Playwright runner that verifies
  in Firestore.

## M6 — done 2026-09-29

- **Every crew screen is in the kit.** The shell has the studio's bar and 4
  tabs (Today · Jobs · Calendar · Me). The sidebar, the drawer and
  "Schedule & prep" are gone.
- **Today:** a "Next up" card (date, call time in the event's zone, venue,
  and a way in), then only what needs you: offers, a changed run of show,
  and hours owed.
- **Jobs:** compact rows in three groups (Offers, Coming up, Finished). An
  offer opens its own screen; any other job opens the job.
- **Offer:** when, where, the fee, a respond-by countdown, and what the job
  involves.
  - Accept and Decline sit in a sticky bar. Decline asks why in a sheet.
  - **Server:** `respondAssignment` takes an optional `reason`, stored as
    `declineReason`.
- **Job** (`/crew/prep`): prep, requirements and documents on one screen.
  `/crew/requirements` and `/crew/documents` redirect to its checklist.
  - Each checklist row has one action. Documents can go in with the camera
    ("Take a photo") or as a file.
  - The run of show can only be confirmed on the day sheet, against its
    version, as before.
- **Day sheet** (`/crew/schedule`):
  - Now/Next.
  - Where, with Go (directions).
  - Who to call, with Call (the studio's number when no contact is set).
  - The couple's brief: who not to photograph, the family formals and the
    must-haves.
  - Your role, and the running order in the event's zone.
  - A sticky "I've read version N".
  - The offline copy now keeps the whole brief, formals included.
- **Hours and expenses:**
  - Start and finish are clock times prefilled from the job, and a finish
    after midnight is handled (`features/crew/work-window.ts`).
  - Extra time is a stepper.
  - Expenses and links are lists you add to.
- **Calendar:** a month you tap. Mark a day (or a run of days) as free,
  maybe or away; booked jobs show as dots. Removing dates has an undo.
- **Me:** profile and account together. What you shoot and your
  specialties, areas and gear are chips. W-9 and insurance can go in with
  the camera. Sign out is here.
- **Emails and links:**
  - The "run of show published" email opens that job's day sheet.
  - An accepted invitation lands on the offer itself.
  - A studio reply opens the job.
- **Mock mode has a crew member** (`features/crew/mock-crew.ts`), with
  season-correct New York times.
- **Checked:** walked at 375 px. 132/132 phone flows (crew and couple) pass
  in Chrome, Android Chrome and iPhone WebKit, with the no-overflow guard on
  every route.
- **Not in M6:**
  - A notifications bell and push. Push waits for native.
  - Receipt photos on expenses. The closeout command has no attachment
    field yet.
  - Wiring up `crew_reminder`.
  - Showing the decline reason on the studio's side. It's recorded, not yet
    displayed.

## M5 — done 2026-09-29

- **Every couple page is now in the kit.** M5 also brought over the two
  left from M3: "Your event" (`/client/project`) and "Your package"
  (`/client/package`).
- **Your photos and film** (the portal half of H4):
  - Each delivery is its own card: photos, a highlight film, a sneak peek,
    newest first.
  - The code sits in a large copy box, and the button says what it opens
    ("Watch your film", "Open your gallery").
  - Expiry warnings show inside 14 days, and "I've downloaded everything"
    appears on photos only.
  - The host is worked out from the link (`features/post-event/link-host.ts`).
    So a Vimeo link that a studio pastes today already reads as a film with a
    password, before H4 records a media type.
  - The portal now passes H4's `mediaType`/`kind`/`label` through. Files
    names deliveries the same way (a film is no longer "Your gallery").
- **Album:** vertical steps. Approving a design, or asking for changes, is a
  sheet.
  - **Server fix:** a couple can now take only the step in front of them.
    Before, "approve" was accepted before any design was sent, and
    "revision" was accepted after approval (`ALBUM_STEP_NOT_AVAILABLE`).
- **Review:** a thank-you and one button, "Leave a review on Google".
  "I've left my review" stops the reminders. The studio-facing sentence
  about engagement tracking is gone.
- **Empty states in the right tense:** every kit screen's empty state goes
  through `components/client/kit/empty-moment.tsx`. The "this has passed"
  wording the old pages had (portal-stage / portal-day) is back on the M3–M4
  screens, which had lost it.
- **Copy:** "photographs" is gone from the couple's navigation and notices,
  because a video-led studio's couple is waiting on a film.
- **Still H4 (studio side):** a second release for the same job (photos,
  then the film weeks later) is still refused by `recordDelivery`. Until
  H4 slice 1 lands, a job gets one delivery.
- **Checked:** 111/111 couple flows pass in Chrome desktop, Android Chrome
  and iPhone WebKit, including the delivery critical path that had been
  failing since before M3.

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
