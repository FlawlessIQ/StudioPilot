# Integration production readiness

Last audited: August 17, 2026

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

## Current provider status

| Provider | Current launch status | Required final evidence |
| --- | --- | --- |
| Google Calendar | Enabled and production-verified | Production OAuth refresh and Calendar API probe passed on August 17, 2026. Complete a create/delete consultation acceptance test after the next user connection. |
| Zoom | Enabled for reconnection | The production client secret and webhook token are configured, but the saved tenant refresh token was revoked. Reconnect Zoom, then create/delete a test meeting and validate a signed webhook. |
| Dropbox | Enabled and production-verified | Production OAuth refresh and file metadata probe passed on August 17, 2026. Complete a folder create/delete acceptance test after the next project run. |
| Dropbox Sign | Deliberately hidden; backend verified | Owner-account OAuth refresh, account probe, callback configuration, and webhook handshake passed. The API app reports `is_approved=false`; submit the OAuth app review with a complete demo before public enablement. |
| SendGrid | Outbound and inbound enabled | Domain authentication and inbound MX are live. Signed StudioCue delivery-event analytics require an isolated SendGrid account or subuser because the shared account's single Event Webhook belongs to another product. |
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
`integrationOAuthEast4`. The earlier `integrationOAuth` function remains
temporarily deployed in `us-central1` only to avoid a destructive in-place
region move; it is not referenced by production configuration.

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
