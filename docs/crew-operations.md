# Crew Operations

Milestone 6 adds a tenant- and project-scoped subcontractor lifecycle. `crewProfiles` describe the reusable business relationship; `crewAssignments` are project-specific snapshots of role, compensation visibility, timing, locations, responsibilities, schedule segments, requirements, and acknowledgement evidence. `crewAvailability` is advisory and never replaces an accepted assignment.

## Staffing, prepared at booking

Coverage on the booked package says who the studio sends. `features/crew/staffing-plan.ts`
turns that into the roles still to hire — the studio is one of the people it
sends, so the lead place is its own — and ranks each role against the trade it
calls for: video against `video`, photography against the event's own specialty.
Candidates are dealt a round at a time, so nobody is offered two roles on the
same day and no role is starved by the one before it. A role nobody can work
stays in the plan carrying its reason rather than being dropped.

The booking side-effects worker runs this as its `crew_plan` step and writes
`crewStaffingPlans/{projectId}` (studio-read, never client-written). By default
it stops there and the studio sends the offers from the staffing screen in one
action; `crewOffers.autoOfferOnBooking` on the tenant — owner-only, audited, set
from Settings → Crew — releases the first offer of each role instead. An
imported booking is never auto-offered.

`crewRequired` on the readiness engine and the journey rail comes from the same
place. It used to count the assignments that already existed and fall back to a
flat 1, so a job needing three people read as needing one.

## Deterministic lifecycle

Assignment status changes use an explicit transition table. Invitations are idempotent, expire after seven days, store only a SHA-256 token hash on the assignment, and queue the one-time raw token only in the server-owned email job. Acceptance, decline, calendar acknowledgement, requirement submission/review, and schedule acknowledgement are authenticated commands with audit events.

Only an accepted assignment can acknowledge a calendar or schedule. The submitted schedule ID and version must match the assignment's current schedule. Publishing a newer schedule updates every accepted assignment and clears its prior acknowledgement; readiness therefore cannot be satisfied by an obsolete version.

## Access and documents

Subcontractors can read only their own profiles, availability, assignments, project-scoped crew documents, relevant contacts, and assigned schedules. Firestore blocks direct assignment mutations, invoice access, other crew profiles, and other crew assignments. Commands perform the same membership, project, role, and assignment ownership checks server-side.

Crew uploads use the authenticated path `tenants/{tenantId}/projects/{projectId}/crew/{userId}/...`. Storage Rules require the path user to match the authenticated subcontractor, require project assignment, validate content type and size, and prohibit replacement or deletion. PDF, JPEG, and PNG uploads are limited to 10 MB by the interface and 25 MB by the platform guard. Submitted financial, signature, or insurance evidence remains under studio review; the uploader cannot self-approve it.

## Mobile event-day view

The crew portal exposes pending and accepted jobs, current requirements, scoped documents, profile/availability, and a mobile timeline containing only assigned segments. The event-day view provides timezone, current version, call time, responsibilities, relevant contacts, parking/location information, directions, calendar download, and a persistent acknowledgement action. Client financials and unrelated project data never appear.

Production operation requires Firebase Authentication, App Check, Storage, the Crew Functions URL, transactional email delivery, and the existing scheduler/job workers.
