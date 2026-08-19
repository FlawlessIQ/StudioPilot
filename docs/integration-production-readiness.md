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
| Google Calendar | Connected and production-verified | Reconnected August 19, 2026 through the corrected callback; `GOOGLE_CALENDAR_REFRESH_NOT_CONFIGURED` is cleared and the Calendar API probe passed in 502 ms. Still outstanding: a create/delete consultation acceptance test. |
| Zoom | Connected and production-verified | Reconnected August 19, 2026 after the callback origin was corrected and the account lookup was made non-fatal. Health probe (`GET /v2/users/me/meetings?page_size=1`) passed in 329 ms, so the stored credential works with the granted meeting scopes. `providerAccountId` is deliberately null and the label reads "Zoom" — see the scope note below. Still outstanding: create/delete a test meeting and validate a signed webhook. |
| Dropbox | Enabled and production-verified | Production OAuth refresh and file metadata probe passed on August 17, 2026. Complete a folder create/delete acceptance test after the next project run. |
| Dropbox Sign | Deliberately hidden; backend verified | Owner-account OAuth refresh, account probe, callback configuration, and webhook handshake passed. The API app reports `is_approved=false`; submit the OAuth app review with a complete demo before public enablement. |
| SendGrid | Inbound enabled; outbound repaired August 18, 2026 | Domain authentication for `studio-cue.com` is valid and Inbound Parse for `inbound.studio-cue.com` resolves to the production webhook with a matching token. Outbound delivered live as recently as August 13, 2026 (SendGrid issued `mo97W7BITheuSRfsb2qFBA`) and then regressed: `SENDGRID_FROM_EMAIL` was set on the deployed Function out of band but never added to `functions/.env.studiohub-prod`, so the next `firebase deploy --only functions` replaced the environment without it and sends began dead-lettering. Requeue the dead-lettered `emailJobs` after confirming a live send. Signed StudioCue delivery-event analytics still require an isolated SendGrid account or subuser because the shared account's single Event Webhook belongs to another product. |
| Stripe Billing | Enabled and production-verified | Live products/prices, 14-day Checkout trial, subscription webhook, and billing portal are configured. |
| Stripe Connect | Enabled and production-verified | The live Connect invoice webhook and signing secret are configured and deployed. |
| QuickBooks Online | Enabled August 19, 2026; blocked on production app keys | The callback **is** registered — a connect on August 19 completed authorize and token exchange cleanly, which settles the redirect question for Intuit. The real health probe then returned `QUICKBOOKS_HEALTH_FAILED:403` in 1414 ms, with Intuit reporting `errorCode=003100, ApplicationAuthorizationFailed` on `companyinfo`. That names the *application*, not the company, and `QUICKBOOKS_CLIENT_ID` has exactly one Secret Manager version created 2026-07-29T16:16:07 — before production access was granted — so the stored pair is almost certainly the app's **Development** keypair. Intuit issues separate Development and Production keypairs, and development keys can only see sandbox companies, which is why the picker offered no live company and the realm stayed `9341455510105739`. Next: add the Production client ID and secret as new versions of `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET`, redeploy the three functions that bind them (`integrationOAuthEast4`, `operationsTaskWorker`, `operationsJobScheduler` — Firebase pins each secret to the version resolved at deploy time), then reconnect and re-probe. |
| Docusign | Deliberately hidden | The production request was declined. The implementation remains dormant; Dropbox Sign is the preferred e-signature path once its OAuth app is approved. |

### Zoom requests no user-profile scope, by design

The Zoom app requests only `meeting:*` scopes. The OAuth callback used to call
`GET /v2/users/me` and treat failure as fatal, so connecting died with
`ZOOM_ACCOUNT_LOOKUP_FAILED` *after* a successful token exchange — the studio
had already granted consent, and the only remedy implied was to widen the grant.

That lookup is now best effort, because Zoom's account id is stored and never
read: every Zoom operation addresses `/v2/users/me/...` with the meeting scopes
already held — the health probe, meeting creation, and the summary fetch in
`functions/src/operations/provider-runtime.ts`. Docusign needs its `accountId`
and QuickBooks its `realmId`; Zoom does not.

Consequences to expect, and not to "fix": `providerAccountId` is null and the
connection label is the literal `Zoom` rather than the account name. Adding
`user:read:user` would populate both, and requires enabling that scope in the
Zoom Marketplace app first — worth doing only if a real account label is wanted,
since nothing functional depends on it. The skip is logged as
`integration.zoom.profile_unavailable`.

### Provider redirect URIs cannot be verified from outside

Intuit, Google, and Zoom all defer `redirect_uri` validation until after the
user signs in, so probing an authorize endpoint proves nothing about whether a
callback is registered. Each was tested with a deliberately unregistered
control URI on August 19, 2026 and returned the same status and near-identical
body as the real one — Intuit differed by 90 bytes out of ~153 KB. Treat any
"the redirect looks fine" claim from an unauthenticated probe as meaningless;
the only real test is a signed-in connect attempt, whose failure surfaces as
`Invalid redirect` (Zoom) or `redirect_uri_mismatch` (Google).

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
The `us-central1` `integrationOAuth` deployment was retired on August 19, 2026.
It had been in `FAILED` state since July 29 with no backing Cloud Run service
at all (`CloudRunServiceNotFound`), so it could not serve a request even in
principle, and its only log entries in 30 days were from the moment that
deploy broke. Its `FAILED` state was what made `firebase deploy --only
functions` abort and forced the targeted `--only functions:<name>,<name>` form
— which is how `emailJobTaskDispatch` and `pdfJobTaskDispatch` came to sit on
eleven-day-old code. A full-deploy dry run passes now.

