# StudioCue fix backlog — from the production walk (2026-09-04)

Source: `docs/ux-walkthrough-production-2026-09-04.md` (findings P1–P23).
Prioritised by user harm, then trust/money, then friction. Effort is rough:
**S** ≈ hours, **M** ≈ a day, **L** ≈ multi-day.

Guiding rule (from this walk): **every fix lands with a test/guard.** The two
worst findings (P15 P0, P17/P14 email triggers) were invisible precisely because
no test asserted the behaviour and the emulator has no real providers.

## Shipped
| ID | What | Status |
|---|---|---|
| **P15** | Optional provider (Dropbox) blocked the booking confirmation forever | ✅ fixed, deployed, verified live |
| **P18** | No SPF record → security mail junked on strict domains | ✅ SPF added + verified (`v=spf1 include:sendgrid.net ~all`) |

## Retracted
- **P16** — not a defect. The schedule editor correctly blocks publishing a
  conflicting run of show. Residual nit only: the AI drafter can emit a
  zero-duration item the studio must delete by hand (rolls into the P13 "AI
  drafter quality" item).

---

## Tier 1 — Critical: fix before real customers
Client-facing breakage, money correctness, or a misleading block.

| ID | Title | Effort | Group |
|---|---|---|---|
| **P17** | "Send the form" assigns the questionnaire but never emails the couple | S | Email triggers |
| **P14** | Studio-booked consultation sends the couple no confirmation | S | Email triggers |
| **P10** | Stripe Checkout restarts the 14-day trial instead of honouring the tenant's `trial_end` | S–M | Billing |
| **P2** | Signup can fail silently with "sent" and "could not send" on one screen; 36 callers hard-throw on an App Check failure | M | Auth first-run |
| **P12** | A declined OAuth (`error=access_denied`) is reported as a generic broken callback with the provider lost; "start again" can loop | M | Integrations |
| **P19** | Client portal has no durable sign-in; an expired-session couple is dead-ended at the moment they must pay/approve | M | Client portal |
| **P9** | Stripe Checkout + billing portal are branded "FlawlessIQ" (the first money screen names an unknown company) | S (Stripe dashboard) | Billing |

**Why these first:** P17/P14 mean a booked couple silently never hears about a
form or a consultation — the studio believes both were sent. P10 gives every
card-adder up to 24 free days (or re-grants 14 to an expired trial). P2 is the
first impression and can hard-block a studio on a corporate/VPN network. P12
blocks connecting a real integration behind a wrong error. P19 locks a paying
couple out of their own portal. P9 is a one-setting trust fix on the checkout.

**Email-trigger sub-theme (P17, P14):** both are "template exists, nothing
triggers it" — the same shape as the known-broken `final_payment_reminder` and
`contract_sent`. Do them together: wire the missing `send`/enqueue calls, then
add one guard that asserts every user-facing lifecycle transition queues its
declared email (so this class can't regress).

## Tier 2 — High: misleading or trust-eroding, not a hard block
| ID | Title | Effort | Group |
|---|---|---|---|
| **P4** | An owner whose verification mail never arrived has no way to resend it | M | Auth first-run |
| **P8** | Subscription page shows no trial-end date and speaks in tokens ("trialing · studio") | S–M | Billing |
| **P20** | The couple's schedule-"approval" path is dead code; `approvalState` is vestigial and the email says "review" but the portal offers nothing | M | Client portal |
| **P22** | A booked couple never appears in the Clients directory (no place to see or re-invite them) | M | Client portal |
| **P13** | The "personalized" inquiry reply opens "Dear Client" and ships a raw `[Studio Name]` placeholder; one-tap Approve from Today would send it | S–M | AI drafts |
| **P21** | Portal shows "Review contract" as the couple's next action for an already-signed contract | S | Client portal |
| **P23** | A cancelled job hides its reason and still lists live obligations + a readiness % | S–M | Lifecycle |

**Why:** these don't stop the flow but they confuse or embarrass — P20 caused a
real support loop in this walk ("I already approved it"), P13 would send a
client a letter with a `[Studio Name]` token in it, P22/P19 together leave the
client relationship unmanageable after booking.

## Tier 3 — Polish / friction
| ID | Title | Effort | Group |
|---|---|---|---|
| **P3** | Platform auth mail is dressed as tenant mail ("StudioCue · powered by StudioCue"); auth links are SendGrid click-tracked | S–M | Email |
| **P5** | Verified screen says "invited workspace", sends a signed-in owner back to sign-in, ignores `continueUrl` | S | Auth first-run |
| **P6** | "Sign in with your verified account first" fires for a session that is signed in (sync `currentUser` race) | S | Auth first-run |
| **P7** | Workspace created but the screen doesn't advance (double-submit risk) | S | Auth first-run |
| **P11** | Checkout doesn't prefill the customer email; offers Cash App/Klarna for a SaaS subscription | S (Stripe dashboard) | Billing |
| **P1** | Register form marks nothing as required | XS | Auth first-run |
| — | Timezone list differs: onboarding offers 6, settings offers 13 | S | Setup |
| — | AI run-of-show can emit a zero-duration item (P16 residue) | S | AI drafts |

## Suggested sequencing (grouped so each PR ships a coherent surface + its guard)
1. **Email triggers** — P17, P14 (+ the known `final_payment_reminder`/`contract_sent`), one delivery-trigger guard. *Highest harm, smallest code.*
2. **Billing** — P10 (trial_end), P8 (trial-end date + plain-language status), P9 + P11 (Stripe dashboard: public name, prefilled email, trimmed payment methods).
3. **Auth first-run** — P2, P4, P5, P6, P7, P1 as one pass over signup→verify→onboard.
4. **Client portal** — P19 (durable/magic-link sign-in), P22 (client directory + re-invite), P20 (delete the dead approval vestige or implement it), P21 (next-action attribution).
5. **Integrations** — P12 (read `error`, resolve provider from `state`, map `access_denied`, cap retries).
6. **Lifecycle + drafts + polish** — P23, P13, P3, timezone list, the zero-duration item.

## Cross-cutting recommendation
Most of these were invisible because the studio UI reported success while the
client/crew side got nothing (P15, P17, P14, P18). Add **delivery-state
surfacing**: show real SendGrid delivery status (delivered/bounced/deferred) on
client- and crew-facing sends, and flag a lifecycle step whose declared email
did not actually queue. That single capability would have caught four of these
findings at the source.

---

## Shipped 2026-09-04 (this pass)
Deployed to production (all functions + invoker script) and frontend rolled out
(verified by served bundle carrying the P2 change), all on `main`. Full gate
green: typecheck, 936 unit tests, lint (0 errors), Next build, functions build.

| ID | Fix | Where |
|---|---|---|
| **P17** | assignQuestionnaire enqueues `questionnaire_request` | planning/commands + email-triggers guard |
| **P14** | scheduleConsultation enqueues `consultation_confirmation`; consultation calendar step best-effort | booking/commands, provider-runtime |
| **P10** | Checkout honours the existing `trial_end`, no restart; expired trial re-grants nothing | stripe-checkout |
| **P11** (code) | Checkout prefills `customer_email` | stripe-checkout |
| **P8** | Plain-language status ("Free trial · Studio") + trial-end/renewal date | live-subscription |
| **P2** | Send-failure gets its own honest state, not the "we sent a link" screen | register-form |
| **P1** | Required marks on register fields | register-form |
| **P4** | Resend verification from the onboarding wall (session live) | onboarding-form |
| **P6** | authStateReady before reading currentUser | onboarding-form |
| **P7** | Terminal success + replace/refresh, no re-submittable form | onboarding-form |
| **P5** | Verified screen: no "invited" copy, honours continueUrl | verify-email-action |
| — | Timezone list unified with settings (13 zones) | onboarding-form |
| **P12** | OAuth denial reported specifically, provider resolved from state | integrations/oauth + integration-manager copy |
| **P13** | Inquiry-reply AI greets by name, no `[Studio Name]` placeholder | operations/ai-pdf |
| **P20** | Schedule email no longer promises a missing approval step | email-templates |
| **P21** | No stale "Review contract" next-action after signing | portal-experience |
| **P23** | Cancelled/on-hold job shows a neutral note + reason, not live obligations | live-project-detail |

## Deferred (with reason)
- **P19** (durable client portal sign-in) — a real feature (magic-link /
  passwordless), needs design + auth testing that shouldn't be rushed to prod.
- **P22** (booked couple absent from Clients directory) — a data-model change
  to how a booked client is registered/queried; needs the contact/client model
  worked out to avoid breaking the directory. Not a safe one-shot.
- **P9** (Checkout branded "FlawlessIQ") — Stripe Dashboard → public business
  name. Config, not code.
- **P11** (Cash App / Klarna offered) — Stripe Dashboard payment-method config.
- **P3** — auth-mail platform voice is a template refinement; the auth-link
  click-tracking is a SendGrid account/send setting. Low-severity polish.
