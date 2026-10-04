# StudioCue launch checklist — Monday 2026-10-05

Prepared Saturday 2026-10-03. Built from four parallel audits (the launch docs,
security and config, the public site and legal pages, the cold-start product
flows) plus live checks against production (`studiohub-prod`, studio-cue.com).

**Verdict.** The product and the infrastructure are ready. There are seven
must-dos before Monday. The biggest are legal (the Terms page is a draft) and
seeing failures (crashes are invisible today). The other gap is the date the
first 14-day trials end: **Oct 19**. What a studio sees after a card fails, or
after it stops paying, has never been exercised.

Legend: **Owner** = Conor / Counsel / Code (Claude can do it) / Gabe.

---

## 🔴 Before Monday — must do

| # | Item | Owner | Why |
|---|---|---|---|
| 1 | **Replace the draft Terms of Service.** `/terms` says "Draft for legal review… require final legal review before commercial use". It has about 130 words and no subscription, renewal, cancellation, refund, liability, governing-law or e-signature terms. It also lists Docusign and Twilio, which aren't in use. Signup says "By continuing, you agree to our Terms". | Counsel (Code to publish) | You'd be taking card signups under terms that say they aren't ready. |
| 2 | **Remove the Multi-Brand features that don't exist.** "API access" and "Advanced permissions and portfolio reporting" appear on `/pricing` and the homepage (`config/saas-plans.ts:46-47`). The code itself says the API "does not exist yet". | Code (10 min) | Selling a $299 plan on features that aren't built is a deceptive-advertising risk. |
| 3 | **Upgrade Next.js 16.2.12 → ≥16.3.6.** There's a critical RCE advisory in `/_next/image` (GHSA-2xp9-vwfh-vxw4). Realistic risk is low (Linux, local images only), but it's a minor bump. | Code | Critical, unauthenticated, on a public endpoint. |
| 4 | **Make failures visible.** The onboarding, Stripe, booking, proposal and contract commands catch every error and return 400 without logging. A real crash looks like a user mistake, and the "5xx" alert can never fire for them. The browser `NEXT_PUBLIC_SENTRY_DSN` isn't set. There's no `app/error.tsx`, `global-error.tsx` or `not-found.tsx`, so a bad URL shows the default Next 404. | Code | On day one you'd hear about a broken signup from a lost customer, not an alert. |
| 5 | **Do one real signup with a real card on prod,** then cancel and refund. Check: Stripe is in **live** mode, the 14-day trial starts, $0 is charged, the receipt arrives, the Customer Portal opens, cancel works, and the refund goes through. Only one tenant ("Walk Studio") has a real Stripe subscription today. GR and FlawlessIQ have none. | Conor | It's the one flow that takes money, and no doc records it working end to end. |
| 6 | **Stripe dashboard settings (10 min):** (a) failed-payment retries end in **cancel**, not "mark unpaid". The code turns `unpaid` into a fresh 14-day trial. (b) Customer emails are on for trial-ending reminders, failed payments and the card-update link. StudioCue sends none of these. (c) The portal allows switching plan. | Conor | These cover the parts of the subscription lifecycle the code doesn't. |
| 7 | **Account hygiene:** rotate every secret that was ever pasted into chat — step by step in `docs/runbooks/rotate-secrets.md`. Turn on MFA for Google Cloud/Firebase, GitHub, Stripe, SendGrid, Intuit, Zoom and Dropbox. | Conor | Public launch makes StudioCue a target. |

---

## 🟠 Before Oct 19 — when the first trials end

All Code, from the product audit. None of these ever runs before a trial ends or a card fails.

- [x] *(shipped 2026-10-04, b853de7 + 1440d561; proven on prod: held, released on reactivation)* **A lapsed or suspended studio keeps emailing and charging its couples.** No scheduler and no `sendEmail` checks subscription status. Reminders, final invoices and autopay charges carry on while the studio is locked out (`operations/jobs.ts`, `billing/autopay.ts:375`, `operations/invoice-scheduler.ts:76`).
- [x] *(1b08283: 7-day grace with a banner, then read-only)* **`past_due` locks the whole workspace at once,** while Stripe keeps retrying for weeks. Add a grace banner or read-only access (`features/subscriptions/entitlements.ts:74`).
- [x] *(1b08283)* **`unpaid` / `incomplete_expired` are treated as "incomplete".** That gives a second free trial and a second subscription (`functions/src/saas/stripe.ts:128-145`).
- [x] *(1b08283: ordered, cancelled-is-final, one transaction)* **The Stripe webhook doesn't check event order.** A late `subscription.updated` can resurrect a cancelled studio (`stripe.ts:470`).
- [x] *(1b08283; seen as staff in the emulator)* **Staff never see the billing gate.** `subscriptions` is readable by the owner only, so staff of a lapsed studio get a workspace where every action fails (`features/auth/workspace-context.tsx:322`).
- [x] *(6689728 + 58d9f36: asked before setup)* **A couple or crew member who signs in before accepting their invite** is routed to "Create your workspace", then to a card checkout (`features/auth/workspace-routing.ts`).
- [x] *(6689728; rules test proves the query now passes)* **Crew message threads are probably empty for crew.** The `crewMessages` query has no `projectId`, so the rules reject it silently (`components/crew/kit/crew-parts.tsx:183`). Check on prod as a crew member.

