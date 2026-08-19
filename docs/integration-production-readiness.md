# Integration production readiness

Last audited: August 18, 2026

This document is the launch source of truth for StudioCue's external providers.
It records what is enabled, what is deliberately unavailable, and the checks
required before a provider may be added to
`NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS`.

## Production rules

- The canonical application origin is `https://studio-cue.com`.
- OAuth callbacks use `https://studio-cue.com/api/integrations/oauth/callback`.
- Provider mock mode and billing mock mode must remain disabled in production.
- A provider is available only when its production client ID, secret, callback,
  webhook, and one end-to-end acceptance test are complete.
- Missing configuration must render as **Setup required** and must never fail as
  an unexplained browser `Failed to fetch` error.
- Optional telemetry remains disabled until `SENTRY_DSN` has an enabled secret
  version. It is not bound to job workers while no production DSN exists.

### Configuration invariants

These live only in a deployed Function's environment, so `npm run typecheck`,
the unit suite, and the e2e suite are all blind to them. Verify them with
`./scripts/verify-production-integration-config.sh` after every
`firebase deploy --only functions`.

- `OAUTH_CALLBACK_URL` must equal the `NEXT_PUBLIC_APP_URL` origin plus
  `/api/integrations/oauth/callback`. On August 18, 2026 it was found pointing
  at `https://studiohub--studiohub-prod.us-east4.hosted.app`, the App Hosting
  default, while every provider console had `https://studio-cue.com`
  registered. Google Calendar and Zoom therefore could not be connected at
  all: Zoom rejected the authorize request with `Invalid redirect ... (4,700)`
  before the owner could approve anything. Dropbox Sign was unaffected only
  because it carried a `DROPBOX_SIGN_OAUTH_CALLBACK_URL` override.
- A `${PROVIDER}_OAUTH_CALLBACK_URL` override that merely repeats
  `OAUTH_CALLBACK_URL` is drift, not configuration — it silently pins that one
  provider to the old host the next time the default changes.
- `SENDGRID_FROM_EMAIL` is required whenever `EMAIL_DELIVERY_MODE=live`.
  Without it `sendEmailJob()` throws `SENDGRID_NOT_CONFIGURED`, which
  `retryableJobFailure()` classes as **permanent** — the email dead-letters
  with no retry, and the studio sees only "Needs attention" against the
  message. It was unset in production on August 18, 2026 — not because it was
  never configured, but because it had been set directly on the Function while
  `functions/.env.studiohub-prod` still lacked it. `firebase deploy --only
  functions` **replaces** a Function's environment with that file's contents,
  so any variable set out of band is erased by the next deploy. Every
  non-secret runtime variable must live in that file to survive.
- `SENDGRID_FROM_NAME` is deliberately left unset. The from name then falls
  back per tenant to that studio's own brand; setting it replaces every
  studio's name with one flat value. `reply_to` already falls back to the
  tenant's contact address, so only the envelope from needs to sit on the
  shared authenticated domain.
- `SENDGRID_INBOUND_DOMAIN` must equal the SendGrid Inbound Parse hostname
  exactly; COI reply addresses are minted as `coi+<token>@<domain>`. It was
  also unset in production on August 18, 2026, so COI requests failed
  `COI_INBOUND_DOMAIN_NOT_CONFIGURED`.
- Every provider named in `NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS` must have a
  matching `${PROVIDER}_CLIENT_ID` on the OAuth Function, as plain config or a
  bound secret. Offering a provider without one produces
  `OAUTH_PROVIDER_NOT_CONFIGURED` at the moment the owner clicks Connect.
- A provider left out of `NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS` must state why
  in its `pendingReason` in `components/integrations/integration-manager.tsx`,
  kept in step with the final-evidence column below. The card shows that
  sentence instead of a Connect button.

## Current provider status

| Provider | Current launch status | Required final evidence |
| --- | --- | --- |
| Google Calendar | Enabled and production-verified | Production OAuth refresh and Calendar API probe passed on August 17, 2026. Complete a create/delete consultation acceptance test after the next user connection. |
| Zoom | Enabled for reconnection | The production client secret and webhook token are configured, but the saved tenant refresh token was revoked. Reconnecting was impossible until the callback origin was corrected on August 18, 2026. Reconnect Zoom, then create/delete a test meeting and validate a signed webhook. |
| Dropbox | Enabled and production-verified | Production OAuth refresh and file metadata probe passed on August 17, 2026. Complete a folder create/delete acceptance test after the next project run. |
| Dropbox Sign | Deliberately hidden; backend verified | Owner-account OAuth refresh, account probe, callback configuration, and webhook handshake passed. The API app reports `is_approved=false`; submit the OAuth app review with a complete demo before public enablement. |
| SendGrid | Inbound enabled; outbound repaired August 18, 2026 | Domain authentication for `studio-cue.com` is valid and Inbound Parse for `inbound.studio-cue.com` resolves to the production webhook with a matching token. Outbound delivered live as recently as August 13, 2026 (SendGrid issued `mo97W7BITheuSRfsb2qFBA`) and then regressed: `SENDGRID_FROM_EMAIL` was set on the deployed Function out of band but never added to `functions/.env.studiohub-prod`, so the next `firebase deploy --only functions` replaced the environment without it and sends began dead-lettering. Requeue the dead-lettered `emailJobs` after confirming a live send. Signed StudioCue delivery-event analytics still require an isolated SendGrid account or subuser because the shared account's single Event Webhook belongs to another product. |
| Stripe Billing | Enabled and production-verified | Live products/prices, 14-day Checkout trial, subscription webhook, and billing portal are configured. |
| Stripe Connect | Enabled and production-verified | The live Connect invoice webhook and signing secret are configured and deployed. |
| QuickBooks Online | Deliberately disabled | The app assessment was submitted, but the saved OAuth company is a sandbox realm: sandbox API probe passes and production returns 403. Obtain Intuit production access, then reconnect a live company and run customer/invoice sync. |
| Docusign | Deliberately hidden | The production request was declined. The implementation remains dormant; Dropbox Sign is the preferred e-signature path once its OAuth app is approved. |

