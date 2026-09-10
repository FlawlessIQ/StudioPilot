# Marketing Site Update — Plan (2026-09-10)

Follows the audit (`marketing-audit-2026-09-10.md`) and these decisions:
e-signature stays **"coming soon"** on `/integrations` (removed from the home
strip); **weddings leads** the industry story with corporate/sports as a
secondary mention; **Cue is named prominently.** Concrete, page-by-page.

## 1. Home — `app/page.tsx`

**Accuracy fixes**
- **Proof points (`:109–119`)** — replace the false "No card required." The
  trial *is* card-required. New three: "14-day trial · No charge until it
  renews · Guided setup" (or "Cancel anytime before it renews").
- **Provider strip (`:268`)** — drop **Dropbox Sign** and **Stripe**; show the
  four connectable today: **QuickBooks · Google Calendar · Zoom · Dropbox.**
  (E-signature's "coming soon" lives on `/integrations`, not in a strip headed
  "tools your studio already trusts.")
- **Separate-costs note (`:322`)** — drop "SMS usage" (SMS is coming soon):
  "Provider subscriptions, assisted migration, and implementation services are
  billed separately. StudioCue does not charge a percentage of client
  payments."

**Name Cue**
- **Hero badge (`:88`)** — from "It prepares. You approve." → **"Meet Cue — it
  prepares, you approve."**
- **New "Meet Cue" section** (place near the readiness story): a short beat that
  gives the assistant a name and a face. Draft:
  > **Meet Cue, your studio's second brain.**
  > Cue reads the questionnaire and drafts the run of show, writes the client
  > email in your voice, and tells you plainly what isn't ready and why. Ask it
  > "how do I book a client?" and it walks you through it. It never records a
  > payment, completes a signature, grants a permission, or passes a readiness
  > check — those stay with you. **Cue prepares; you approve.**
- Rename the "AI that tells you what needs doing" card (`:54`) to lead with the
  name, e.g. **"Cue tells you what needs doing."**

## 2. Features — `app/features/page.tsx`

- Rebrand the "AI drafts. People decide." section (`:87`) as Cue by name:
  title → **"Cue drafts. You decide."**, opening line → "Cue will write the
  schedule, read the insurance certificate, and tell you what looks wrong…"
  Keep the four-things-it-can't-touch list (accurate).
- Verify the round numbers: "Six points … will not move on a click" (`:30`) vs
  `evidenceControlledProjectTransitions`, and "Twelve things happen without
  you" (`:96`) vs the scheduler set. Correct the count or soften to "the
  moments that cost money."

## 3. Integrations — `app/integrations/page.tsx`

- **No change to the e-signature entry** — keep "Coming soon · Dropbox Sign and
  DocuSign are built and being readied… record a signature any other way and
  the booking proceeds." (Per decision.)
- Rebrand the "AI, built in" entry (`:98`) as "Cue, built in" for consistency.
- Everything else is accurate; leave it.

## 4. For-crew — `app/for-crew/page.tsx`

- Fix "Unlimited subcontractors" (`:98`): the true point is no per-seat billing.
  New: **"No per-seat billing for crew"** with sub "Your team's three seats are
  the plan; bring in up to 25 active crew on Studio at no extra charge." (Aligns
  with pricing's "up to 25 crew.")

## 5. Industries — weddings leads

- **Weddings (`app/wedding-photographers/page.tsx`) becomes the flagship
  industry page.** Deepen it beyond three noun-list cards: a real hero, the
  wedding lifecycle as StudioCue runs it (inquiry → consult → proposal → booking
  gate on signed contract + retainer → planning/questionnaire/COI → crew
  cascade → event → gallery → review), and where Cue helps at each step. Add one
  line: "Also built for corporate and sports photography →" linking those pages.
- **Corporate & sports** — leave the existing pages as lighter, secondary
  destinations; do not invest further now. Reachable from the weddings page and
  the footer.
- **Nav/IA** — resolve the inconsistency: use a single primary label **"For
  weddings" → `/wedding-photographers`** in both the home nav and the subpage
  nav (replacing the "Industries → weddings-only" mismatch). Corporate/sports
  stay in the footer.

## 6. Pricing — no change

Accurate to `planEntitlements`. Leave as-is.

## Sequencing

1. **Accuracy + Cue (one pass, one rollout):** home fixes (card, strip, SMS) +
   name Cue on home/features/integrations + for-crew crew line + feature-count
   check. Small, high-value, verifiable.
2. **Weddings deepening + nav:** the larger copy investment; own pass.
3. Later: corporate/sports depth and a GR Productions case study once the pilot
   runs.

## Open wording choices (yours to tweak)

- Exact trial proof-point wording ("No charge until it renews" vs "Cancel
  anytime").
- The "Meet Cue" section copy above is a first draft in the product's voice —
  adjust to taste before it ships.
