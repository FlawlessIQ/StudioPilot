# Workflow Engine

## Model

StudioHub workflows use:

`Trigger → Conditions → Actions → Completion Evidence`

A workflow template is a tenant-scoped, event-type-specific version containing
checkpoint definitions and automation rules. Published versions are immutable.
Starting a project workflow creates a `workflowRun` with:

- the exact template version
- an input snapshot of project dates and state
- a template snapshot of checkpoints and automation rules
- resolved checkpoint identifiers and due dates

Edits create a new template version. Active runs never inherit later edits unless
a future explicit migration operation is authorized and audited.

## Relative dates

Relative due dates support event date, project creation, booking date, and
workflow start anchors. The resolver uses date-only UTC arithmetic so results do
not drift across server timezones or daylight-saving changes. Missing anchors
fail the workflow start instead of silently inventing a date.

Resolved due dates are stored on checkpoint instances. Changing a template rule
later does not move existing project deadlines.

## Checkpoint dependencies

Checkpoint templates reference dependency keys. Instantiation first allocates all
checkpoint IDs, then resolves keys to immutable instance IDs. A checkpoint with
no dependencies begins `ready`; dependent checkpoints begin `not_started`.

Completing a checkpoint requires authentication, tenant membership, completion
permission, project access, resolved dependencies, and required evidence.
Resolution unlocks dependants whose complete dependency set now passes.

## Waivers

Only a role with `checkpoints.waive` can waive. The default permission belongs to
the Studio Owner. A waiver requires a meaningful reason and may expire.

An expired waiver no longer satisfies readiness. Every waiver records actor,
reason, time, optional expiration, before/after state, correlation ID, and audit
evidence.

## Automation runs

Automation execution creates its idempotency record before actions run. A retry
with the same tenant-scoped key returns the existing run.

Each run stores workflow and rule version, trigger, input snapshot, action types,
attempts, normalized errors, retry state, results, and manual-rerun lineage.
Actions marked `requiresApproval` do not execute automatically.

## Trusted command boundary

Browsers cannot write workflow templates, runs, checkpoints, tasks, automation
runs, readiness assessments, or audit events directly. The `workflowCommand`
Cloud Function verifies App Check, Firebase identity, membership, role, project
assignment, schema, evidence, waiver rules, and idempotency inside trusted
transactions.
