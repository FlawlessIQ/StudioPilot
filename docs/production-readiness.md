# Production Readiness

This repository includes a deployable pilot architecture, but production
activation is an operational release process—not a source-code flag. Keep
`NEXT_PUBLIC_INTEGRATION_MODE=mock` until the checks below pass in a dedicated
non-production Firebase project.

## Implemented hardening

- verified-email registration and idempotent, server-authorized tenant onboarding
- role-aware route boundaries for studio, client, crew, and platform surfaces
- live tenant-scoped lead/project/dashboard reads with explicit preview fallbacks
- OAuth Authorization Code + PKCE for Calendar, Zoom, Dropbox, Docusign, and QuickBooks
- OAuth refresh-token rotation in Secret Manager; refresh tokens never enter Firestore or the browser
- real provider job consumers with bounded exponential retry, dead-letter state, and stable provider idempotency identifiers
- daily final-invoice scheduling and overdue projection
- private Cloud Run PDF generation and Vertex AI structured COI extraction
- SendGrid Inbound Parse handling with unique COI reply tokens
- quarantine-first file flow: allowlisted type, signature check, ClamAV scan, then AI processing
- tenant export with paginated collection reads and expiring signed download links
- deletion cooling-off, cancellation, completed-export prerequisite, and platform approval
- time-bounded audited support summary access
- web and function Sentry envelopes containing operational codes/tags rather than business document payloads
- PWA manifest, service worker, offline fallback, and cached event-day schedules

## Release gates requiring external configuration

1. Provision separate development and production Firebase/Google Cloud projects.
2. Create the private PDF and file-safety Cloud Run services and grant only the Functions service account invocation rights.
3. Create all OAuth applications, provider webhook registrations, Stripe products/prices, SendGrid Inbound Parse domain, Twilio sender, and Sentry project.
4. Store every server secret in Secret Manager and bind least-privilege runtime service accounts.
5. Configure App Check enforcement, verified domains, Authentication email templates, OAuth callbacks, resource selection, and production origins.
6. Run provider sandbox certification with real payloads, including exact Docusign Connect and QuickBooks change-notification configurations.
7. Configure alerts for dead letters, webhook/scanner failures, quota exhaustion, and provider reauthorization.
8. Perform backup/restore, export, deletion, incident-response, and support-access drills.
9. Obtain legal review for contracts, insurance language, privacy/retention, SMS consent, and workflows involving minors.

No provider credential, payment instrument, signature, insurance approval, or
legal determination is supplied by this repository.

## Known pilot limitations

- Several secondary list/detail/report screens still use representative preview
  datasets when a live query has not been connected. Enable only live-complete
  workflows for an initial customer.
- SendGrid/Twilio delivery-event ingestion, exhaustive provider reconciliation,
  physical erasure after the deletion approval chain, and a tenant-configurable
  communications template editor remain release work.
- Cloud Scheduler is the current durable job poller. Cloud Tasks and Pub/Sub are
  the recommended high-volume scale step.
- File safety requires current ClamAV definitions. Scanner unavailability is
  intentionally fail-closed.
- The dependency audit reports inherited moderate `uuid` advisories through
  Firebase Admin’s Google Cloud dependencies. Track the upstream update rather
  than forcing an incompatible Firebase downgrade.

## Promotion sequence

Promote one immutable, verified revision. Deploy rules/indexes first, then
private workers, Functions, and the web application. Run the smoke suite in mock
mode, provider sandboxes, and finally live mode. Never reuse local environment
files or demo credentials.
