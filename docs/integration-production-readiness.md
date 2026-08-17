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
| Google Calendar | Enabled | Connect, refresh, read availability, create and delete a test consultation. |
| Zoom | Temporarily unavailable | Add an enabled `ZOOM_WEBHOOK_SECRET_TOKEN` version, deploy the webhook, validate the production endpoint in Zoom Marketplace, then connect, refresh, create a test meeting, and receive a signed webhook. |
| Dropbox | Enabled | Connect, refresh, create the StudioCue project root, and write a test folder. |
| Dropbox Sign | Enabled | Connect, refresh through the provider refresh endpoint, create a test signature request, and receive the signed callback. |
| SendGrid | Email delivery enabled; inbound DNS pending | Domain authentication, signed Event Webhook, inbound parse token, and `inbound.studio-cue.com` MX priority 10 to `mx.sendgrid.net`. |
| Stripe Billing | Enabled | Live products/prices, 14-day Checkout trial, subscription webhook, and portal test. |
| Stripe Connect | Pending webhook completion | Give the production restricted key Webhook Endpoints write access (or create the endpoint manually), create the live Connect webhook for `/api/webhooks/stripe-connect`, store its signing secret, deploy the bound function, and test an invoice event. |
| QuickBooks Online | Deliberately disabled | Intuit production approval, live client credentials, canonical callback, signed webhook, connect/refresh test, and customer/invoice sync test. |
| Docusign | Deliberately disabled | Production integration key approval, live credentials, canonical callback, Connect HMAC webhook, connect/refresh test, and envelope completion test. |

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

## Deferred providers

Zoom, QuickBooks Online, and Docusign remain intentionally disabled. Enabling
any of them before its production requirements are complete would present
users with a connection that cannot reliably complete. Add the provider to
`NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS` only after every item in its
final-evidence column has passed.