---

## 🟡 This week — should do

**Legal and trust**
- [ ] **Privacy policy (Counsel):** add the legal entity and postal address, a named subprocessor list (Google Cloud/Firebase, Vertex AI, Stripe, SendGrid, Intuit, Zoom, Dropbox), a cookies and storage section, a CCPA "we don't sell/share" statement, real retention periods, COPPA for minors, and the studio-as-controller / StudioCue-as-processor split.
- [ ] **E-sign consent v2 and certificate review (Counsel).** Signing is on for every studio; nine questions are in `docs/esign-consent-review.md`. Also have counsel look at the contract text StudioCue writes into every agreement (Schedule A lock, pricing clauses).
- [ ] **Written consent from Gabe** for the testimonial on `/`, `/about` and `/wedding-photographers`. Disclose free access if he has it (FTC endorsement rules).
- [ ] **Public inquiry form:** add a "Privacy" link. "Your details stay with {studio}" isn't quite true, because StudioCue and its AI process them (`components/crm/lead-intake-form.tsx:759,782`).
- [ ] **A postal address in the email footer** (CAN-SPAM).
- [ ] **A runbook for deletion requests.** `platform_approved` deletions are never processed, and the export leaves out Storage files and several collections (`functions/src/saas/data-lifecycle.ts`).
- [ ] **SaaS sales-tax decision** (Stripe Tax, or an accountant's advice). No decision is recorded. (Conor)

**Reliability**
- [ ] **Email delivery checks fail every hour.** `emailDeliveryReconciler` gets SendGrid `429` on every run (82 times in 72h). The SendGrid Event Webhook belongs to another product on a shared account, and got 0 calls in 7 days. So "opened/clicked" and bounce cards aren't updating. Fix: give StudioCue its own SendGrid subuser and webhook, and back the reconciler off. (Conor + Code)
- [ ] **The PDF service ran out of memory twice** in 72h (1 GiB limit, concurrency 4, max 4 instances). Raise it to 2 GiB or concurrency 1–2 before proposal volume grows. (Code)
- [ ] **The 250-record cap.** `app/api/studio/records/route.ts:66` limits *before* filtering by project. Once a tenant passes 250 emailJobs, messages or actions, screens silently show a random subset. GR's volume will hit this. (Code)
- [ ] **Turn on Firestore point-in-time recovery** (currently off). Daily and weekly backups exist. (Conor decides; Code)
- [ ] **No outreach to test addresses.** Skip `example.com` / `.test` addresses and check SendGrid's suppression list before sending, so studios "trying it out" don't hurt sender reputation. (Code)
- [ ] **Onboarding can show raw error codes** (Zod JSON, `APP_CHECK_…`) and doesn't limit the studio-name length (`functions/src/saas/onboarding.ts:317`). (Code)
- [ ] **No CI.** The rules tests only run by hand. Even a minimal GitHub Action on push to main would help. (Code)

**Security (no blockers; tighten)**
- [ ] **Rules still allow browser writes the app never makes:** `projects` (including `state`, `stateVersion`), `memberships`, all `tenants` fields, `contacts` and `users`. Set them to `if false` and run the rules tests (`firestore.rules:114-178`).
- [ ] **Per-IP limits use the first `X-Forwarded-For` hop,** which the client can forge. The Places route has no App Check either, so add a daily quota cap on the Places key (`app/api/functions/[functionName]/route.ts:134`, `app/api/public/places/route.ts:55`).
- [ ] **The Dropbox Sign webhook can be replayed.** Disable it, since native e-sign replaced it, or re-fetch the request from the API (`functions/src/booking/webhooks.ts:199`).
- [ ] **CORS:** remove `*.chatgpt.site` and `localhost` from production; add `studio-cue.com` (`functions/src/security/cors.ts`).
- [ ] **Branding storage path:** stop accepting SVG (`storage.rules:176`).
- [ ] **Run `npm audit fix`** in root and `functions/`. There are 9 high in root (sharp, fast-uri, nanoid, …), not exploitable in practice.
- [ ] **DMARC:** add a `rua=` reporting address now; move to `p=quarantine` once reports are clean.

**Housekeeping**
- [ ] **Four test tenants on prod:** "Zoom test trial", "Zoom test studio", "Test", "Walk Studio". Archive them so Console metrics are clean. Keep any Zoom's review needs.
- [ ] **Dropbox is still a development app** (500-user cap), with the folder named "Studiopilot". Apply for production. (Conor)
- [ ] **FlawlessIQ:** renew QuickBooks (every invoice is refused) and fix the reply sign-off ("Conor — GR Productions").
- [ ] **Give `/terms` and `/privacy`** their own titles, canonical tags and OG cards.
- [ ] **Update the stale docs:** `production-readiness.md` (magic link is live), `integration-production-readiness.md` (QuickBooks re-gate, Sentry), `manual-launch-checklist.md` §3/§5.

---

## 🟢 Verified today (evidence)

| Area | Check | Result |
|---|---|---|
| Deploy | Every function's deployed bundle checked one by one for the latest code (d606404, then 074aae1) | ✅ 98/98, including `operationsTaskWorker` |
| Deploy | App Hosting rollout matches `main` | ✅ SUCCEEDED (d606404 / 074aae1) |
| Rules | Deployed Firestore and Storage rules vs `origin/main` | ✅ identical |
| Data | Composite indexes | ✅ 108/108 READY |
| Data | Backups | ✅ daily (14d) + weekly (84d); latest snapshot 2026-10-03 04:01Z; delete protection on |
| Jobs | Cloud Scheduler | ✅ 26/26 enabled, none failing |
| Jobs | Last 7 days | ✅ emailJobs 97 sent / 0 failed · aiJobs 21/21 · pdfJobs 13/13 · provider dead-letters are only on test tenants |
| Errors | Runtime errors, 72h | ✅ nothing customer-facing, apart from the SendGrid 429s and the PDF memory limit above. The rest is deploy-quota noise. |
| Monitoring | Alert policies | ✅ operational error / Cloud Run 5xx / app unreachable, plus an uptime check, emailing conor@flawlessiq.com |
| Runtime | Modes | ✅ AUTH/DATA/PROVIDER/INTEGRATION all `live`, `PROVIDER_MOCK_MODE=false`, every `*_FUNCTIONS_URL` set |
| AI | Models | ✅ all Gemini 3.x; nothing depends on 2.5 (retires Oct 16) |
| Auth | Config | ✅ studio-cue.com and www authorized; email-enumeration protection on |
| Domain | TLS and redirects | ✅ certificate valid to 2026-12-29; www and http 301 to `https://studio-cue.com/`; homepage 0.12s |
| Email | DNS | ✅ SPF (SendGrid + Cloudflare), DKIM s1/s2, link branding (url5544), `inbound.` MX → SendGrid, support@ MX → Cloudflare routing |
| Webhooks | 7 days | ✅ QuickBooks 59×200 (Intuit webhook is registered and firing) · Stripe 3×200 · lead intake 14×201 |
| Site | 40 public routes and 57 sitemap URLs | ✅ all 200 in under 0.6s, all with titles, descriptions and OG images; robots.txt correct |
| Claims | Pricing and trial copy | ✅ $150/$1,500 and $299/$2,990 everywhere; "card required, nothing charged for 14 days" matches checkout |
| Claims | Integrations page | ✅ only what's live; SMS and Outlook marked "Coming soon" |
| Security | Secrets, admin, webhooks | ✅ no keys committed; provider secrets in Secret Manager; admin is a custom claim only; Stripe, Zoom, SendGrid and QuickBooks webhooks verify signatures and are idempotent |
| Product | Cold start | ✅ no dead end from signup → checkout → setup; abandoned checkout and late webhook recover; client automation is quiet by default |
| Product | Job kinds | ✅ family booked end to end on prod (inquiry → proposal → paid → Booked); sports paid-on-the-day works |

---

## ⚪ Later — known and accepted

- Acceptance pilot with real personas (GR is effectively the pilot).
- Google Gmail scopes (CASA). Forwarding covers this for now.
- Zoom summaries re-review (pending since 09-28). Meetings already work.
- Outlook, DocuSign, Dropbox Sign, Stripe Connect and SMS (deliberate holds).
- Firebase App Check enforcement on Firestore and Storage. Turn it on after watching verified-request traffic.
- Corporate agreement template and minors/sports advice (Counsel).
- Not walked on prod: crew accept and day sheet, couple-side withdraw, job-kinds event day / delivery / review (the sports test job is dated Oct 4).
- Welcome and trial email series (marketing phase 3).
