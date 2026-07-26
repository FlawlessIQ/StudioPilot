# ADR 0001: Top-level tenant-scoped Firestore collections

- Status: Accepted
- Date: 2026-07-26

## Context

StudioHub dashboards frequently query records across multiple projects in one tenant. Deep project subcollections simplify some project reads but complicate tenant-wide reporting, operational queues, exports, and consistent repository behavior.

## Decision

Use top-level collections for business entities. Every tenant business record carries `tenantId`; project-specific records also carry `projectId`. Composite indexes begin with tenant scope. Repository methods require tenant context and security rules compare the record tenant to a deterministic membership document.

## Consequences

Tenant-wide queries are direct and domain repositories remain uniform. The design depends on mandatory schema validation, tenant-first indexes, and tests that prevent a repository or rule from omitting tenant scope.
