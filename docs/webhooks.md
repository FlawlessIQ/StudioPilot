# Webhooks

Public webhook endpoints verify provider signatures against raw request bytes before parsing or writing.

Milestone 4 includes `docusignWebhook` using the Docusign HMAC secret and `quickbooksWebhook` using the Intuit verifier token. Each handler writes a deterministic `webhookEvents` ID and applies state in a transaction. Duplicate event IDs do not repeat side effects.

Docusign completion stores provider evidence without changing the signed PDF. QuickBooks updates invoice balance/status references; no payment credentials enter StudioCue.

The public provider destinations are:

```text
https://studio-cue.com/api/webhooks/docusign
https://studio-cue.com/api/webhooks/quickbooks
https://studio-cue.com/api/webhooks/dropbox-sign
https://studio-cue.com/api/webhooks/stripe-connect
```

The public routes preserve the exact request bytes and provider signature
headers, then authenticate to the private Functions with a Google service
identity. The private handlers perform the authoritative HMAC verification.

Configure Docusign Connect to use JSON SIM (`deliveryMode: SIM`), REST v2.1
event data, HMAC, acknowledgement retries, and only the
`envelope-completed` event for the initial pilot. Store the generated HMAC key
as `DOCUSIGN_WEBHOOK_HMAC_SECRET`.

Configure the Intuit development webhook with the QuickBooks endpoint above and
enable Invoice create, update, delete, and void notifications. Store the
development verifier token as `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`. QuickBooks
notifications enqueue invoice reconciliation jobs so the listener can
acknowledge promptly and the worker can fetch the authoritative balance.

Dropbox Sign sends signature-request callbacks to its dedicated endpoint. The
handler verifies the provider event hash with `DROPBOX_SIGN_API_KEY`, stores the
provider event once, and records completion evidence without trusting browser
state.

Stripe Connect client-invoice events are deliberately separate from StudioCue
subscription billing. Create a Connect endpoint with `connect=true`, store its
one-time signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`, and subscribe only
to:

- `invoice.paid`
- `invoice.payment_failed`
- `invoice.voided`

Milestone 8 adds `stripeWebhook`. It verifies Stripe's timestamped HMAC against
the raw body, rejects stale signatures, maps configured price IDs to normalized
plan/cadence values, and snapshots entitlements. A deterministic
`stripe_{eventId}` record prevents duplicate subscription side effects. Unknown
or tenantless events are retained as ignored evidence rather than guessed.

The production Stripe destination is:

```text
https://studio-cue.com/api/webhooks/stripe
```

This dedicated App Hosting route is the only public Stripe surface. It requires
the `Stripe-Signature` header, rejects bodies over 1 MiB, preserves the raw body
bytes, obtains a Google service identity token, and forwards only to the private
`stripeWebhook` Function. The private handler performs the authoritative
signature and timestamp validation using `STRIPE_WEBHOOK_SECRET`.

Subscribe the Stripe account destination only to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

After deploying the Function, reapply service-level IAM with
`scripts/configure-production-function-invokers.sh` so only the App Hosting
runtime can invoke `stripewebhook`.

Provider OAuth callbacks use:

```text
https://studio-cue.com/api/integrations/oauth/callback
```

The public callback validates bounded state/code parameters, forwards to the
private `integrationOAuth` Function with Google service identity, and permits
redirects only back to the configured StudioCue application origin. Production
providers are enabled individually through
`NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS`; a provider stays visibly unavailable
until its exact callback, credentials, webhook signing, and acceptance test are
complete.
