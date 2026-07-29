# Internal roadmap completion

This record covers roadmap work that can be completed without provider-console
approval, new production credentials, legal review, or owner acceptance.

## Durable processing

- Provider, email, AI, and PDF records dispatch to Cloud Tasks.
- The existing Scheduler poller remains a recovery path.
- Normalized domain events publish through Pub/Sub and retain a Firestore
  outbox for retry and audit evidence.
- Platform administrators can replay failed queue, automation, and event
  records without mutating their original evidence.
- Queue health records include backlog, dead letters, oldest-record age,
  objective thresholds, transport, and recommended operating state.

## Load and capacity controls

- `npm run test:load` exercises health, SendGrid and Stripe webhooks, AI,
  document, readiness, reconciliation, and email routes with bounded
  concurrency.
- Production mutation scenarios fail closed unless
  `ALLOW_PRODUCTION_LOAD_TEST=true` is explicitly provided.
- `cloud-run/capacity-policy.yaml` defines minimum, maximum, concurrency,
  timeout, CPU, memory, and budget guardrails.
- `scripts/apply-capacity-policy.sh` applies those bounds to the deployed
  workers using non-destructive `gcloud run services update` operations.

## Email design

- Studio owners and administrators can edit supported branded journeys.
- Every save creates an immutable template version.
- Activation supersedes the previous version without changing sent messages.
- Test sends use a server-side snapshot of the selected version.
- Variables are allow-listed and rendered into escaped branded email.

## Integration support

- Provider health captures latency, vault presence, token expiry metadata,
  granted-scope counts, seven-day webhook volume, seven-day failed jobs, last
  reconciliation, severity, and a recommended action.
- Browser and platform-admin views receive only diagnostic metadata; OAuth
  tokens and Secret Manager payloads remain server-only.

## Rollback

- Disable the four Firestore task-dispatch triggers to return to the recovery
  Scheduler transport.
- Disable the Pub/Sub consumer and restore the previous Firestore consumer if a
  domain-event rollback is required.
- Activate a prior email template version to roll back copy.
- Cloud Run capacity values can be restored with the same policy script and a
  previous YAML revision.
