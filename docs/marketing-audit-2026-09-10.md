# Marketing Site Audit — 2026-09-10

Does the marketing copy (a) reflect what the app actually does now, and (b) sell
it well? Audited every public page against the current app. Evidence cited as
`file:line`.

**Verdict:** The hand-written core pages (features, for-clients, for-crew,
integrations) are genuinely strong and accurate — they sell the real
differentiator (evidence-gated operations, "AI drafts, people decide"). But
there are **two false/stale claims that must be fixed now**, a handful of
smaller drifts, and **one big selling gap: the flagship AI assistant, "Cue," is
never named anywhere on the site.**

## Accuracy — fix now

1. **"No card required" is false (P0).** The home hero proof points read
   "14-day trial · No card required · Guided setup" (`app/page.tsx:114`). The
   signup flow is a **card-required trial** — `functions/src/saas/stripe-checkout.ts:78`
   sets `payment_method_collection: "always"` and `card` payment type, and the
   gate blocks the workspace until Checkout completes. A visitor is promised no
   card and hits a card wall seconds later. Change to something true, e.g. "No
   charge for 14 days" / "Cancel before it renews."

2. **Home provider strip is stale (P0/P1).** Under "Works with the tools your
   studio already trusts" the home lists **Dropbox Sign** and **Stripe**
   (`app/page.tsx:268`). Both misrepresent the current app: Dropbox Sign is a
   deliberate hold (the `/integrations` page correctly badges e-signature
   "Coming soon", `app/integrations/page.tsx:66`), and Stripe is StudioCue's own
   subscription billing, **not** a studio-connected integration (QuickBooks is
   the invoicing/payment provider). The strip contradicts the corrected
   integrations page. Fix to the offered set — QuickBooks, Google Calendar,
   Zoom, Dropbox — optionally adding "e-signature (coming soon)."

3. **"Unlimited subcontractors" is inaccurate (P1).** For-crew claims
   "Unlimited subcontractors" (`app/for-crew/page.tsx:98`), but the plans cap
   **active** crew at 25 (Studio) / 100 (Multi-Brand)
   (`config/saas-plans.ts`, `features/subscriptions/entitlements.ts:28,40`), and
   the pricing page correctly says "up to 25 crew." The true, still-compelling
   point is that crew are **not billed per seat** (the 3 seats are internal
   users). Reword to "No per-seat billing for crew" and drop "unlimited," or say
   "up to 25 active crew on Studio."

4. **"SMS usage… billed separately" implies SMS exists (P2).** The home pricing
   note lists "SMS usage" as a separate cost (`app/page.tsx:323`), while
   `/integrations` honestly badges SMS "Coming soon" and says "Email carries all
   of it today." Drop SMS from the separate-costs line until it ships.

5. **Verify the round-number claims (P3).** Features asserts "Six points … will
   not move on a click" (`app/features/page.tsx:30`) and "Twelve things happen
   without you" (`:96`); for-crew's comment cites "Twenty-one commands." Confirm
   against `evidenceControlledProjectTransitions` and the scheduler set, or
   soften to "the moments that cost money." (The "four things AI can't touch" —
   payment, signature, permission, readiness — is correct.)

## Selling — the gaps

1. **The AI is anonymous — name Cue (P0 for positioning).** In-app the assistant
   is **"Cue"**: a nav pillar, the surface that answers "how do I…", the thing
   that prepares your next step. The marketing site describes it functionally
   ("it reads the certificate, drafts the run of show", "Prepared by StudioCue")
   but **never names or brands it** across any page. That's both an
   inconsistency (a new signup meets "Cue" they were never introduced to) and a
   missed differentiator — the prepare-and-approve assistant is the story, and
   it's nameless. Introduce Cue by name on the home hero and features, and let
   the "It prepares. You approve." line belong to it.

2. **Industry pages are much shallower than the core pages.** Weddings,
   corporate, and sports are three terse noun-list cards each (e.g. sports:
   "Coordinate organizations, teams, crews, and delivery safely.") next to the
   mechanism-rich, hand-written features/for-clients/for-crew pages. They read
   like placeholders. Either invest in them (real, specific scenarios per
   segment) or fold them into one strong "Industries" section — right now they
   under-sell.

3. **Navigation inconsistency (P2).** The subpage nav has an "Industries" link
   that points only to `/wedding-photographers` (not a hub), while the home nav
   omits "Industries" entirely (`components/marketing/marketing-layout.tsx:26`
   vs `app/page.tsx:66`). Corporate/sports are reachable only via the footer.

4. **No social proof — understandable, but plan for it.** No testimonials,
   outcome metrics, or logos (there are no customers yet). Fine today; note that
   the reference operator (GR Productions) is exactly the first case study to
   capture once live.

5. **Generic connective tissue.** The footer tagline "Calm operations for
   remarkable photography teams" and eyebrows like "Provider-connected
   operations" / "Photography operations OS" are buzzword-leaning; the
   home/features body copy is far stronger. Tighten the labels to match.

## What's strong (keep)

- **Features, for-clients, for-crew, integrations** are accurate and
  well-written — they sell the evidence-gated model honestly ("A job cannot be
  marked booked by mistake", "It keeps working when a provider does not",
  "record a signature taken any other way and the booking proceeds"). This is
  the real, defensible pitch and it matches the app.
- **Pricing is accurate** — Studio $250/mo·$2,500/yr, Multi-Brand $399, and the
  seat / AI-action / crew-cap / feature claims all match `planEntitlements`.
- **The integrations page** already reflects the offered set and the deliberate
  signing hold correctly (it was fixed earlier).

## Suggested order of operations

- **Immediate copy fixes (small, high-value, squarely "reflect the app"):**
  #1 "No card required", #2 home provider strip, #3 "unlimited subcontractors",
  #4 SMS line. All are one-to-few-line edits; the home page deploys via an app
  rollout.
- **Positioning pass:** name Cue on the home + features; decide the fate of the
  industry pages; fix the Industries nav.
- **Later:** GR Productions case study once the pilot runs.
