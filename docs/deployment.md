# Production Deployment

StudioHub uses separate Google Cloud/Firebase projects for development and
production. Never copy `.env.local` into production.

## Provisioned production foundation

The production Firebase project is `studiohub-prod` (project number
`988256939236`). It is linked to a Blaze billing account and uses:

- Firebase App Hosting in `us-east4`
- Production URL:
  `https://studiohub--studiohub-prod.us-east4.hosted.app`
- Firestore Native, Standard edition in `nam7`
- Cloud Storage in `us-east1`
- Firebase Authentication with email/password enabled

Firestore and Storage rules and Firestore indexes are deployed from this
repository. Firestore delete protection is enabled. The initial App Hosting
release uses `NEXT_PUBLIC_INTEGRATION_MODE=mock` and `PROVIDER_MOCK_MODE=true`;
do not switch these to live until App Check, production Functions, Secret
Manager values, and provider callbacks have passed the release gate below.

The following production Google APIs are enabled:

- Vertex AI and the Gemini Developer API
- Cloud Functions, Cloud Run, Cloud Tasks, Cloud Scheduler, Eventarc, and
  Pub/Sub
- Firebase App Check and reCAPTCHA Enterprise
- Secret Manager, Cloud KMS, Certificate Manager, and IAM Credentials
- Cloud Build, Artifact Registry, Container Analysis, and On-Demand Scanning
- Cloud Logging, Monitoring, Trace, Error Reporting, and Profiler
- Google Calendar, Cloud Asset Inventory, Cloud Quotas, and Billing Budgets

Google-managed service identities are initialized for Vertex AI, Functions,
Eventarc, Tasks, Scheduler, and App Check. The Firebase web app is registered
with a domain-restricted reCAPTCHA Enterprise score key using a one-hour token
TTL and the default `0.5` minimum valid score. App Check enforcement remains a
release-gate action: enable it only after the hosted app and production command
endpoints successfully emit and validate tokens.

The App Hosting runtime is configured by `apphosting.yaml`. Its Firebase web
configuration is public client configuration, not a provider credential.
Provider secrets, OAuth refresh tokens, signing keys, and service-account
credentials must never be added to that file.

## Provisioning checklist

1. Create the production Firebase project, web app, Authentication providers,
   Firestore database, Storage bucket, and App Check application.
2. Enable Cloud Functions, Cloud Run, Cloud Tasks, Cloud Scheduler, Pub/Sub,
   Secret Manager, Cloud Logging, and Vertex AI.
3. Deploy Firestore indexes/rules and Storage rules before opening tenant
   registration.
4. Store provider credentials and token-encryption keys in Secret Manager and
   grant each runtime service account only the secrets it consumes.
5. Deploy Cloud Functions, including command, webhook, inbound-email, scheduler,
   billing, and platform-operation endpoints.
6. Deploy isolated Cloud Run document/AI workers with private invocation, CPU,
   memory, timeout, egress, and file-size limits.
7. Create Cloud Tasks queues with bounded exponential retry and dead-letter
   routing. Route normalized domain events through Pub/Sub.
8. Configure provider callback URLs and verify production webhook signing.
9. Configure the web runtime with Firebase public values, App Check,
   nonsecret function URLs, Sentry public DSN, and the production application
   origin.
10. Seed commercial Stripe products/prices deliberately; do not run the demo
    seed against production.

The included private services are `cloud-run/pdf` and
`cloud-run/file-safety`. Set `PDF_SERVICE_URL` and
`MALWARE_SCAN_SERVICE_URL` only after granting the Functions runtime identity
`roles/run.invoker`. Scanner unavailability is fail-closed.

## Required public endpoints

- Stripe webhook
- Docusign webhook
- QuickBooks webhook
- Dropbox webhook
- SendGrid inbound parse and event webhook
- Zoom webhook
- Google OAuth callback
- provider OAuth callbacks

Each endpoint must use its exact production URL, provider-specific signature
secret, narrow CORS policy where relevant, and idempotency storage.

Configure SendGrid Inbound Parse at
`https://REGION-PROJECT.cloudfunctions.net/sendgridInboundCoi?token=SECRET`.
COI reply addresses use `coi+REPLY_TOKEN@INBOUND_DOMAIN`; the shared URL secret
authenticates the provider while the hashed reply token resolves only one
insurance request. Attachments stay quarantined until the private scanner marks
them clean.

## Release gate

Before production promotion, run type checking, linting, unit/policy tests,
Firestore and Storage rule tests, Cloud Functions build, end-to-end tests, and
the production web build. Verify a test subscription, provider webhook replay,
dead-letter alert, support-access expiry, tenant isolation, backup restore, and
tenant export/deletion drill.

The legacy Sites connection metadata in `.openai/hosting.json` is retained for
traceability, but the production web application is deployed through Firebase
App Hosting from the GitHub `main` branch. Automatic rollouts are enabled for
new commits on that branch. The `dev:sites`, `build:sites`, and
`start:sites` scripts preserve local compatibility with that earlier runtime.
The primary `dev`, `build`, and `start` scripts use native Next.js for Firebase
App Hosting.

See [production-readiness.md](production-readiness.md) for the complete
activation checklist and known pilot limitations.
