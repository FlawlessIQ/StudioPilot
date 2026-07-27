# Production Deployment

StudioHub uses separate Google Cloud/Firebase projects for development and
production. Never copy `.env.local` into production.

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

This repository is connected to a Sites hosting project through
`.openai/hosting.json`. Publishing is a separate external action: source must be
pushed, saved as an immutable version, and only that version deployed. A local
milestone commit does not change production.

See [production-readiness.md](production-readiness.md) for the complete
activation checklist and known pilot limitations.
