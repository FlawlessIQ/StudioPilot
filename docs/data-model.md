# StudioHub Data Model

## Collection strategy

StudioHub uses top-level Firestore collections with mandatory `tenantId` fields and
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

## Immutability and deletion

- package snapshots and audit events are append-only
- project state changes use optimistic versions
- packages are versioned rather than rewritten for existing projects
- lead, contact, package, event-type, and project history uses archival fields
- hard deletion is reserved for the documented tenant deletion workflow

## Required indexes

Indexes are defined for tenant-scoped project dates, lead duplicate and recency
queries, normalized contact lookup, active package ordering, project snapshots, and
tenant slug resolution. `tenantId` is the leading field for business-record
indexes.
