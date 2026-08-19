# StudioCue Continuation Roadmap

This document tracks launch operations, provider certification, and production
readiness. The workflow-led product and AI roadmap derived from the July 29,
2026 photographer interview is
[`studiocue-product-ai-roadmap-2026-07-29.md`](./studiocue-product-ai-roadmap-2026-07-29.md).

StudioCue is pilot-capable, but not yet launch-complete. The core product and
deterministic operating model are implemented. The remaining roadmap prioritizes
real-provider certification, a complete clean-account pilot, and operational
launch readiness before adding more broad product surface area.

Detailed provider-console and business-owner steps are maintained in
[`manual-launch-checklist.md`](./manual-launch-checklist.md).

## Phase 1 — Credential and environment safety

Status: Secret Manager architecture and runtime bindings implemented. Rotation of
credentials that appeared outside Secret Manager remains an owner action.

Launch gate:

- rotate every SendGrid, Stripe, Dropbox, Google OAuth, Zoom, Docusign,
  QuickBooks, Twilio, and webhook credential that appeared in chat, screenshots,
  logs, or another non-secret channel
- store replacement server credentials only in Google Secret Manager
- revoke exposed credentials and confirm browser bundles contain no server
  secrets
- keep unfinished providers in mock mode until their acceptance suite passes

Completion evidence:

- credential inventory and rotation record
- current Secret Manager versions bound to least-privilege runtime identities
- exposed provider credentials revoked

## Phase 2 — Provider certification

Status: production adapters, OAuth, webhook normalization, reconciliation,
health reporting, idempotency, retry, and failure visibility implemented. Live
acceptance with each provider account remains pending.

### SendGrid

- authenticate the sending domain and production From address
- configure signed Event Webhook and Inbound Parse
- test delivery, bounce, deferral, open, click, unsubscribe, branded invitations,
  password recovery, and COI attachment handling
- validate tenant logo, accent color, reply-to address, and message copy

### Google Calendar

- select the production calendar
- test availability, conflicts, consultation create/update/cancel, reminders,
  and production event-date blocking

### Zoom

- promote the app to production and verify least-privilege scopes
- test meeting create/update/cancel, waiting room, authorized start URL, and
  disabled recording

### Dropbox

- complete production approval with App Folder access
- test root selection, booking folders, upload, replacement, temporary links,
  COI archiving, and reconciliation

### Docusign

- configure production OAuth, webhook HMAC, and approved templates
- test signer ordering, resend, decline, void, completion certificate, completed
  document download, Dropbox archival, and duplicate webhook delivery

### QuickBooks Online

- connect the production company and map products and tax codes
- test customer matching, retainer and final invoices, hosted payment links,
  partial payments, refunds, voids, reconciliation, and duplicate webhooks

### Stripe (platform billing only)

Studios paying StudioCue. Distinct from per-studio client payments, which is
future scope — see "Stripe Connect: studio-managed client payments" below.

- verify the $69 Solo, $199 Studio, and $399 Multi-Brand monthly products and
  their annual equivalents
- configure the Customer Portal and approved proration, cancellation, tax, and
  refund policies
- complete one controlled live subscription, entitlement update, cancellation,
  and refund

### Twilio

- complete sender and A2P/10DLC registration where applicable
- verify consent, STOP/HELP, quiet hours, limits, and delivery events
- keep SMS disabled until the acceptance evidence is complete

Completion evidence:

- provider-specific acceptance records
- healthy integration status in StudioCue
- normalized webhook events and reconciliation results
- `PROVIDER_MOCK_MODE=false` only for providers that passed

## Phase 3 — Clean-account end-to-end pilot

Status: application journeys and automated regression coverage implemented.
The live, clean-account acceptance run remains pending provider certification
and human sign-off.

Run the complete lifecycle using new production identities and non-critical
business records:

1. register, verify email, subscribe, and configure a studio
2. invite staff and validate role boundaries
3. submit an inquiry and convert it into a project
4. schedule a Google Calendar and Zoom consultation
5. select a package and create its immutable snapshot
6. draft, approve, generate, send, view, and accept a proposal
7. complete Docusign and pay a QuickBooks retainer
8. pass the booking gate once and verify Calendar and Dropbox side effects
9. activate the client portal and complete a questionnaire
10. add vendors and complete the COI review and delivery lifecycle
11. invite crew, accept an assignment, and acknowledge the current schedule
12. generate, review, approve, publish, and export a run of show
13. verify deterministic readiness and authorized waivers
14. create and reconcile the final invoice
15. record delivery, send review requests, close the project, and export records
16. confirm reports, audit events, failed-job recovery, and subscription usage

Completion evidence:

- owner, coordinator, photographer, client, and subcontractor sign-off
- no unresolved severity-one or severity-two defects
- audit record for every authoritative transition
- documented fixes and regression coverage for issues discovered during pilot

