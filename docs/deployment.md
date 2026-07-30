# Production Deployment

StudioCue uses separate Google Cloud/Firebase projects for development and
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
repository. Firestore delete protection is enabled. Firebase Authentication and
Firestore-backed product data are live. External providers remain isolated in
mock mode with `NEXT_PUBLIC_PROVIDER_MODE=mock` and
`PROVIDER_MOCK_MODE=true`.

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

The organization policy does not permit anonymous `allUsers` IAM bindings.
Core HTTP Functions therefore remain private Cloud Run services. The App
Hosting runtime service account alone has `roles/run.invoker`, and browsers call
the allowlisted same-origin `/api/functions/[functionName]` proxy. The proxy
obtains a Google service identity token, while the Function separately verifies
the forwarded Firebase user token and App Check evidence. Do not disable the
Cloud Run invoker IAM check on application APIs.

Firebase Function revisions reset service-level invoker policies in this
organization. After every production Function deployment, run:

```bash
./scripts/configure-production-function-invokers.sh studiohub-prod us-east4
```

The script grants the App Hosting runtime account access only to browser-facing
application APIs and grants the Functions runtime account access only to the
declared Scheduler-backed services.

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
7. Deploy the Cloud Tasks dispatcher/worker Functions and Pub/Sub domain-event
   Functions. Firebase creates their managed transport resources; confirm the
   `studiocue-domain-events` topic and task worker metrics after deployment.
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

The checked-in `functions/.env.studiohub-prod.example` contains only nonsecret
runtime boundaries and worker URLs. Copy it to the ignored
`functions/.env.studiohub-prod` before a production Functions deployment.
Provider credentials must remain Secret Manager bindings.

Run `npm run secrets:provision` to create the production secret containers and
resource-level Functions access without adding any values. Credentials are
entered directly in Google Cloud, and `npm run secrets:status` verifies
existence, enabled-version counts, and access without reading values. See
[production-secrets.md](production-secrets.md) for the complete inventory,
credential-entry workflow, and rotation procedure.

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

Configure SendGrid Inbound Parse at the App Hosting boundary:
`https://studiohub--studiohub-prod.us-east4.hosted.app/api/webhooks/sendgrid/inbound?token=SECRET`.
The route preserves the raw multipart body and authenticates privately to the
Cloud Function, so the Function itself does not need public IAM access.
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

## Capacity and load verification

`cloud-run/capacity-policy.yaml` is the reviewed source for worker CPU, memory,
concurrency, instance, and timeout bounds. Apply it with:

```bash
./scripts/apply-capacity-policy.sh studiohub-prod us-east4
```

Run read-only health load tests with:

```bash
LOAD_BASE_URL=https://studiohub--studiohub-prod.us-east4.hosted.app \
npm run test:load -- --scenario health
```

Mutation scenarios require an explicit non-production target or
`ALLOW_PRODUCTION_LOAD_TEST=true`. The runner enforces latency and error-rate
thresholds and returns nonzero when a service objective is missed.

See [production-readiness.md](production-readiness.md) for the complete
activation checklist and known pilot limitations.
