# StudioCue support and recovery runbook

Use this runbook for pilot support. Preserve the failed record and its
correlation, provider-event, or idempotency key; never “fix” a failure by
deleting evidence.

## First response

1. Identify the tenant, project, capability, correlation ID, and last successful
   lifecycle state.
2. Check **Platform Admin → System health** and **Failed jobs**.
3. Confirm whether the failure is internal, provider-side, authentication,
   quota, invalid input, or a deterministic business gate.
4. Record an `incidentRecord` for any customer-impacting defect. S1 and S2
   incidents keep the launch gate red until resolved or closed.
5. Before retrying, confirm the operation has a stable idempotency key and that
   no authoritative provider side effect already succeeded.

## Safe recovery matrix

| Failure | Evidence to inspect | Safe action | Never do |
| --- | --- | --- | --- |
| Studio Import processing | import item safety, checksum, scanner result, failure code | retry only when marked retryable; re-upload after a non-retryable signature/type failure | bypass quarantine or mark a failed scan clean |
| Import activation mistake | asset active-version pointer and immutable versions | roll back to a prior approved version | edit an active version in place |
| AI draft failure | AI action sources, validation issues, model/instruction version | correct sources or retry as a new action | convert AI output into payment, signature, insurance, or approval truth |
| Automation failure | action receipt, automation run, attempts, provider evidence | use Retry when enabled; use Cancel before execution when enabled | create an untracked duplicate action |
| Duplicate webhook | webhook event ID/hash and processed status | return the recorded result; no second domain transition | mutate the original provider event |
| Expired crew offer | current cascade assignment, expiry, candidate index | let the expiry scheduler advance exactly one approved candidate; escalate if exhausted | reactivate an old token or contact multiple candidates simultaneously |
| Calendar/Zoom/Dropbox failure | provider job, connection health, remote ID/idempotency ID | reconnect if required, then retry the same provider job | create a second remote resource without checking the provider ID |
| Docusign mismatch | envelope ID, signer map, Connect event, completion evidence | reconcile from Docusign and require studio review | mark a contract complete from AI or browser state |
| QuickBooks mismatch | company/realm, invoice ID, total, balance, payment event | reconcile from QuickBooks; correct the accepted package mapping if needed | mark an invoice paid from StudioCue |
| Schedule correction | published version, source trace, change impact | publish a new immutable version and reset crew acknowledgement | edit a published schedule or leave stale acknowledgements valid |
| Album reminder | workflow status and reminder stop statuses | skip queued reminders once evidence exists | send after selections, approval, or fulfillment is recorded |
| Closeout blocked | project closeout requirement evidence | resolve the named requirement and prepare closeout again | waive a missing provider or crew requirement through AI |

## Retry and cancellation

- A retry increments the recorded attempt and preserves the same logical
  operation identity.
- A cancel is available only before an irreversible or provider-confirmed side
  effect.
- A retry that reaches the dead-letter limit requires operator review.
- Provider timeouts are ambiguous. Read the provider using the stable remote ID
  before resubmitting.
- Product events record retry and cancellation outcomes; action receipts explain
  the affected entity and provider evidence in plain language.

## Rollback

- Studio assets: activate a prior immutable approved version.
- Email templates: activate a prior immutable template version.
- Schedules: publish a corrected version; do not mutate the published record.
- Workflow transport: disable task dispatch and use the scheduler recovery path
  described in `docs/internal-roadmap-completion.md`.
- Application release: restore the prior immutable hosting and Functions
  revisions, then run the smoke and authority suites before reopening writes.

## Incident closure

An incident can move to `resolved` only after the corrective action is verified.
Close it after monitoring confirms no recurrence and the regression test or
operating control is linked. Any open S1/S2 incident blocks release.