## Phase 4 — Production operations and security

Status: source controls, audit trails, retry/dead-letter visibility, tenant
export/deletion flows, Sentry hooks, and deterministic authorization are
implemented. Alert destinations, MFA enforcement, drills, and business approval
remain operational actions.

- configure Sentry for web, Functions, and Cloud Run
- configure uptime, error-rate, dead-letter, quota, provider reauthorization,
  billing, and budget alerts
- enforce MFA for all administrative accounts
- review IAM and platform-super-admin claims
- execute backup restore, tenant export, and deletion rehearsals
- enable App Check enforcement after supported browser and PWA verification
- validate scanner definition updates and fail-closed document processing
- approve incident response, credential rotation, support access, tenant
  suspension, and breach-notification runbooks

Completion evidence:

- successful alert test
- successful restore drill
- successful export and deletion rehearsal
- security and access review signed off

## Phase 5 — Brand, domain, policy, and legal launch

Status: pending business decisions and professional review.

- connect the final production domain
- finalize StudioCue and pilot-tenant email identities, logos, reply-to
  addresses, support details, review URLs, timezone, currency, and tax settings
- obtain legal review of Privacy, Terms, subscriptions, cancellation, contracts,
  electronic signatures, COI language, retention, deletion, subcontractors, and
  insurance representations
- obtain specialist advice before enabling sports workflows involving minors
- approve customer-support and data-retention policies

Completion evidence:

- verified domain and authenticated email identity
- approved legal documents and policies
- recorded retention and deletion settings

## Phase 6 — Product hardening executable without provider approval

Status: completed for the pilot release.

Delivered:

- deterministic lifecycle authority and evidence-controlled transitions
- event-driven, versioned workflow execution with conditions, idempotency,
  approval queues, retries, and dead-letter handling
- AI-assisted inquiry analysis, questionnaire review, schedule risk analysis,
  COI extraction, and permission-scoped operational Copilot
- public consultation self-scheduling, package selection, proposal approval,
  contract/retainer booking gates, and client-portal progression
- a branded communications center with manual, scheduled, automated, and
  approval-gated delivery
- schedule-version change impact, renewed crew acknowledgements, and participant
  notifications
- role-aware daily priorities, conversion reporting, operational reliability,
  and transparent time-saved estimates
- responsive desktop/mobile route coverage across studio, client, crew, guest,
  and platform administration surfaces
- server-authorized client/crew access, strict Storage/Firestore rules, and
  authoritative AI guardrails

Completion evidence:

- strict lint, type, unit, security-rule, optimized build, and serialized
  end-to-end checks
- production deployment and immutable revision smoke results recorded in
  `build-progress.md`

Additional internal hardening completed:

- tenant-editable visual email designer, secure test sends, immutable version
  history, activation, and rollback
- provider health latency, credential-vault presence, scope, webhook,
  reconciliation, failed-job, and recommended-action diagnostics
- compatible dependency remediation and a documented residual advisory policy

## Phase 7 — Scale architecture

Status: internal implementation complete; production scale evidence continues
to accumulate during provider certification.

- [x] migrate high-volume and delayed work from the Scheduler-backed durable
  poller to Cloud Tasks, retaining the poller as a recovery transport
- [x] publish normalized domain events through Pub/Sub with an auditable outbox
- [x] add dead-letter replay controls and queue-specific service objectives
- [x] add bounded load tests for email, webhook, document, AI, readiness, and
  reconciliation paths
- [x] define capacity and cost thresholds for additional Cloud Run workers

Completion evidence:

- load-test results and cost envelope
- queue-level monitoring and replay evidence
- documented rollback path

## Open gaps in shipped integrations

Found on August 19, 2026 while filming the Google OAuth verification demo.
Neither is a new provider integration and neither needs provider approval — the
Google Calendar connection already carries the scopes required. They are listed
separately from Phase 6 because that phase is closed, and separately from future
scope because the integration they belong to is already live in front of clients.

### Consultation cancel and reschedule

**Missing entirely.** There is no `cancelConsultation` or
`rescheduleConsultation` command, no provider job type for it, and no calendar
mutation anywhere: `functions/src/operations/provider-runtime.ts` contains zero
`DELETE` and zero `PATCH` calls, and the only Zoom meeting endpoint used besides
create is `GET /meetings/{id}/meeting_summary`. The absent UI is a symptom — the
server-side capability does not exist.

To build:

- `cancelConsultation` and `rescheduleConsultation` on `bookingCommand`, with
  the consultation status transition and an audit event
- a provider job that issues `PATCH /calendars/{id}/events/{eventId}` to move an
  event and `DELETE` to remove it, plus `PATCH`/`DELETE /meetings/{id}` for
  zoom-mode consultations
- client notification, because the client holds a confirmation email and a Zoom
  join link that must stop being valid
