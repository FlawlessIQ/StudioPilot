# StudioHub Architecture

## System overview

StudioHub separates interactive application rendering, trusted business execution, asynchronous orchestration, and provider integration.

```text
Browser / PWA
    │ Firebase Auth + App Check
    ▼
Next.js application ───────────────► Cloud Functions (trusted commands/webhooks)
    │                                      │
    │                                      ├─ Firestore / Storage
    │                                      ├─ Cloud Tasks / Scheduler
    │                                      ├─ Pub/Sub domain events
    │                                      └─ Secret Manager
    │
    └─ public marketing + role-specific app shells

Cloud Run
    └─ PDF, document extraction, safe file processing, and heavier AI work

Provider adapters
    ├─ QuickBooks Online
    ├─ Google Calendar / Zoom
    ├─ Dropbox / Docusign
    ├─ SendGrid / Twilio
    ├─ Stripe
    └─ Vertex AI
```

App Hosting reaches private second-generation HTTP Functions through their
Cloud Run service URIs. The relay mints a Google ID token whose audience exactly
matches that URI and forwards the end-user Firebase bearer token separately.
This avoids making command Functions public while preserving the user identity
needed by server authorization.

The Next.js project is currently packaged through a Cloudflare-compatible web runtime for preview and deployment. Firebase Admin code is kept outside the browser bundle and runs in Cloud Functions/Cloud Run. This preserves the requested Firebase trust boundary and avoids placing service credentials in the web runtime.

## Repository structure

- `app/`: public, auth, studio, client, crew, platform admin, and API routes
- `components/`: shared design-system and application shell components
- `features/`: domain schemas, policies, deterministic engines, and use cases
- `lib/`: framework-neutral helpers and browser-safe Firebase initialization
- `server/`: Admin SDK repositories, services, events, jobs, and provider adapters
- `functions/`: Cloud Functions commands, callbacks, and webhooks
- `cloud-run/`: heavier document and AI services (introduced with the relevant milestone)
- `scripts/`: safe local seed and operational scripts
- `tests/`: unit, policy, rules, integration, and later end-to-end tests
- `docs/`: product, architecture, security, operations, and ADRs

UI components do not contain business-state transitions, readiness decisions, billing decisions, or provider logic.

## Multi-tenancy and identity

Firebase Authentication owns identity. A user may have memberships in multiple tenants. The membership document controls role, explicit permissions, status, and permitted project IDs.

The membership document ID is `${tenantId}_${userId}`. This deliberate denormalization lets Firestore Security Rules resolve one deterministic document without a query. Every tenant business document carries `tenantId`; every project-specific document also carries `projectId`.

Sensitive command authorization checks:

1. Verified Firebase identity and email state
2. Active membership in the requested tenant
3. Role-derived or explicit permission
4. Project assignment or portal relationship where applicable
5. Subscription entitlement
6. Request schema and business preconditions

Client-side role presentation is convenience only and never the authority.

## Firestore collection strategy

StudioHub uses top-level collections with mandatory tenant keys rather than deeply nesting all records.

Advantages:

- consistent repository and audit patterns
- efficient cross-project tenant dashboards
- straightforward collection queries and composite indexes
- easier lifecycle, export, and retention operations
- rules can enforce tenant identity while project assignment remains explicit

The strategy requires every repository query to include `tenantId`. Repositories accept the tenant as a required argument and reject a returned record whose tenant does not match. Indexes start with `tenantId` for tenant-scoped access patterns.

Major collections include users, tenants, memberships, tenantInvitations, contacts, leads, projects, eventTypeTemplates, packages, packageSnapshots, proposals, contracts, invoiceReferences, questionnaireTemplates, questionnaireResponses, workflowTemplates, workflowRuns, checkpoints, tasks, schedules, scheduleItems, vendors, insuranceRequirements, insuranceRequests, crewProfiles, crewAssignments, documents, messages, messageTemplates, integrationConnections, webhookEvents, automationRuns, auditEvents, subscriptions, featureFlags, notifications, reviewRequests, and deliveryRecords.

The implemented Core CRM model and access patterns are documented in
[`docs/data-model.md`](./data-model.md). Public lead intake and authenticated CRM
commands run through Cloud Functions; browsers have no direct create permission for
leads, packages, package snapshots, command executions, rate-limit counters, or
audit events.

Immutable/versioned records:

- package snapshots
- accepted proposal versions
- contract evidence
- workflow run input/version
- approved and published schedule versions
- audit events
- provider webhook payload hashes

