# Background Jobs and Automation Reliability

Milestone 3 defines the durable execution model used by later Cloud Tasks,
Scheduler, and Pub/Sub integrations.

## Run lifecycle

Automation runs use `queued`, `running`, `succeeded`, `failed`,
`retry_scheduled`, and `dead_letter`. Failures are normalized to code, message,
and retryable status. Retry state stores maximum attempts and the next eligible
time. Production queue handlers will use exponential backoff and dead-letter
exhausted runs.

## Idempotency

The idempotency key includes tenant and domain occurrence. The run is created
before actions execute. Repeated provider events, task deliveries, or manual
retries return the prior result instead of duplicating an invoice, folder,
envelope, task, or message.

## Operational visibility

Automation Runs exposes status, attempts, project, action count, and recency.
Later platform-administration work adds guarded manual rerun and dead-letter
tools. A manual rerun creates a new run with `manualRerunOfId`; it never edits
the original failure.

## Planned queue routing

- Cloud Tasks: delayed and retried single-tenant actions
- Cloud Scheduler: relative dates, reminders, reconciliations, health checks
- Pub/Sub: normalized internal domain events
- Cloud Run: PDFs, extraction, file safety, and heavier AI work

Queue payloads contain identifiers and immutable snapshots, not provider secrets.

## Review request scheduling

The hourly review scheduler selects due `scheduled` review records and creates
an idempotent server-only email job. The communications worker and SendGrid
events remain authoritative for sent and delivered state. Explicit client or
studio confirmation marks remaining scheduled sequence items `skipped`.
