# Onboarding assessment — 2026-10-24

**Question:** is it easy to understand what setting up takes and what is
required, are the steps as few and as light as they can be, and does every new
studio get to working on jobs without stalling?

**Verdict before this pass: close, but a new studio could still stall in five
places, and two faults were silent.** The signup page's card disclosure was
unreadable, setup dropped six of the eleven kinds of work a studio said it
did, a verification link opened twice told a verified owner it had failed,
"Check your email" had no way forward, and setup offered five "do this first"
buttons at once without saying what any of them was needed for.

Walked end to end three times in the emulator (live auth, live data, real
functions; Stripe's webhook simulated by writing what it writes): a
photographer before the fixes, a photographer after, and a DJ after, at 1280px
and on a phone (375px). No production account was created: signup is a
card-required trial.

---

## The numbers (photographer, email signup)

| | Before | After |
|---|---|---|
| Screens, signup → setup | 5 + Stripe | 5 + Stripe, each one says "step n of 3" |
| Decisions on the studio form | 6 (trade drop-down, name, address, timezone, currency, where you heard) | 1 to type (name); trade is one tap; timezone and currency are one detected line |
| Buttons on the plan picker | 4 dark, equal | 1 dark, 1 light, one Monthly/Yearly switch |
| Dark buttons on setup at once | 5 | 1 (the next question) |
| Setup questions that say what they're needed for | 0 | all |
| Ways to bring existing bookings over from a new studio's screens | 1 (Jobs header) | 4 (setup, Today, Jobs header, Jobs empty list) |

## What a new studio hit (ranked by how likely it was to stop them)

### Stall or scare

1. **The card disclosure was grey on dark green.** Commit a8420715
   (2026-09-30) added `.booking-package-hint` *inside* the 270-selector
   "Secondary / metadata / body text" list in `app/legacy-bridge.css`. The 42
   selectors above it took the new rule's `margin: 10px 0 0; font-size: 13px;
   color: var(--ds-muted)` instead of their own `font-size: 12.5px`. On the
   sign-up and sign-in pages "Card required, nothing charged for 14 days" and
   "Back to StudioCue" went to `#545c66` on the green panel; every
   `.back-link` and `.avatar` in the app gained a 10px top margin.
   **Fixed:** the rule moved out, the group is one rule again, and a test
   holds it. The contrast spec now covers `/auth/register`, `/auth/login` and
   `/auth/onboarding`.
2. **"What do you shoot?" dropped six kinds without a word.** Setup offered
   eleven kinds and saved the trade's default form filtered to the ones
   ticked, but that form only has the original five. Ticking Bar & bat
   mitzvah, Quinceañera, Sweet 16, Communion, Prom or Vow renewal saved a form
   without them, under "Your inquiry form offers just these".
   **Fixed:** `features/setup/work-kinds.ts` adds each missing kind with its
   own "your day" fields; verified in the emulator (a photographer's form saved
   Wedding, Bar & bat mitzvah, Quinceañera, General question).
3. **A verification link opened twice said it had failed.** The first apply
   verified the address; the second (React's development double run, a work
   mail scanner opening the link first, a second tap) was refused and the page
   said "This verification link is no longer valid — sign in to request a new
   one" to an owner who was verified. **Fixed:** the code is applied once per
   page, and a refused code checks whether the signed-in account is already
   verified before saying anything; otherwise it says the link was used or
   expired and that the email may already be verified.
4. **"Check your email" had no way forward but "I've verified".** No resend
   (the only one was on the next page, unreachable without verifying), no way
   to correct a mistyped address, nothing to look for.
   **Fixed:** the subject to look for (read from the email template by the
   test), "Send it again" with the server's one-a-minute wait counted down,
   and "Wrong address? Start again".

### Slow or confusing

5. **Signup never said how long it was.** Now "1 Your account · 2 Your
   studio · 3 Start your trial" on the account form, the studio form and the
   plan picker.
6. **The studio form.** The trade drop-down cut "Photography or video" off
   under its arrow; the root cause was the grid forms' "top-align beside an
   address field" rule shrinking every field of the one-column signup form
   once the address joined it (2026-10-13). Timezone and currency were two
   required drop-downs for values that are detected. The button said "Start
   14-day trial" and the next screen asked to start it again. **Fixed:** trade
   as five one-tap choices, "Business name" for a vendor, timezone and currency
   folded into "Times in America/New York · prices in USD — Change", the
   button says "Continue", the fields are full width again.
7. **The plan picker** said "your trial hasn't started" four times, gave four
   equal dark buttons (Studio monthly / annual, Multi-Brand monthly / annual),
   put the teaser video above the plans (buttons below the fold on a laptop),
   showed the whole app's nav with every item locked, and its button did
   nothing visible for the second or more it takes to make a Checkout session.
   **Fixed:** one line with the actual date nothing is charged until, a
   Monthly/Yearly switch, one "Start free trial" per plan (the leading plan
   dark), the teaser under the plans, "Opening secure checkout…" while it
   works, and until the trial starts the shell shows only the brand, a note
   and Sign out (the phone tab bar hid Sign out with it).
8. **Back from Checkout** the page flipped to plan management (usage meters,
   "Choose the operating capacity your studio needs") for a second before
   setup. **Fixed:** "Your trial has started — nothing is charged until
   {date}", then setup.
9. **Setup** offered a dark button on every open question, said nothing about
   which could wait, showed an answered question as "StudioCue knows what you
   shoot" without saying what, left "How do inquiries reach you?" unanswered
   after the studio had finished a route's guide (it was recorded, never
   read), and its "Copy link" did nothing where the clipboard is refused.
   **Fixed:**
   - only the next question's button is dark, and it's marked "Next";
   - every open question says what it's needed for ("Needed for proposals",
     "Needed to book", "Optional");
   - answers are shown back ("Your inquiry form offers Wedding, Bar & bat
     mitzvah and Quinceañera", "Calls can be booked Mon–Fri, 9 AM–5 PM",
     "See your 2 packages");
   - a finished guide or a copied form link counts, and says "Set up. Waiting
     for your first inquiry", with "Send yourself a test";
   - StudioCue's form link lives in that question, and is shown to copy by
     hand when the clipboard says no;
   - "You don't have to finish first. Start a job / Import bookings" at the
     top.
