# Provider webhook certification

Release gate 6 in [production-readiness.md](./production-readiness.md) asks for
"provider sandbox certification with real payloads, including exact Docusign
Connect and QuickBooks change-notification configurations".

This records the automated half. `npm run certify:providers` drives the real
handlers on a dedicated emulator with payloads shaped as each provider sends
them, signed with each provider's documented scheme.

## What it checks, and why these four

For every provider:

1. **A correctly-signed payload is accepted.** The obvious one, and the only one
   a provider's own "send test event" button covers.
2. **A tampered body is refused.** Verification must run against the raw bytes,
   not a re-serialized parse.
3. **A payload signed with the wrong secret is refused.** Catches a handler that
   accepts anything when its secret is unset — the failure mode of a missing
   Secret Manager binding.
4. **The same event delivered twice has one effect.** Every provider here
   retries on a non-2xx and on its acknowledgement timeout, so exactly-once is
   the property, not at-most-once.

Stripe and Zoom additionally have their ±300s timestamp windows checked, which
is the usual cause of "it worked from the dashboard and fails in production".

For the two signing providers it also asserts the *effect*: a completed envelope
marks the contract `completed` and moves the project to `RETAINER_PENDING`.
That is the whole point — the booking gate accepts signature-verified provider
events and nothing else.

## Signature schemes

| Provider | Scheme | Carried in |
|---|---|---|
| Docusign | `HMAC-SHA256(rawBody)` base64 | `x-docusign-signature-1` |
| QuickBooks | `HMAC-SHA256(rawBody)` base64 | `intuit-signature` |
| Dropbox Sign | `HMAC-SHA256(eventTime + eventType)` hex | `event.event_hash` in the body |
| Stripe, Stripe Connect | `t=<ts>,v1=HMAC-SHA256("<ts>.<raw>")` hex, ±300s | `stripe-signature` |
| Zoom | `v0=HMAC-SHA256("v0:<ts>:<raw>")` hex, ±300s | `x-zm-signature` + `x-zm-request-timestamp` |

Dropbox Sign posts `multipart/form-data` with the event JSON in a field named
`json`, not a JSON body. The handler parses it with busboy; a harness that posts
raw JSON gets `INVALID_PAYLOAD` and certifies nothing.

## What the first run found

**Both signing webhooks returned 500 on every real completion.** `docusignWebhook`
and `dropboxSignWebhook` created the `webhookEvents` record and *then* read the
project inside the same transaction. Firestore requires all reads before all
writes, so the transaction threw and the handler answered 500. Docusign retries
a non-2xx, gets another 500, and gives up — a signed agreement never reached
`completed`, the project never left `CONTRACT_PENDING`, and **the booking gate
could never open**.

It was invisible to every earlier audit because two failure modes sit in front
of it: without a connected `integrationConnections` account the handler answers
404, and without a contract matching the envelope it never enters the branch.
Only a harness that seeds both reaches the fault. Ten prior audits, a full
signature-relay suite and a normalizer suite all passed over it.

The same sweep found a third instance in `post-event/jobs.ts`: the review-request
scheduler wrote a product event and then read on both branches, so every due
review request failed on both channels.

`tests/transaction-read-before-write.test.ts` now fails on a fourth. It is
path-sensitive — it reports a read after a write only when both are
unconditionally on the same path, so the branchy dispatch transactions in
`crmCommand` and `workflowCommand` are correctly left alone.

## Running it

```bash
npm run certify:providers
```

Needs Node ≥ 22 and Java ≥ 21. It starts its own emulator on ports 5602 / 8782 /
9602 so it does not collide with a development suite, and it needs
`functions/.secret.local` to hold the signing secrets the harness signs with:

```
DOCUSIGN_WEBHOOK_HMAC_SECRET=cert-docusign-hmac-secret
QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN=cert-quickbooks-verifier-token
DROPBOX_SIGN_API_KEY=cert-dropbox-sign-api-key
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_cert_connect
STRIPE_WEBHOOK_SECRET=whsec_cert_billing
ZOOM_WEBHOOK_SECRET_TOKEN=cert-zoom-secret-token
```

