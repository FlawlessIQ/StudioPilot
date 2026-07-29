# StudioCue Continuation Roadmap

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

### Stripe

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

Deferred enhancements, not pilot blockers:

- tenant-editable visual email designer and version history (the branded
  template catalog, preview, test send, scheduling, approvals, and history are
  implemented)
- deeper provider-specific diagnostic payloads after live certification reveals
  the support data each provider exposes
- dependency advisory remediation when compatible upstream Firebase releases
  are available

## Phase 7 — Scale architecture

Status: post-pilot; not a first-pilot blocker.

- migrate high-volume and delayed work from the Scheduler-backed durable poller
  to Cloud Tasks
- publish normalized domain events through Pub/Sub where multiple consumers
  benefit
- add dead-letter replay controls and queue-specific service objectives
- load-test email, webhook, document, AI, readiness, and reconciliation paths
- define capacity and cost thresholds for additional Cloud Run workers

Completion evidence:

- load-test results and cost envelope
- queue-level monitoring and replay evidence
- documented rollback path

## Sequencing rule

Do not enable a live provider merely because OAuth succeeds. A provider moves
out of mock mode only after its complete acceptance path, webhook idempotency,
reconciliation, permissions, error handling, and audit evidence pass.

The remaining launch-critical work is owner-led credential rotation and
provider-by-provider certification, followed by the clean-account acceptance
pilot. Product engineering can continue after pilot feedback, but it is no
longer the gating item for exercising the full lifecycle.