10. **Today** asked "Get your inquiries in" again after a route was set up.
    Now "Waiting for your first inquiry" with the test.
11. **Bookings made before StudioCue** could only be brought over from a
    button on the Jobs page. Now also on setup, Today's empty "Coming up"
    and the empty Jobs list.
12. **Jobs** showed eleven kind filters to a studio with no jobs. It shows the
    kinds the studio has jobs in, and none when there is nothing to narrow.
13. **"Paste or upload your prices"** opened the import studio's marketing
    hero ("Bring your current business. Leave the retyping.", admin-hours
    stats) with the paste box below the fold, and the draft's list buttons
    read "Add pricing items item", "Add variables item". **Fixed:** opened for
    prices or a form it's "Add your prices" / "Bring in your details form",
    the upload box says what it wants, and the buttons read "Add a pricing
    item", "Add an option".

### Small

- Tab titles: the studio form read the marketing title, setup read
  "StudioCue". Now "Set up your studio" and "Studio setup".
- The sidebar said "studio plan" / "multi_brand plan". Now "Studio plan".
- An owner opening the verification link on a phone after making the studio
  on a laptop got an empty "Create your workspace" form. Now "Welcome back —
  Your studio is ready".
- Setup flashed "Done" on its first question before answers had loaded.
- "Creating your account…" while the account and link are made (a bare
  spinner sat for ~20s in the emulator).
- The plan picker's usage listener logged an uncaught permission error for
  every new studio (no counter document yet).
- The sign-up page still sold "a calm operating system"; it says what Cue
  does, as the sign-in page does.

## Still open (not built here)

- **The price import review is the heaviest step left.** After pasting a
  price list the studio meets "AI review workspace", "Template name",
  "Variables", "82% AI confidence", "25% of your setup can be drafted",
  "Split, merge, or ignore this draft" and "Human-gated activation". For the
  setup path it wants a plain "Here are your packages — check the prices"
  review. Recommend as the next piece of work.
- **The agreement question needs a real document.** Native signing makes the
  starter agreement editable, but its terms read "[Replace with your own …]".
  A guided "use the starter, fill in three paragraphs" path would make it
  answerable in one sitting. It is needed before the first booking, not
  before the first inquiry, which the chip now says.
- **Plan cards speak in features** ("2,500 AI actions", "COI workflows",
  "Advanced readiness reporting"). They're shared with the public pricing
  page and guarded by the marketing-claims test, so a rewrite should go with
  the site copy.
- **The manual package form marks 11 fields Required**, most pre-filled.
  A "More details" fold would show the three that need typing.
- **The verification email** says "Confirm that this email belongs to you
  before accessing a StudioCue workspace or portal". It could name the next
  step. Needs a functions deploy (render worker).
- **Not walked on production:** real Stripe Checkout, Google sign-in, real
  email delivery, and how long the verification email takes to send cold.
  The emulator walk simulated the Stripe webhook.

## Guarding it

`tests/onboarding-ux-2026-10-24.test.ts` (in `npm test`): what each question
is needed for per trade; only the next question's button is dark; a waiting
way in counts; every kind setup offers survives the save, for every trade;
answers shown back; the three signup steps; the resend, the typo route and
the real email subject; the single apply of a verification code; the
existing-owner state; the one-decision plan picker; the signup shell; the CSS
group being one rule; the full-width signup fields; the import list labels.
`e2e/contrast.spec.ts` now reads the three signup pages.
