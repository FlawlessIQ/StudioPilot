# Production status

**Current as of October 4, 2026.** The single answer to "what is live, what is
held, and what is still open". `production-readiness.md`,
`integration-production-readiness.md` and `manual-launch-checklist.md` are the
history that led here; where they disagree with this page, this page is right.

StudioCue (operated by FlawlessIQ LLC) is in commercial operation from October
5, 2026: public signup with a card-required 14-day trial, Studio $150/month and
Multi-Brand $299/month, on `studio-cue.com` (Firebase App Hosting, project
`studiohub-prod`, functions in `us-east4`).

## Legal

Live at `/legal`: Terms of Service 1.0, Privacy Policy 2.0, Data Processing
Addendum, Acceptable Use Policy, Cookie and Browser Storage Notice, Client and
Crew Terms, Electronic Signature Disclosure and Consent (v2), Subprocessors and
Copyright Policy — all effective October 5, 2026. Signup records the Terms and
Privacy versions accepted. DMCA designated agent registered (DMCA-1081859,
renew by October 4, 2029). Counsel review is owed; the package is
`docs/counsel/2026-10-05-v1/` (regenerate with
`npx tsx scripts/legal/export-counsel-package.ts`).

## Billing and access

One rule decides what a studio may do (`features/subscriptions/access.ts`,
mirrored in functions):

| Subscription | Access | Client mail, bills and charges |
| --- | --- | --- |
| trialing, active | full | sent |
| past due < 7 days | full, with a banner | sent |
| past due ≥ 7 days, unpaid, paused | read-only: open jobs and export, nothing sent or changed | held (`held_billing`), released on reactivation |
| cancelled < 30 days | read-only | held |
| cancelled ≥ 30 days, incomplete, suspended | closed | held |

Stripe is the source of truth; `stripeWebhook` applies events in order (a late
event never revives a cancelled subscription) and a studio that has had a
Stripe subscription never gets a second trial. **Stripe dashboard settings
(Conor):** retries end in cancel; trial-ending and failed-payment emails on;
the customer portal allows plan switches; statement descriptor "STUDIOCUE".

## Integrations

Offered (`offeredProviders`): Google Calendar, Outlook and Apple calendars,
Zoom, QuickBooks Online (invoices and QuickBooks Payments), Dropbox. Native
e-signature is StudioCue's own and on for every studio.

Held, implemented but not offered: DocuSign, Stripe Connect client invoicing.
Dropbox Sign is retired (its callback endpoint was removed on October 4).

Waiting on others: Zoom's re-review of meeting summaries; Intuit approval for
QuickBooks Payments autopay merchant accounts; Google's Gmail (CASA)
verification.

## Monitoring

Alerts email the operations channel for:
- any operational error or dead-lettered job;
- Cloud Run 5xx;
- the app being unreachable;
- an unexpected command failure (`<function>_unexpected`, metric
  `studiocue_command_unexpected`);
- more than ten browser errors in ten minutes (`client_error`, reported to
  StudioCue's own `/api/client-errors` — no third-party error tracker).

The delivery-status checker backs off when SendGrid rate-limits it.

## Security posture

- Browsers write nothing directly except a person's own activity stamp; every
  change goes through a command that checks identity, membership, role, the
  subscription and the request, and is audited.
- Rate limits and signing evidence use `x-fah-client-ip`, which App Hosting
  sets to the connecting client and overwrites whatever a client sends
  (measured 2026-10-04); `X-Forwarded-For` can be forged in front and ends
  in Google's own addresses.
- Functions are private (invoker IAM, re-applied after every deploy by
  `scripts/configure-production-function-invokers.sh`) and accept browser
  origins only from StudioCue's own domains.
- Public branding images are PNG, JPEG or WebP only.
- App Check (reCAPTCHA Enterprise) on studio and portal calls.

## Deploying

The order and the checks are in `CLAUDE.md` ("Working on main"): typecheck,
tests, lint, build and the functions build; functions first, then the
invokers script and a bundle check, then an explicit App Hosting rollout
verified by commit. GitHub Actions runs the same checks on every push
(`.github/workflows/ci.yml`).

## Open

- Counsel review → v1.1 of the legal set.
- Rotate the secrets ever pasted into chat; MFA on every provider console.
- A SendGrid subuser so StudioCue gets its own Event Webhook.
- Firestore point-in-time recovery (off).
- DMARC reporting, then `p=quarantine`.
- The Dropbox production app.
- A project-level daily quota on the Places API.