Mutable root records reference the current immutable version.

## Domain events and idempotency

Provider webhooks are verified, hashed, and inserted once into `webhookEvents` under a provider-derived unique key. A normalized `DomainEvent` carries event ID, tenant, optional project, type, time, source, correlation ID, and untrusted payload.

Handlers create an automation run with a stable idempotency key before any side effect. Unique resource operations—invoice, folder, envelope, event, assignment, or message—persist the key and provider ID. Retries return the prior result when the key already completed.

## Provider boundaries

The interfaces in `server/integrations/contracts.ts` normalize lifecycle, health, errors, provider identifiers, and output types. Live adapters retrieve encrypted credentials server-side. Development adapters return deterministic mock behavior without contacting third parties.

Refresh tokens are encrypted with a KMS/Secret Manager protected key or stored directly in Secret Manager depending on operational scale. They are never included in Firestore documents visible to clients.

## AI boundary

The `AiProvider` accepts a routing task and a Zod output schema. Structured output is parsed and rejected on schema failure. Tenant/project retrieval is permission-scoped before prompt construction.

Model output is advisory. The schedule generator produces a draft with assumptions, missing information, conflicts, risks, and questions. COI extraction highlights discrepancies for human review. No AI call can write legal, payment, signature, permission, or readiness completion fields.

The deployed tenant Copilot retrieves only projects permitted by the active
membership. Its structured response separates facts from suggestions and may
cite only application records included in the scoped retrieval set. It does not
execute actions. AI usage is charged transactionally against the subscription
entitlement before model execution and every completed interaction creates an
audit event.

## Portal activation

Staff, client, and crew activation use separate invitation boundaries. Raw
invitation tokens are returned once and sent through the queued communication
worker; Firestore stores only their SHA-256 hashes. Acceptance requires a
Firebase user whose verified email exactly matches the invited record.

- staff invitations create a tenant role but no project access by default
- client invitations add only the named project and link its contact record
- crew invitations add only the assignment project and link the crew profile

Tokens expire after seven days. Role conflicts, already-linked records, reused
tokens, cross-tenant records, and unassociated projects are rejected by the
trusted command before any membership mutation.

## Communications and insurance

Queued email jobs are processed idempotently by the operations scheduler.
Successful mock or live sends create a normalized `messages` record; raw
provider delivery events update that history only after SendGrid signature
verification. Bounce, drop, spam, delivery, open, and click events remain
delivery evidence rather than business-completion evidence.

COI requests create a unique project request address backed by a one-way reply
token. Inbound Parse accepts one bounded PDF, verifies its file signature,
places it in restricted Cloud Storage, and waits for the file-safety trigger.
AI extracts and compares fields but always leaves `humanDecision` pending. Only
authorized studio users can approve/reject and supply a reason. Approval may
queue Dropbox archival; venue delivery attaches the reviewed source PDF.

## Runtime and background processing

- Cloud Functions: command endpoints, session exchange, OAuth callbacks, lightweight webhooks
- Cloud Tasks: retried and delayed work with exponential backoff
- Scheduler: reconciliations, relative-date triggers, health checks, reminders
- Pub/Sub: internal domain-event distribution
- Cloud Run: PDF rendering, attachment processing, malware-scan integration, Vertex AI orchestration
- Cloud Storage: temporary restricted processing files
- Dropbox: tenant-selected business archive

All jobs include correlation ID, tenant, attempts, input snapshot, status, error, and timestamps. Dead-letter jobs appear in platform administration and support a guarded manual rerun.

The implemented workflow and readiness boundaries are described in
[`docs/workflow-engine.md`](./workflow-engine.md),
[`docs/readiness-engine.md`](./readiness-engine.md), and
[`docs/background-jobs.md`](./background-jobs.md).

Milestone 4 adds typed consultation, proposal, contract, invoice-reference,
document, integration-connection, and booking-gate boundaries. Google Calendar,
Zoom, Docusign, QuickBooks Online, and Dropbox use normalized adapters with
explicit development mocks. Signature-verified provider events are the only
external completion evidence accepted by the deterministic booking gate.
Proposal rendering runs in isolated Cloud Run infrastructure from immutable
snapshots; signed Docusign files are never regenerated.

## Observability

Structured logging includes correlation, tenant, project, automation run, provider, severity, and outcome without logging secrets or raw sensitive documents. Sentry captures web and function failures. Audit events record business actions; operational logs record system execution. These are separate concerns and retention policies.
