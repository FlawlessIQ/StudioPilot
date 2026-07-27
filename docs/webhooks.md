# Webhooks

Public webhook endpoints verify provider signatures against raw request bytes before parsing or writing.

Milestone 4 includes `docusignWebhook` using the Docusign HMAC secret and `quickbooksWebhook` using the Intuit verifier token. Each handler writes a deterministic `webhookEvents` ID and applies state in a transaction. Duplicate event IDs do not repeat side effects.

Docusign completion stores provider evidence without changing the signed PDF. QuickBooks updates invoice balance/status references; no payment credentials enter StudioHub.

Milestone 8 adds `stripeWebhook`. It verifies Stripe's timestamped HMAC against
the raw body, rejects stale signatures, maps configured price IDs to normalized
plan/cadence values, and snapshots entitlements. A deterministic
`stripe_{eventId}` record prevents duplicate subscription side effects. Unknown
or tenantless events are retained as ignored evidence rather than guessed.

The production Stripe destination is:

```text
https://studiohub--studiohub-prod.us-east4.hosted.app/api/webhooks/stripe
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
https://studiohub--studiohub-prod.us-east4.hosted.app/api/integrations/oauth/callback
```

The public callback validates bounded state/code parameters, forwards to the
private `integrationOAuth` Function with Google service identity, and permits
redirects only back to the configured StudioHub application origin. Dropbox is
the first independently enabled OAuth provider; activating another provider
requires adding its Function secret binding and public activation flag.
