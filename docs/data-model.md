# StudioCue Data Model

## Collection strategy

StudioCue uses top-level Firestore collections with mandatory `tenantId` fields and
mandatory `projectId` fields on project-scoped records. This supports tenant-wide
dashboards without collection-group fan-out while keeping repository queries,
indexes, exports, and retention policies consistent.

All server repositories receive `tenantId` explicitly and include it in every
business query. A returned document is validated with Zod before it crosses the
repository boundary. Browser access is narrower than repository access and is
enforced by Firestore Rules.

## Milestone 2 collections

### `contacts`

Reusable people and companies. Normalized email and phone fields support duplicate
detection without replacing the original user-entered values. `projectIds` scopes
staff-photographer access to relevant contacts. A contact can be a prospect, client,
vendor, venue, planner, insurance agent, corporate contact, guardian, or another
tenant-defined relationship.

Contacts are archived with `archivedAt`; business history is not hard-deleted.

### `leads`

One record per inquiry, including event facts, source, owner, missing-information
flags, duplicate evidence, and the linked contact. Public writes never reach
Firestore directly. The `publicLeadIntake` function validates, rate-limits,
duplicate-checks, creates the lead/contact, and appends an audit event with one
server-side batch.

AI fields begin empty. Later AI enrichment may summarize or suggest questions, but
cannot create prices or confirm availability.

### `eventTypeTemplates`

Tenant-scoped project-type defaults. The initial seed includes Wedding, Corporate,
and Sports. Records reference default workflow and questionnaire templates without
embedding mutable workflow definitions.

### `projects`

The operational aggregate root. It stores event identity, current deterministic
state, `stateVersion` for optimistic concurrency, contact links, optional lead and
package-snapshot links, readiness projection, and next action.

Allowed state changes live in the state machine. The command endpoint rechecks the
transition and expected version inside a Firestore transaction. Every successful
change creates an immutable audit event.

### `packages`

Versioned tenant offerings. Money is represented as integer cents and percentage
values as basis points. Included services, travel, deliverables, tax rules, add-ons,
retainer rules, public visibility, and internal notes are validated as one package
version.

The trusted command endpoint owns package writes. Browser clients may not write a
package document directly.

### `packageSnapshots`

Immutable project pricing evidence created at selection. A snapshot copies the
package version, price, selected add-ons, discount, tax, retainer, total, coverage,
deliverables, travel, and terms. Later edits to the source package cannot affect it.

Selection is transactional and idempotent. A project can attach its initial package
snapshot only once through the current command. Future superseding selections will
create a new snapshot with an explicit supersession record rather than mutate the
old one.

### `commandExecutions`

Server-only idempotency records keyed by tenant and caller-provided idempotency key.
Successful contact, project, transition, package, and package-selection commands
store their normalized result. Retries return that result instead of repeating side
effects.

### `publicRateLimits`

Server-only fixed-window lead-intake counters based on a one-way request
fingerprint. The browser cannot inspect or change them.

## Milestone 3 collections

### `workflowTemplates`

Published, immutable definitions scoped by tenant and event type. Each version
embeds checkpoint templates and normalized automation rules. New versions
supersede prior active versions without changing active project runs.

### `workflowRuns`

Project instances containing the exact workflow version, input snapshot, template
snapshot, checkpoint IDs, start/completion state, and failure evidence.

### `checkpoints`

Project-specific workflow and readiness gates with resolved due dates, dependency
IDs, completion method, evidence requirements, status, waiver authority, evidence,
and completion actor.

### `tasks`

Owned studio work with project/run/checkpoint relationships, due date, priority,
blocking flag, status, and completion evidence.

### `automationRuns`

Idempotent executions with workflow version, trigger, input snapshot, attempts,
normalized errors, retry state, result, and manual-rerun lineage.

### `readinessAssessments`

Canonical current project projection used by dashboards and the Ready transition
gate. It contains deterministic score, blockers, risk, overdue items, responsible
party, next action, and rules version.

## Milestone 4 collections

`consultations` store timezone-safe appointment state and provider meeting/event
IDs. `proposals` are immutable, superseding versions containing client, event,
package, pricing, payment, and terms snapshots. `contracts` and
`invoiceReferences` store normalized Docusign and QuickBooks evidence without
containing signature secrets or payment credentials.

`documents` reference provider file IDs, revisions, hashes, paths, content type,
and visibility. `integrationConnections` store status and Secret Manager
references, never OAuth refresh-token plaintext. `webhookEvents`,
`bookingGateRuns`, `providerJobs`, and `pdfJobs` are server-only operational
records used for deduplication, evidence, retries, and isolated rendering.

## Milestone 5 collections

`questionnaireTemplates` and `questionnaireResponses` preserve template versions
and structured answers. `vendors` support multi-project associations.
`insuranceRequirements` and `insuranceRequests` separate venue requirements,
inbound evidence, AI extraction, discrepancies, and human decisions. `schedules`
embed structured items and preserve immutable published versions. `aiJobs` stores
server-only extraction and schedule-draft work; AI output is never approval
evidence.

## Milestone 6 collections

`crewProfiles` store tenant-scoped reusable collaborator relationships, service
areas, rates, equipment, compliance references, and an optional portal user.
`crewAssignments` are project-scoped snapshots of invitation terms, role,
compensation visibility, responsibilities, locations, requirements, calendar
evidence, and current schedule acknowledgement. `crewAvailability` stores
user-owned availability windows used for shortlisting. `emailJobs` is
server-only and carries short-lived invitation delivery work.

Files remain in Cloud Storage under a tenant, project, and user-prefixed path.
Assignment requirements store file references and review evidence, never raw
file bytes.

## Milestone 7 collections

`postProductionRecords` contain evidence-backed completion state for backup,
culling, editing, gallery readiness, delivery, download, and archive.
`deliveryRecords` normalize gallery provider references, access metadata, and
sent/viewed/downloaded evidence. `reviewRequests` preserve each scheduled
sequence item and its engagement or explicit confirmation state.
`projectCloseouts` snapshot deterministic closeout gates and completion
evidence. `reportJobs` is server-only asynchronous CSV work.

## Milestone 8 collections

`subscriptions` contain Stripe references, normalized state, billing period,
resource counts, and an exact entitlement snapshot. `usageCounters` are
tenant/month projections for AI actions, SMS segments, and API requests.
`featureFlags` are platform-owned rollout controls and never replace entitlement
or permission checks. `supportAccess` records reasoned, expiring platform access.
`systemHealth` stores normalized tenant/provider and platform component checks.
`providerJobs` carries attempts, normalized error, dead-letter state, and manual
rerun evidence.

## Immutability and deletion

- package snapshots and audit events are append-only
- published workflow versions and active-run template snapshots are immutable
- project state changes use optimistic versions
- packages are versioned rather than rewritten for existing projects
- lead, contact, package, event-type, and project history uses archival fields
- hard deletion is reserved for the documented tenant deletion workflow

## Required indexes

Indexes are defined for tenant-scoped project dates, lead duplicate and recency
queries, normalized contact lookup, active package ordering, project snapshots,
workflow versions and active runs, open tasks, automation idempotency and failures,
consultation dates, proposal versions, project contract/invoice status, integration
health, crew availability, assignment status and dates, and tenant slug
resolution. `tenantId` leads business-record indexes.
