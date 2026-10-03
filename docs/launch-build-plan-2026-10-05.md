# Launch build plan — Monday 2026-10-05 and the Oct 19 trial-end

Turns `docs/launch-checklist-2026-10-05.md` into an ordered build. Two dates
matter:

- **Monday Oct 5, launch.** Legal wording is final and published, pricing is
  honest, and a failure can't go unseen.
- **Monday Oct 19, the first 14-day trials end.** Every subscription state a
  studio can reach (trialing → active, past_due, unpaid, cancelled, suspended)
  behaves correctly, for the studio and for its couples.

**Legal approach (Conor's call, 2026-10-03).** Claude drafts every legal text
to a production standard. Conor signs off and it ships as **Version 1.0,
effective 2026-10-05**. Counsel reviews the whole package in the weeks after
launch (§6). Any change counsel makes ships as v1.1, with notice to studios.
Each page states its version and effective date, and signup records which
version a studio accepted.

**Owners:** **C** = Claude builds · **Conor** = only Conor can do it ·
**Counsel** = after launch.

---

## 0 · Decisions (Conor, today) — the legal drafts are blocked on 0.1–0.4

| # | Decision | Recommendation |
|---|---|---|
| 0.1 | Legal entity that operates StudioCue, and its postal address | Needed for Terms, Privacy, the email footer (CAN-SPAM) and Stripe |
| 0.2 | Governing law and venue | The state the entity is formed in; courts there, small claims allowed |
| 0.3 | Refunds | No refunds for partial periods; cancel any time and keep access to the end of the paid period. Annual plans: full refund if cancelled within 14 days of the first annual charge |
| 0.4 | Does Gabe/GR pay full price? | If not, the testimonial must say "GR Productions has complimentary access" (FTC). Get his written OK either way |
| 0.5 | Grace period after a failed card | 7 days of full access with a banner, then read-only (view and export, no sending) until Stripe cancels |
| 0.6 | What a lapsed studio's couples get | Client emails and charges pause while the studio is past_due beyond grace, unpaid, cancelled or suspended. They are held, not dropped, and resume if the studio reactivates |
| 0.7 | SaaS sales tax | Turn on Stripe Tax for US states where you register; confirm with an accountant. Not launch-blocking |
| 0.8 | Browser error reporting | Send browser errors to our own `/api/client-errors` → Cloud Logging → the existing alert. No Sentry account needed (`SENTRY_DSN` has no value today) |

---

## 1 · Legal wording — Monday (C drafts → Conor signs off → C publishes)

| # | Deliverable | What it covers |
|---|---|---|
| 1.1 | **Terms of Service v1.0** (`app/terms/page.tsx`, full rewrite) | Parties and eligibility · accounts and seats · **subscription and trial** (14 days, card required, auto-renewal, how to cancel, refunds per 0.3, price-change notice) · acceptable use · the studio owns its content and its clients' data; StudioCue processes it on the studio's behalf (data-processing section, so no separate DPA for v1) · **AI features** (drafts only, the studio approves everything sent, no reliance on accuracy) · **e-signatures** (StudioCue provides the tool under ESIGN/UETA; the studio is responsible for its agreement's content and is the contracting party with its clients; StudioCue is not a party) · payments (StudioCue is not a payment processor and never holds client funds; QuickBooks and Stripe terms apply) · third-party integrations · minors (sports and family: the guardian is the client; no child accounts) · availability (no SLA) · warranty disclaimer · limitation of liability (12 months' fees) · indemnity · suspension and termination (30-day export window, then deletion) · changes to terms (30 days' notice by email) · governing law (0.2) · contact. **Removes:** the "Draft for legal review" banner, and the Docusign and Twilio mentions. |
| 1.2 | **Privacy Policy v1.1** (`app/privacy/page.tsx`, additions) | Entity and address · roles (controller for studio accounts, processor for studios' clients) · a named **subprocessor** list (links to 1.3) · **cookies and browser storage** · US state rights, including "we don't sell or share personal information" and how to exercise rights · **retention periods** (account life + 30 days; backups up to 84 days; logs 30 days; deleted jobs purged per the per-job purge) · children/COPPA (no accounts under 18, no data from children directly, guardians manage releases) · deletion process and timing · US hosting |
| 1.3 | **Subprocessors page** (`/subprocessors`, new; in the sitemap and footer) | Google Cloud/Firebase, Vertex AI (Gemini), Stripe, SendGrid (Twilio), Intuit QuickBooks, Zoom, Google Calendar, Dropbox, Cloudflare (email routing). Purpose, data and location for each |
| 1.4 | **Signup consent and record** | The register page says "By starting your trial you agree to the Terms and Privacy Policy, and authorize StudioCue to charge your card when the trial ends unless you cancel." The trial checkout repeats the charge date and amount. Store `termsVersion`, `privacyVersion` and `acceptedAt` on the owner and tenant when the workspace is created |
| 1.5 | **Couple-facing notice** | Inquiry form: "{Studio} uses StudioCue to manage inquiries. StudioCue privacy policy." (link). Replace "Your details stay with {studio}". Add a privacy link in the client portal footer |
| 1.6 | **Email footer** | Entity and postal address on every client and studio email (`functions/src/communications/email-templates.ts`) |
| 1.7 | **Pricing honesty** | Remove "API access" and "Advanced permissions and portfolio reporting" from Multi-Brand (`config/saas-plans.ts:46-47`). Re-check every feature bullet on `/pricing` and `/` against what ships |
| 1.8 | **Testimonial** | The disclosure line per 0.4 on `/`, `/about` and `/wedding-photographers`. Conor holds Gabe's written consent |
| 1.9 | **Page hygiene** | Proper titles, canonical tags and OG for `/terms`, `/privacy` and `/subprocessors`; version and effective date at the top of each |
| 1.10 | **Deletion runbook** (`docs/runbooks/data-deletion.md`) | How a deletion request is handled by hand until the automated path exists, matching the promise in 1.1/1.2 |
| 1.11 | **Guard tests** | Pricing bullets must map to real entitlements. `/terms` must not contain "draft". The terms version shown matches the stored `termsVersion` |

---

## 2 · Platform safety — Monday (C)

| # | Item |
|---|---|
| 2.1 | **Next.js → ≥16.3.6**, plus `npm audit fix` (non-breaking only) in root and `functions/`. Full gate and prod smoke test |
| 2.2 | **Unexpected errors are logged and alerted.** In `saas/onboarding`, `saas/stripe`, `booking/commands`, `booking/proposals`, `contracts/commands` and `booking/public-scheduling`: known business codes stay 400; anything else does `logger.error` and returns **500**, so the existing Cloud Run 5xx alert fires. Add a log-based alert on onboarding and billing errors |
| 2.3 | **Browser errors reported** (0.8): `error-reporter.tsx` posts the message, stack and route to `/api/client-errors` (rate-limited, no personal data), which logs at ERROR. Alert on a spike |
| 2.4 | **Branded `app/not-found.tsx`, `app/error.tsx` and `app/global-error.tsx`**, with a support link |
| 2.5 | **Onboarding errors in plain words** (`friendlyError`), and `maxLength={120}` on the studio name |
| 2.6 | **Deploy chain:** functions deploy-all announced to peer sessions → invokers → every bundle checked by marker → App Hosting rollout verified by commit |

## 3 · Conor — Monday

| # | Item |
|---|---|
| 3.1 | Sign off §1 drafts (Saturday night / Sunday) |
| 3.2 | **After §1 and §2 are live:** one real signup with a real card on prod → trial starts, $0 charged, receipt arrives, portal opens, cancel works, refund. Claude watches the logs and records the evidence |
| 3.3 | **Stripe dashboard:** retries end in **cancel**; customer emails on (trial ending, payment failed, card-update link); portal allows plan switches; statement descriptor reads "STUDIOCUE"; confirm live mode |
| 3.4 | Rotate secrets that were ever pasted into chat (Claude lists them and redeploys after) |
| 3.5 | MFA on Google Cloud/Firebase, GitHub, Stripe, SendGrid, Intuit, Zoom and Dropbox |
| 3.6 | Gabe's written consent for the testimonial (0.4) |

**Launch-day watch (C, Mon):** errors, 5xx, signups, Stripe webhooks and email sends, every two hours; anything new is triaged at once.

---

## 4 · Subscription lifecycle — by Oct 19 (C; build Oct 6–9, prove Oct 12–16)

| # | Item |
|---|---|
| 4.1 | **One access rule, everywhere** (`features/subscriptions` + `functions/src/saas/entitlement-guard.ts`): trialing/active = full; past_due within grace (0.5) = full plus a banner; past_due beyond grace and unpaid = read-only; cancelled = read-only for 30 days (export), then closed; suspended = closed |
| 4.2 | **Client outreach pauses with the studio** (0.6): one check in `sendEmail`, `autopayScheduler`, `finalInvoiceScheduler`, the event/contract/form/review/album reminder schedulers and the crew offer. Jobs are **held**, not dropped, and released on reactivation |
| 4.3 | **Status mapping:** `unpaid` → past_due (read-only after grace), `incomplete_expired` → cancelled. Never a second trial; a returning customer goes to the portal (`stripe.ts:128-145, 275, 321`) |
| 4.4 | **Webhook ordering:** store the last applied `event.created`; skip anything older (`stripe.ts:470`) |
| 4.5 | **Staff see the billing state:** the bootstrap route returns the subscription status to every member; the gate shows "Ask the studio owner to update billing" |
| 4.6 | **Invitees never land in "Create your workspace":** check pending client/crew invitations by email before routing to onboarding, including after Google sign-in |
| 4.7 | **A lapsed studio can still export** its data (let the export route past the gate) |
| 4.8 | **In-app trial notice:** a banner 3 days before the trial ends, with the date and amount (Stripe sends the email, 3.3) |
| 4.9 | **crewMessages query** gets `where("projectId", …)`; checked on prod as a crew member |
| 4.10 | **Tests and proof:** unit tests per state × surface; then on prod, a test tenant driven through trial-end, payment failure, grace, read-only, reactivation and cancel, using `trialEndOverride` and Stripe's test card in a test-mode run of the webhook handler. Evidence recorded in the checklist |

## 5 · Reliability and security — by Oct 19 (C unless noted)

| # | Item |
|---|---|
| 5.1 | **The 250-record cap:** filter by project in the query, not after `.limit(250)` (`app/api/studio/records/route.ts:66`) |
| 5.2 | **PDF service:** 2 GiB memory, concurrency 2 |
| 5.3 | **Email delivery status:** back the reconciler off on 429. **Conor:** create a SendGrid subuser for StudioCue so it gets its own Event Webhook; C wires and verifies it |
| 5.4 | **Test-address guard:** never send to `example.com` / `.test` / `.invalid`; check SendGrid suppression before sending |
| 5.5 | **Rules:** set browser writes to `projects`, `memberships`, `tenants`, `contacts` and `users` to `if false` (the app doesn't use them); rules tests plus new adversarial cases; deploy rules |
| 5.6 | **Rate limits:** use the trusted hop of `X-Forwarded-For`; App Check plus a daily quota cap on the Places route |
| 5.7 | **Disable the Dropbox Sign webhook** (native e-sign replaced it) |
| 5.8 | **CORS:** remove `*.chatgpt.site` and localhost from prod; add studio-cue.com |
| 5.9 | **Storage:** no SVG on the public branding path |
| 5.10 | **Firestore point-in-time recovery on** (Conor approves the small cost) |
| 5.11 | **CI:** GitHub Action on push — typecheck, unit tests, rules tests, functions build |
| 5.12 | **DMARC:** add `rua=` reporting; `p=quarantine` after two clean weeks (**Conor**, DNS) |
| 5.13 | **Dropbox production app** application and folder rename (**Conor**) |
| 5.14 | **Archive the four test tenants** (keep what Zoom's review needs) |
| 5.15 | **FlawlessIQ:** renew QuickBooks; fix the reply sign-off (**Conor**) |
| 5.16 | **Update the stale docs** (`production-readiness`, `integration-production-readiness`, `manual-launch-checklist`) |

---

## 6 · Counsel package — weeks of Oct 12–26 (Counsel)

One folder for counsel, prepared by C on Oct 9:

1. Terms of Service v1.0 and Privacy Policy v1.1 (as published), plus the subprocessor list.
2. E-sign consent v2 and the signing certificate, with the nine questions in `docs/esign-consent-review.md`.
3. The contract text StudioCue writes into studios' agreements: starter agreement, Schedule A (including the lock clause), pricing and payment-schedule clauses, amendments.
4. Couple-facing notices (inquiry form, portal) and the email footer.
5. Open questions: arbitration vs courts, auto-renewal state laws (CA/NY reminders), whether a standalone DPA is needed for larger studios, minors/sports, sales tax.
6. A change log template: counsel's edits ship as v1.1 with 30 days' email notice where the terms require it.

---

## Timeline

| When | What |
|---|---|
| **Sat Oct 3** | Decisions §0 · C drafts §1.1–1.6 for sign-off · C builds §1.7, §1.9, §1.11 and §2.1–2.5 |
| **Sun Oct 4** | Conor signs off §1 · C publishes and deploys (§2.6) · Conor: 3.2–3.6 |
| **Mon Oct 5** | **Launch** · launch-day watch |
| **Oct 6–9** | §4.1–4.9 built and deployed · §5.1–5.4 · counsel folder ready |
| **Oct 12–16** | §4.10 prod proof · §5.5–5.16 |
| **Oct 16** | Gemini 2.5 retires (prod is already on 3.x — no action) |
| **Oct 19** | First trials end — watch the conversions, failures and emails live |
| **Oct 12–26** | Counsel review → v1.1 if needed |