- UI on the studio calendar and the consultation detail surface

Note when this lands: `app/privacy/page.tsx` and the Google `calendar.events`
scope justification both currently state that StudioCue does **not** modify or
remove entries after creating them. Both must be updated in the same change, or
the disclosure becomes an understatement rather than an overstatement.

### Google Calendar inbound sync

**Missing entirely.** No `events.watch` channel, no `syncToken` polling, and no
`google-calendar` route under `app/api/webhooks/` — the directory holds
docusign, dropbox-sign, quickbooks, sendgrid, stripe, stripe-connect, and zoom.
The integration is strictly one-way, so a studio that deletes a consultation in
Google Calendar leaves StudioCue showing the slot booked and the client
confirmed. That divergence has client-facing consequences and is the more
serious of the two gaps.

To build:

- an `events.watch` channel per connected calendar, and a webhook route plus
  Function to receive the push
- channel renewal on a schedule, since Calendar push channels expire
- incremental `events.list` with a stored `syncToken`, because Google's push
  notification does not say what changed
- a reconciliation sweep, since push delivery is at-least-once and can be missed
- no new OAuth scope: `events.watch` uses the scopes already granted

**Design constraint.** Google must not be treated as authoritative over
bookings. `docs/booking-gate.md` already establishes that provider events are
evidence and humans decide, and COI extraction leaves `humanDecision` pending
for the same reason. An event disappearing from a studio's calendar should raise
a discrepancy for the owner to resolve — not silently cancel a consultation a
client has already been sent a confirmation for. Auto-cancelling on an inbound
delete would be the easy implementation and the wrong one.

## Future integration scope

### Stripe Connect: studio-managed client payments

Not launch-critical, and deliberately not started: it requires Connect platform
onboarding on the FlawlessIQ Stripe account, which is a business-model decision
rather than a configuration step.

**Why it is worth doing.** The value is not "accept cards" — it is evidence for
the booking gate. `RETAINER_PENDING → BOOKED` is evidence-controlled under
`booking_gate` authority, and `docs/booking-gate.md` requires the retainer
invoice paid to zero balance, stating that "invoice links, views, and StudioCue
UI actions do not establish payment. Provider webhooks and reconciliation are
the evidence sources." Today the only provider that can supply that is
QuickBooks. When it is absent, `booking-gate-service.ts` satisfies the condition
through `retainerExceptionApproved` and records the source as
`approved_exception` — a human attestation. Bookings still work; they are
systematically downgraded from verified evidence to an override.

A payments provider is also the better evidence source in principle. QuickBooks
knows an invoice was *marked* paid; Stripe knows money *moved*. For the gate
that commits a studio's calendar date, the latter is stronger.

**What already exists**, so this is not greenfield:

- the Connect OAuth path in `functions/src/integrations/oauth.ts`, complete
  apart from `STRIPE_CLIENT_ID` — `config()` reuses `STRIPE_SECRET_KEY` as the
  token-exchange secret, the exchange omits `redirect_uri` for Stripe, and the
  callback reads `stripe_user_id` as the account id
- `providerCapabilities` already lists `stripe: ["invoicing"]` alongside
  `quickbooks`, so capability routing can choose between them per tenant
- the live Connect invoice webhook and signing secret are configured and
  deployed

**What is missing:** the platform onboarding decision, the per-studio connect
UX, invoice/payment reconciliation against connected accounts, and the
surfacing of refunds, disputes, and failed payments.

**Constraint to preserve.** Connect **Standard** accounts with direct charges —
the "build a platform" shape, not "build a marketplace". Each studio connects
its own Stripe account and client money lands with the studio, matching the
"studio owns the account" posture the code comments already state and keeping
FlawlessIQ out of funds custody. A marketplace shape would route client money
through the platform and is a materially different regulatory position.

**Honest costs.** Money movement brings a support burden the product does not
have today: refunds, disputes and chargebacks, failed and retried payments, and
payout questions from studios. `application_fee_amount` on direct charges would
make this a monetisation surface as well, but that is a pricing decision and
should not be smuggled in as a technical one.

### QuickBooks: second evidence source, not a replacement

Whichever provider lands first, keep both wired. They are alternatives in the
capability map, and the booking gate is the product's most consequential
transition — a single provider outage should degrade it to an override, not
block it. Tonight's Intuit failure is the argument: one provider down, and every
booking silently falls back to `approved_exception`.

## Sequencing rule

Do not enable a live provider merely because OAuth succeeds. A provider moves
out of mock mode only after its complete acceptance path, webhook idempotency,
reconciliation, permissions, error handling, and audit evidence pass.

The remaining launch-critical work is owner-led credential rotation and
provider-by-provider certification, followed by the clean-account acceptance
pilot. Product engineering can continue after pilot feedback, but it is no
longer the gating item for exercising the full lifecycle.