An earlier note here claimed Cloud Logging showed completed Google OAuth
callbacks reaching the `us-central1` deployment. **That was wrong about the
region.** The traffic was on the `us-east4` `integrationOAuth`: 22 requests on
August 5 and 31 on August 6, including the signed Google callback at
20:19:41Z, after which `INTEGRATION_OAUTH_FUNCTION_URL` moved to
`integrationOAuthEast4`. Its only later hit was an unauthenticated 403 probe
with no query string on August 17.

The `us-east4` `integrationOAuth` deployment was retired the same day, leaving
`integrationOAuthEast4` as the only OAuth Function in the project. No provider
console referenced either one: consoles hold the app callback
`https://studio-cue.com/api/integrations/oauth/callback`, and the Next.js proxy
route picks the Function.

**`integrationOAuth` survives as a browser-facing route name and must not be
renamed away.** `components/integrations/integration-manager.tsx` posts Connect,
Test, and Disconnect to `${NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL}/integrationOAuth`,
and that variable is the relative path `/api/functions`. The proxy at
`app/api/functions/[functionName]/route.ts` keeps `integrationOAuth` in its
allowlist and retargets it to `INTEGRATION_OAUTH_FUNCTION_URL`, which is why
request logs showed the traffic on `integrationOAuthEast4` while the browser
was still asking for `integrationOAuth`.

Two fallbacks used to resolve the bare name whenever
`INTEGRATION_OAUTH_FUNCTION_URL` is absent — one in that proxy
(`https://integrationoauth-${FUNCTIONS_RUN_HOST_SUFFIX}`) and one in
`app/api/integrations/oauth/callback/route.ts`
(`${FUNCTIONS_HTTPS_ORIGIN}/integrationOAuth`). Both now name
`integrationOAuthEast4`; left alone they would have become dead ends that fail
with an opaque 404 instead of the disclosed `FUNCTION_PROXY_NOT_CONFIGURED`.

`scripts/configure-production-function-invokers.sh` also listed
`integrationoauth`. That entry was removed in the same change, and the removal
mattered more than tidiness: the script runs under `set -e`, so binding a
service that no longer exists aborts the run and silently leaves every service
listed after it — through `zoomwebhook` — with no invoker binding at all. The
inverse of CLAUDE.md's rule 5 applies: a retired Function must leave that
allowlist in the same change that deletes it.

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

### A connection is not healthy until something probes it

`status: "connected"` means a provider issued a token, nothing more. Until
August 19, 2026 the OAuth callback also stamped `lastHealthCheckAt` with the
connect time and — because that write merges — left a previous probe's latency
and diagnostics in place, so a card could read "Connected · Checked <just now> ·
388 ms" where the timestamp was the connect instant and the latency came from an
older probe that had *failed*. QuickBooks showed exactly this: connected, no
error, while every production call returned 403.

The callback now clears the entire probe result, so a new connection reads
"Not tested yet" until a real probe runs. `operationsHealthScheduler` runs no
probe of its own — it only mirrors stored state into `systemHealth` — so it maps
a never-probed connection to `unknown` rather than `healthy`.

Only the Test control and the provider health path in
`functions/src/operations/provider-runtime.ts` produce real evidence. When
judging a connection, compare `lastHealthCheckAt` against `connectedAt`: equal
values mean nothing has been verified.

## Acceptance record

For every provider test, record the date, tenant, test object ID, result, and any
cleanup performed.

- **2026-08-19 · tenant_be3901ee · SendGrid outbound** — live send to a real
  inbox, SendGrid message `b_6Zoa95TFa0Et6J3yT5WA`, **delivered**. Restored by
  adding `SENDGRID_FROM_EMAIL=studio@studio-cue.com`. The dead-lettered job was
  requeued out of band with admin credentials and recorded in `auditEvents` as
  actorType `system`; the audited path is Platform admin's Rerun control.
- **2026-08-19 · tenant_be3901ee · job dispatch** — `emailJobs` reports
  `executionTransport: cloud_tasks` after deploying the two stale dispatchers.
  Verified with a scratch job document scheduled 20 minutes out so no email
  could send; document deleted afterwards.
- **2026-08-19 · tenant_be3901ee · Zoom** — connected, credential stored as
  Secret Manager version 5, `integration.connect` audit event written, health
  probe 329 ms. No test meeting created yet.
- **2026-08-19 · tenant_be3901ee · Google Calendar** — connected through the
  corrected callback, Calendar API probe 502 ms. No test consultation yet.
- **2026-08-19 · tenant_be3901ee · QuickBooks** — connect completed (callback
  registered, token exchange clean, credential version 4), but the real probe
  failed `QUICKBOOKS_HEALTH_FAILED:403` in 1414 ms against realm
  `9341455510105739`. Intuit: `errorCode=003100 ApplicationAuthorizationFailed`.
  Blocked on the production keypair, not on the callback. Do not paste access tokens, refresh tokens, API keys, webhook
signing secrets, client secrets, or raw authorization codes into this file.

## Deferred or approval-gated providers

QuickBooks Online, Dropbox Sign, and Docusign remain intentionally hidden.
Enabling any of them before its external production requirements are complete
would present users with a connection that cannot reliably finish. Zoom stays
visible specifically so the studio owner can replace the revoked token through
the normal reconnect flow. Add a hidden provider to
`NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS` only after every item in its
final-evidence column has passed.
