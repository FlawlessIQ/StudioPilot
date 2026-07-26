# Event Readiness Engine

## Authority

Readiness is deterministic. AI may summarize risk or draft a message, but cannot
complete checkpoints, approve insurance, mark invoices paid, confirm signatures,
grant permissions, issue waivers, or set a project Ready.

## Calculation

Only checkpoints marked `blocking` determine the readiness score:

`satisfied blocking checkpoints / total blocking checkpoints`

A blocker is satisfied only when complete or covered by an authorized,
unexpired waiver. Failed, incomplete, or expired-waiver checkpoints remain
blockers. Non-blocking checkpoints can appear overdue or at risk but do not lower
the score.

The projection contains score, Ready / Not Ready, required and satisfied counts,
blockers, overdue items, seven-day risk items, owner, resolved deadline,
recommended next action, calculation timestamp, and rules version.

## Ready transition gate

The project service and authenticated CRM state-transition command independently
check the canonical readiness assessment before allowing `PLANNING → READY`.
Neither a browser value nor a numeric score alone is trusted. The assessment must
belong to the same tenant and have `ready: true`.

If a blocker reopens or a waiver expires, recalculation makes the project Not
Ready. The state machine allows a Ready project to return to Planning.

## Projection storage

`readinessAssessments/{projectId}` is the current deterministic projection. It
updates together with checkpoint resolution and project summary fields in the
trusted transaction. Audit events preserve business history.