## Canonical provider endpoints

| Purpose | URL |
| --- | --- |
| Shared OAuth callback | `https://studio-cue.com/api/integrations/oauth/callback` |
| SendGrid inbound COI | `https://studio-cue.com/api/webhooks/sendgrid/inbound?token=SECRET` |
| SendGrid inbound gallery | `https://studio-cue.com/api/webhooks/sendgrid/gallery-inbound?token=SECRET` |
| SendGrid event webhook | `https://studio-cue.com/api/webhooks/sendgrid/events` |
| Zoom webhook | `https://studio-cue.com/api/webhooks/zoom` |
| Dropbox Sign webhook | `https://studio-cue.com/api/webhooks/dropbox-sign` |
| Docusign webhook | `https://studio-cue.com/api/webhooks/docusign` |
| QuickBooks webhook | `https://studio-cue.com/api/webhooks/quickbooks` |
| Stripe subscription webhook | `https://studio-cue.com/api/webhooks/stripe` |
| Stripe Connect webhook | `https://studio-cue.com/api/webhooks/stripe-connect` |

The application relay targets the regional OAuth handler
`integrationOAuthEast4` (`INTEGRATION_OAUTH_FUNCTION_URL` in `apphosting.yaml`).
Two older `integrationOAuth` deployments still exist and are not referenced by
production configuration: one in `us-central1`, now in `FAILED` state, kept
only to avoid a destructive in-place region move, and one in `us-east4`.
Neither may be deleted before the redirect URIs registered in the Google,
Zoom, and QuickBooks consoles are confirmed to route through the survivor —
Cloud Logging previously showed completed Google OAuth callbacks reaching the
`us-central1` deployment. The `FAILED` revision is also why
`firebase deploy --only functions` aborts, and why the targeted
`--only functions:<name>,<name>` form is the current workaround.

## Job dispatch transport

`emailJobs`, `providerJobs`, `aiJobs`, and `pdfJobs` are enqueued to the Cloud
Tasks queue `operationsTaskWorker` in `us-east4` for immediate execution, and
fall back to `operationsJobScheduler` when the enqueue fails.

Between August 7 and August 19, 2026 every `emailJobs` and `pdfJobs` record ran
on the fallback. The cause was **a deployed/source mismatch, not a
misconfiguration**: firebase-admin's `parseResourceName()` returns no
`locationId` for a bare function name, and `enqueue()` then falls back to its
`DEFAULT_LOCATION` of `us-central1`, where this project has no queues at all.
Cloud Tasks answered `Queue does not exist. If you just created the queue,
wait at least a minute for the queue to initialize.` — which reads as a
transient race and is not one.

Commit `37682b5` (August 14) had already fixed the call to name the location
explicitly. It simply was never deployed to `emailJobTaskDispatch` or
`pdfJobTaskDispatch`, whose revisions still dated from August 7.
`aiJobTaskDispatch` was redeployed at 12:26 that day and its own records show
the switch to the minute: `scheduler_fallback` with this error at 12:22, then
`cloud_tasks` from 12:53 onward. Deploying the two stale dispatchers on
August 19 restored `cloud_tasks` for `emailJobs`, verified against a scratch
job document.

Diagnosis was slow because the failure was invisible. `enqueue()`'s catch wrote
only to the job document and `captureOperationalError`, which returns
immediately while `SENTRY_DSN` has no enabled secret version, so nothing
reached Cloud Logging for eleven days. It now logs at `ERROR` with the resolved
queue resource, which is the field that separates the two failure modes —
Cloud Tasks returns `NOT_FOUND` both for a queue in the wrong location and for
one the caller cannot see.

Ruled out during diagnosis, recorded so it is not re-investigated: the queue
exists at exactly the path the SDK requests and has only ever been updated,
never recreated; the Functions runtime service account holds unconditioned
project-level `roles/cloudtasks.enqueuer` granted more than 30 days ago; and
firebase-admin preserves the queue name's camel case rather than lowercasing it.

A separate, older enqueue failure appears on the August 13 job
`manual_message_draft_9416a6212d99aa4ee2f59ca26ff5ab`:
`lacks IAM permission "iam.serviceAccounts.actAs"`. Cloud Tasks needs that on
the OIDC service account it mints the task's token with;
`scripts/configure-production-function-invokers.sh` grants it, and that script
must be run after every function deploy. `operationstaskworker` was missing
from its allowlist entirely and has been added.

When a job reports `executionTransport: "scheduler_fallback"`, check Cloud
Logging for `operations.task.enqueue_failed` before anything else. Impact is
bounded either way: `firebase-schedule-operationsJobScheduler-us-east4` runs
every 1 minute. The August 13 job's wait from 11:55 to 13:00 was retry backoff
on its sixth attempt (`min(6h, 30s · 2^(attempt−1))`), not the scheduler
cadence.

## Acceptance record

For every provider test, record the date, tenant, test object ID, result, and any
cleanup performed. Do not paste access tokens, refresh tokens, API keys, webhook
signing secrets, client secrets, or raw authorization codes into this file.

## Deferred or approval-gated providers

QuickBooks Online, Dropbox Sign, and Docusign remain intentionally hidden.
Enabling any of them before its external production requirements are complete
would present users with a connection that cannot reliably finish. Zoom stays
visible specifically so the studio owner can replace the revoked token through
the normal reconnect flow. Add a hidden provider to
`NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS` only after every item in its
final-evidence column has passed.
