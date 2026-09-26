# Onboarding assessment — 2026-09-26

**Question:** can a new studio set its workspace up easily, with no friction and
the fewest possible steps? And are the email connection options part of setup?

**Verdict: not yet. Signup is long, setup can't finish, and inquiry capture —
the thing that makes StudioCue useful on day one — isn't one of the setup
steps.**

Assessed from the code (file:line throughout) and a live look at
`/studio/setup` on production (Test studio). No account was created: signup is
a real, card-required trial.

---

## The numbers

| Stage | Screens | Fields | Clicks (min) | Notes |
|---|---|---|---|---|
| Signup → Today | 9 in-app + inbox + Stripe | 9 + card | ~9 | Signed out after register, signed in again after verifying |
| `/studio/setup` "4 questions" | 1 hub + 1 page per question | — | 2 (hours) to ~12 each (prices, form via import) | **Question 2 can't be answered by a normal studio** |
| Everything a studio needs | ~9 internal pages + Stripe, Google, builder/Gmail | — | **~50–70** | Across Today, setup, import ×2, settings ×3, integrations, subscription |

## Are the email connection options in setup?

| Connection | In `/studio/setup` | On Today (new studio) | Where it fully lives |
|---|---|---|---|
| Inquiry capture: website form / inbox filter / by hand | **Only the "forward by hand" strip** and a small "Capture every inquiry automatically" link (`setup-conversation.tsx:162`). Not a question; not counted. | **Yes**: "Get your inquiries in", all three routes in sheets (`today-inbox.tsx:486`). Hidden forever once any inquiry exists. | Settings → Inquiry capture |
| Hosted inquiry form link (`/inquiry?studio=…`) | "Your inquiry form is already live. Share this link", **but there's no link to copy**, only "Preview it" (`setup-conversation.tsx:164-180`) | Mentioned in copy only | Nowhere copyable |
| Google Calendar | **No** (a footnote link to "integrations") | No (only a Reconnect card after an error) | Settings → Integrations |
| Send from the studio's own address (Gmail/Outlook send, domain auth) | Not built | — | — (all mail is from `studio@studio-cue.com`) |
| Replies threading back | Nothing to set up (automatic) | — | — |

## What breaks or slows a new studio (ranked)

### P0: setup can't be finished
1. **The agreement question can never be answered by a default studio.**
   `hasAgreementTemplate` needs one of: a template picked in a card that
   is hidden while no signing app is offered (`agreement-template.tsx:156`),
   native signing (off unless an admin turns it on:
   `features/contracts/rollout.ts:12`), or a connected DocuSign/Dropbox Sign
   (neither is offered: `features/integrations/schema.ts:75-80`). So setup stops at
   **3 of 4 forever**, the Today setup card never goes away
   (`today-inbox.tsx:423`), and the step's button leads to an integrations
   page with nothing to connect. The copy also says "StudioCue doesn't write
   your contract", which is now false for studios with native signing.
   **Fix:** make the answer a choice: "I send my own agreement and record
   the signature" counts as answered. Native signing studios get the editor.
2. **Previewing the inquiry form creates a real lead.** `preview` isn't
   passed to the form (`app/inquiry/page.tsx:84-127`). A studio testing its own
   form creates a lead, which also permanently hides Today's "Get your
   inquiries in" card (`use-today-inbox.ts:287`).
   **Fix:** a studio preview submits as a test (not a lead), or is read-only.

### P1: the email connection isn't part of setup
3. **Setup never asks how inquiries get in.** It shows four questions and can say
   "set up" with no capture configured. The full three-route flow is on Today
   (until the first inquiry) and in Settings, not setup.
   **Fix:** make **"How do inquiries reach you?"** the first setup question,
   using the same three routes plus the hosted form. Mark it done when the
   first inquiry is captured (`lastCaptureAt`).
4. **"Share this link" has no link.** There is no copy button, full URL or embed
   snippet anywhere, and the Inquiry capture panel never mentions the hosted form.
   **Fix:** a Copy link control (full URL), and "Use StudioCue's form" as a
   fourth route in Inquiry capture.
5. **Calendar isn't in setup or next to consultation hours.** Hours are set
   with no offer to connect the calendar that decides whether they're free. The
   Calendar page says "Live calendar sync is unavailable right now" to a studio
   that never connected (`studio-calendar.tsx:553`).
   **Fix:** make question 4 "Calendar & consultation hours": connect Google
   (optional), accept Mon–Fri 9–5 in one click. Fix the page copy to say
   "Connect Google Calendar".

### P1: signup is longer than it needs to be
6. **Signed out after registering; sign in again after verifying.**
   (`register-form.tsx:114`, `verify-email-action.tsx:68`, `?verified=1`
   ignored.) **Fix:** keep the session and send the verify link to onboarding.
   Or add **Continue with Google**, which verifies email itself and removes 3 screens.
7. **The card is required before any value, and the marketing copy doesn't
   say so** ("No charge until it renews": `app/page.tsx:111`). The whole
   workspace is locked until Stripe is done (`app-shell.tsx:259`).
   **Fix:** say "Card required, nothing charged for 14 days" on the CTA, or let
   the owner reach setup before checkout.
8. **After checkout the owner lands on Today, not setup** (`live-subscription.tsx:57`).
   Setup has no nav entry. **Fix:** the first checkout lands on `/studio/setup`.