Those are not credentials. They exist so the real verification code runs against
correctly-signed input. Production values live in Secret Manager. `.secret.local`
is gitignored — it was not until this work, because `.gitignore`'s `.env*` does
not match that name.

## What this does not cover

The harness certifies **our** side: signature verification, deduplication, and
the domain effect. It cannot certify the provider's side, which still needs a
person with each dashboard open:

- **Docusign Connect** — JSON SIM (`deliveryMode: SIM`), REST v2.1 event data,
  HMAC enabled, acknowledgement retries on, and only `envelope-completed`
  subscribed for the pilot. Generated HMAC key stored as
  `DOCUSIGN_WEBHOOK_HMAC_SECRET`.
- **QuickBooks** — Intuit webhook pointed at the production endpoint with
  Invoice create, update, delete and void enabled. Verifier token stored as
  `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`.
- **Dropbox Sign** — signature-request callbacks pointed at its endpoint. The
  handler verifies with `DROPBOX_SIGN_API_KEY`.
- **Stripe Connect** — a `connect=true` endpoint subscribed to `invoice.paid`,
  `invoice.payment_failed` and `invoice.voided` only. Signing secret stored as
  `STRIPE_CONNECT_WEBHOOK_SECRET`.
- **Stripe billing** — an account destination subscribed to
  `customer.subscription.created`, `.updated` and `.deleted` only. Secret stored
  as `STRIPE_WEBHOOK_SECRET`.
- **Zoom** — event subscription with the secret token stored as
  `ZOOM_WEBHOOK_SECRET_TOKEN`.

The destinations are listed in [webhooks.md](./webhooks.md). Every secret above
already exists in Secret Manager for `studiohub-prod`.

## DocuSign is deferred on cost, not on readiness

A live DocuSign API integration is roughly **$600 a year**, and that spend is
deferred until revenue covers it. Everything else about DocuSign is finished —
its webhook is certified above, its OAuth strategy is implemented, its client
secret and integration key are configured — so restoring it is two entries:
`docusign` in `NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS`, and `docusign` in
`offeredProviders` in `features/integrations/schema.ts`.

`offeredProviders` is the authority on what the product offers. It gates the
settings card, the proposal capability note and the server resolving which app
signs a contract. `NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS` only controls what can
*start* an OAuth flow, and the two disagreeing is how a hidden provider gets
named at a studio anyway — `tests/offered-providers-agree.test.ts` now fails if
the OAuth list offers something `offeredProviders` hides.

That test also fails on the two shapes that leaked DocuSign into the UI after it
was hidden: a state seed and a fallback. The booking workspace seeded
`useState("docusign")` and closed its resolution `: "docusign"`, so a studio with
no signing connection — which is every studio — was told "DocuSign remains the
authority for signature", "choose a DocuSign template" and "using your approved
DocuSign agreement", and sent looking for an account the product does not offer.
Nothing was ever *sent* through DocuSign: `createEnvelope` carries no provider
and the server resolves it. The cost was a studio's afternoon.

**Neither signing app is offered.** Dropbox Sign is deferred on the same
grounds as DocuSign — its paid plan costs money that waits on revenue — and is
expected back within weeks rather than months. Both are fully implemented and
both webhooks are certified above, so restoring either is one entry in
`offeredProviders` and one in `NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS`.

With no signing app offered, a studio sends its own agreement and records the
signature on the booking. `RecordSignedAgreement` renders on any proposal,
independent of providers, and the walk of 2026-08-27 drove a job from inquiry to
CLOSED entirely that way. What the product must not do is name an app the
settings page cannot show: four places did, and each was a different shape —
a state seed, a resolution fallback, a capability remedy, and the
agreement-template copy telling the reader to "connect Dropbox Sign above" when
no such card was on the page.

A contract's *recorded* provider is different and stays. "Signed with DocuSign"
on an agreement genuinely sent through DocuSign is the audit trail; an unoffered
provider must not decide routing, and must still be labelled truthfully where it
already happened.
