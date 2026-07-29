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
Platform administration provides guarded manual rerun and dead-letter tools.
Automation reruns create lineage through `manualRerunOfId`; provider-job reruns
preserve the original job and input evidence while moving only failed or
dead-letter work back to `queued`. Every manual rerun is audited.

## Queue routing

- Cloud Tasks: delayed and retried single-tenant actions
- Cloud Scheduler: relative dates, reminders, reconciliations, health checks
- Pub/Sub: normalized internal domain events
- Cloud Run: PDFs, extraction, file safety, and heavier AI work

Queue payloads contain identifiers and immutable snapshots, not provider secrets.

Provider, email, AI, and PDF Firestore records dispatch to a single
`operationsTaskWorker` through Cloud Tasks. The worker claims the record
transactionally before executing it. Task creation itself is idempotent through
the record's `taskDispatchKey`. If dispatch fails, the record is marked for the
Scheduler recovery transport.

Normalized `domainEvents` are an outbox. A Firestore trigger publishes their
identifiers to `studiocue-domain-events`; the Pub/Sub consumer resolves the
source record and evaluates matching workflow versions. A five-minute outbox
scheduler republishes pending and retryable events.

## Operational health scheduling

The 15-minute operations scheduler projects provider connections into normalized
`systemHealth` records. It uses bounded retry and feeds the platform health
screen. Sustained failures and dead-letter growth are alert conditions, not
states that the scheduler silently repairs.

## Review request scheduling

The hourly review scheduler selects due `scheduled` review records and creates
an idempotent server-only email job. The communications worker and SendGrid
events remain authoritative for sent and delivered state. Explicit client or
studio confirmation marks remaining scheduled sequence items `skipped`.

## Pilot consumers

The production-hardening pass adds bounded Scheduler consumers for provider,
email, AI, PDF, final-invoice, export, review, and health work. Each operation
is claimed transactionally, retried with exponential backoff, and moved to
`dead_letter` after exhaustion. Provider credentials are resolved and refreshed
from Secret Manager inside trusted compute.

Inbound COI files follow a separate safety gate: Storage finalize invokes the
private signature/ClamAV scanner, and only a clean result may consume quota and
enqueue Vertex AI extraction. Cloud Tasks and Pub/Sub now provide the primary
scale transport. The poller remains deliberately available for rollback and
recovery.

## Service objectives and replay

Platform health evaluates each queue independently: maximum acceptable backlog,
maximum age of the oldest eligible record, maximum dead-letter count, current
transport, and objective status.

Platform administrators can replay failed provider, email, AI, PDF,
automation-run, and domain-event records. Replay resets only transport state,
adds a unique replay ID, preserves original input and failure evidence, and
creates an audit record.
