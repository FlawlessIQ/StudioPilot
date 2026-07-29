# ADR 0004: Durable asynchronous transport

Status: Accepted
Date: 2026-07-29

## Context

StudioCue originally used Firestore-backed queues with a minute-level Scheduler
poller. That design was safe and idempotent, but added latency, concentrated
throughput in a single poller, and made per-job retries less observable. Domain
events were also consumed directly from Firestore, coupling the outbox to a
single workflow consumer.

## Decision

- Firestore remains the durable job and event outbox.
- Firestore write triggers dispatch provider, email, AI, and PDF job IDs to a
  named Cloud Tasks worker.
- Cloud Tasks controls concurrency, exponential retry, and delivery attempts.
- The Scheduler poller remains as a recovery transport for documents that were
  not dispatched or whose task delivery was interrupted.
- Normalized domain events are published to the
  `studiocue-domain-events` Pub/Sub topic.
- A Pub/Sub consumer invokes versioned workflow evaluation by event ID.
- An outbox Scheduler republishes events that remain pending or enter
  `publish_retry`.
- Job and event documents retain idempotency keys, processing leases, attempt
  counts, replay IDs, timestamps, and dead-letter evidence.

## Consequences

- A task or Pub/Sub message may be delivered more than once; consumers must
  remain idempotent.
- Firestore is the auditable source of execution state, while Cloud Tasks and
  Pub/Sub provide transport.
- Queue service objectives and replay controls can be calculated consistently
  across provider, email, AI, PDF, automation, and domain-event work.
- The recovery poller provides a rollback path: task dispatch can be disabled
  without abandoning queued Firestore records.
