# Webhooks

Public webhook endpoints verify provider signatures against raw request bytes before parsing or writing.

Milestone 4 includes `docusignWebhook` using the Docusign HMAC secret and `quickbooksWebhook` using the Intuit verifier token. Each handler writes a deterministic `webhookEvents` ID and applies state in a transaction. Duplicate event IDs do not repeat side effects.

Docusign completion stores provider evidence without changing the signed PDF. QuickBooks updates invoice balance/status references; no payment credentials enter StudioHub.

Milestone 8 adds `stripeWebhook`. It verifies Stripe's timestamped HMAC against
the raw body, rejects stale signatures, maps configured price IDs to normalized
plan/cadence values, and snapshots entitlements. A deterministic
`stripe_{eventId}` record prevents duplicate subscription side effects. Unknown
or tenantless events are retained as ignored evidence rather than guessed.
