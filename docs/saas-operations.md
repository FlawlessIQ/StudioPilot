# SaaS Operations

Milestone 8 adds the commercial and operational control plane without making
plan names part of domain logic.

## Subscription boundary

Stripe Checkout creates subscriptions and Stripe Customer Portal manages
payment methods, cancellations, and invoices. StudioHub never stores card or
bank data. It stores only tenant-scoped customer, subscription, price, status,
billing-period, and cancellation references.

`billingCommand` requires App Check, a current Firebase identity, and an active
`studio_owner` membership for the requested tenant. The browser resolves the
tenant from that user's membership; no tenant ID is compiled into the live
client.

`stripeWebhook` verifies the timestamped HMAC over the raw body before parsing.
The provider event ID is a create-only idempotency key. Supported subscription
prices resolve to a plan and billing cadence by configured price IDs, never by
parsing human-readable price names.

Required secrets and values:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- monthly and yearly `STRIPE_PRICE_*` values for all three plans
- `NEXT_PUBLIC_BILLING_FUNCTIONS_URL`

All production secrets belong in Secret Manager. Public function URLs are
configuration, not credentials.

## Entitlements and usage

The subscription snapshot embeds exact entitlements. Capability checks consume
values such as `maxInternalUsers`, `coiEnabled`, and
`advancedReportingEnabled`; they do not branch on `solo`, `studio`, or
`multi_brand`.

Usage records are tenant/month scoped. AI actions are checked and incremented
before model dispatch in trusted compute. Exhausted quotas return
`AI_MONTHLY_QUOTA_EXCEEDED`; AI cannot decide whether an overage is allowed.
SMS segments and API requests share the same extensible usage record.
Inbound COI extraction consumes quota atomically in the same transaction that
deduplicates the inbound event and queues AI work, so a webhook retry cannot
consume twice.

Plan changes replace the current entitlement snapshot only after verified
Stripe evidence. Historical workflow, price, package, schedule, and contract
snapshots remain immutable.

## Platform operations

`saasAdminCommand` requires the `platformAdmin` Firebase custom claim and App
Check. It supports:

- feature-flag updates;
- reasoned tenant suspension;
- 5–60 minute tenant-specific support grants;
- controlled reruns of failed or dead-letter provider jobs.

Every command appends an audit event. Support grants require an exact tenant ID
and business reason. A grant is authorization context, not user impersonation;
downstream support tooling must verify active, unexpired scope on every access.
Manual reruns reject nonfailed work, preserve job identity/input evidence, and
return work to the queue without manufacturing provider success.

## Health and observability

`operationsHealthScheduler` runs every 15 minutes with bounded retries and
writes normalized health snapshots. Platform administration exposes
subscription state, provider health, failed jobs, flags, audit events, support
access, and system health.

Production logs use correlation, tenant, provider-event, and automation-run
identifiers. Logs and Sentry events must exclude contracts, questionnaire
answers, access codes, OAuth tokens, and document bodies. Alert policies should
cover:

- webhook signature failures and sustained processing errors;
- dead-letter growth;
- reconciliation lag;
- provider disconnects;
- AI quota and provider-error spikes;
- scheduler failures;
- elevated HTTP 5xx rates.

Preview mode is explicit: when function URLs are omitted, UI actions disclose
that no Stripe, support, flag, or job record changed.
