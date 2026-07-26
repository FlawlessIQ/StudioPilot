# Webhooks

Public webhook endpoints verify provider signatures against raw request bytes before parsing or writing.

Milestone 4 includes `docusignWebhook` using the Docusign HMAC secret and `quickbooksWebhook` using the Intuit verifier token. Each handler writes a deterministic `webhookEvents` ID and applies state in a transaction. Duplicate event IDs do not repeat side effects.

Docusign completion stores provider evidence without changing the signed PDF. QuickBooks updates invoice balance/status references; no payment credentials enter StudioHub.