9. **Trial start depends only on the Stripe webhook, with no timeout or
   fallback** (`stripe-checkout.ts:83`). "Starting your trial…" can spin
   forever. **Fix:** `session_id` on the return URL, provision from it, and
   show a message after about 15s.
10. **Onboarding asks for things it could infer:**
    - legal name duplicates studio name (`onboarding-form.tsx:211`)
    - timezone defaults to New York from 13 options, not detected (`:10-24`)
    - currency defaults to USD, not inferred (`:232`)
    - the marketing plan choice is dropped and asked again as 4 buttons (`register/page.tsx:15`, `onboarding.ts:146`)

    **Fix:** studio name only; detect timezone and currency; carry the plan.
11. **Unverified users fill in onboarding, then get blocked and lose their
    input** (`onboarding-form.tsx:84-90`). The resend button can silently send
    nothing (60s cooldown: `emails.ts:106`). **Fix:** check verification on
    load, and show the cooldown.

### P2: going back and forth between places
12. **No way back to setup** after each step: import goes back to Library,
    settings back to the hub, integrations has no back link. **Fix:** `?from=setup`
    and a "Back to setup" link.
13. **Three checklists disagree:** setup (4), Today ("of 4"), and Help (5, including
    calendar and team, `setup-checklist.tsx:44-82`). `StudioDashboard` is dead
    code. **Fix:** one source (`useSetupState`), and delete the dead one.
14. **Import copy overpromises:** "paste your price list" pastes as an
    "Email journey", and "forward the form" has no forward option
    (`template-import-studio.tsx:66-90`). Imported forms are hard-coded as
    `wedding` (`review.ts:743`). Importing a "Contract" writes a template that
    nothing reads (`review.ts:721`).
15. **Same thing, many places:**
    - the studio name is entered in three places (onboarding, Studio details, Email branding)
    - Studio details promises a logo it doesn't have (`sections.ts:27`)
    - the From address (`studio@studio-cue.com`) is never shown
    - Email branding says "Replies go to your inbox" when they come back into Messages (`email-branding.tsx:374`)
16. **First Today mixes signals:** "Let's get you set up." above "Nothing is
    waiting on you." and three competing cards (`today-inbox.tsx:314,487`).
17. **The Inquiry capture route label overpromises:** "Wix, WordPress or Jotform:
    one setting" with an Easiest badge, when Jotform needs a paid plan and Wix is
    five steps.

## The shortest path we could offer

**Signup (target: 3 screens, 1 field, then card):**
1. **Continue with Google** (or email and password, staying signed in through verification).
2. Studio name. Timezone, currency and plan are inferred or carried over. Legal name moves to the agreement step.
3. Stripe Checkout (said up front), then land on **setup**.

**Setup: "Get your studio ready", five cards, each done in a sheet, with no page changes:**

| # | Card | Done when | Clicks |
|---|---|---|---|
| 1 | **How do inquiries reach you?** Website form / inbox / by hand / "use StudioCue's form" (copy link) | the first inquiry is captured, or the form link is copied | 3–8 + builder |
| 2 | **Calendar & consultation hours**: Connect Google (optional), accept Mon–Fri 9–5 | hours saved | 1–4 |
| 3 | **What do you charge?**: paste or upload | a package is active | ~6 |
| 4 | **How do clients sign?**: "I send my own" or native editor | a choice is made | 1 |
| 5 | **What do you ask couples?**: use the starter form or import your own | a form is active (a starter is seeded, so pre-ticked) | 0–6 |

Today keeps one card ("n of 5 done, next: …") until all five are done. Help's
checklist reads the same state.

## Status — 2026-09-26: shipped the same day

- **P0-1: agreement answerable.** "I send my own agreement" (`15b4aa1`).
- **P0-2: preview creates no lead** (`15b4aa1`).
- **3: inquiry capture is setup question 1,** answered in place (`a94da93`).
- **4: Copy link for StudioCue's form** on setup (`a94da93`).
- **5: calendar copy.** "Connect Google Calendar", not "unavailable" (`b8cad42`).
  Connecting from the hours question itself is still open.
- **8: land on setup after checkout,** and on comped signup (`b8cad42`).
- **10, partly:**
  - legal name dropped;
  - timezone and currency detected;
  - server validates the timezone (`b8cad42`);
  - the plan carried from the marketing site is still open.
- **12: "Back to setup"** on import, new package, settings sections and the agreement (`b8cad42`).
- **17: the route label no longer overpromises** (`a94da93`).
- **Found on the way:** twenty places where the build ran two words together
  (`d1a6374`, and `jsx-lost-space` now checks inline elements).

Still open: 6, 7, 9, 11 (signup), 13–16 (one checklist, import copy, names),
calendar connect inside the hours question, and the plan carried through signup.

## Suggested order

1. **Quick wins (≈1 day), no design decisions needed:**
   - the agreement "I send my own" answer (P0-1)
   - the preview-creates-a-lead fix (P0-2)
   - a Copy link for the hosted form (4)
   - land on setup after checkout (8)
   - "Back to setup" links (12)
   - Calendar page copy (5)
   - detect timezone and currency, drop legal name (10)
2. **Setup v2 (≈2–3 days):** the five cards above, with inquiry capture first,
   calendar next to hours, and one shared checklist (3, 5, 13).
3. **Signup (≈2 days):** stay signed in through verification, carry the
   plan, add a session_id fallback; then Continue with Google (6, 9, 11).
4. **Decide:** whether the card must come before first value (7).
