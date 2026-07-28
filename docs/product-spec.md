# StudioCue Product Specification

## Product definition

StudioCue is an AI-enabled, multi-tenant operations platform for professional photography businesses. Wedding photography is the initial depth market, while the domain model and workflow engine must also support corporate, business, sports, school, and other event-based photography.

StudioCue is not simply a CRM. It is the operational system coordinating the client, studio team, subcontractors, venues, planners, vendors, and insurance agents. Its core promise is a reliable answer to one question: **is this project genuinely ready to execute?**

## Product principles

Every important view must make five things obvious:

1. The next action
2. The current blocker
3. The responsible party
4. The due date
5. Whether the item affects readiness

Business truth is deterministic. AI may extract, summarize, draft, recommend, generate a schedule proposal, and explain risk. AI may not decide that a contract is signed, an invoice is paid, a COI is legally sufficient, a user has permission, or a readiness gate is complete.

All business data is tenant-scoped. Every sensitive operation must verify authentication, active tenant membership, role, permission, and project assignment when applicable. Meaningful user, provider, AI, and system actions are audited.

## Personas and access

- **Platform super admin:** tenant operations, subscriptions, integration health, failed jobs, support, feature flags, audit, and system health. Support access is explicit and audited.
- **Studio owner:** tenant administration, billing, team, packages, workflows, integrations, projects, reports, exceptions, and waivers.
- **Studio admin:** day-to-day studio operations across leads, clients, projects, documents, schedules, vendors, crew, and communications.
- **Studio coordinator:** assigned/permitted projects, questionnaires, schedules, vendors, tasks, client communication, and crew.
- **Staff photographer:** assigned projects, job details, contacts, shot lists, uploads, checkpoints, and schedule acknowledgement.
- **Client:** only their project, package, contract, payment links, questionnaires, schedule, approved documents, messages, delivery, and review links.
- **Subcontractor:** only accepted or pending assignments and the minimum job, schedule, contact, compensation, and document information allowed.
- **Guest vendor/venue/planner/insurance agent:** a narrow request or document through a revocable, expiring link.

## Product areas

### Public experience

Premium marketing pages cover the product, features, pricing, integrations, and vertical solutions. Tenant-branded inquiry pages provide rate-limited lead intake with spam protection, consent, duplicate detection, availability signals, source tracking, acknowledgement, assignment, and AI-supported summarization.

### Studio workspace

The studio navigation includes Dashboard, Leads, Projects, Calendar, Clients, Vendors, Crew, Packages, Workflow Templates, Documents, Reports, Integrations, Team, Subscription, and Settings. The dashboard emphasizes today’s work, at-risk projects, upcoming readiness, pipeline, and QuickBooks-synced financial references.

### Client workspace

The client portal shows a project summary and next action first, followed by package, contract, payment links, questionnaires, schedule review, approved documents, messages, delivery, and reviews.

### Crew workspace

The crew portal provides pending and accepted jobs, assignment acceptance, availability, required documents, event-day details, schedule segments, contact sheet, calendar link, and current schedule acknowledgement. Client financial data and unrelated project detail are excluded.

### Platform administration

Platform operations cover tenants, users, subscriptions, integration health, failed jobs, feature flags, audited support access, logs, and system health.

## Lifecycle

The default wedding state machine is:

`LEAD → CONSULTATION → PROPOSAL → CONTRACT_PENDING → RETAINER_PENDING → BOOKED → PLANNING → READY → EVENT_COMPLETE → POST_PRODUCTION → DELIVERED → REVIEW_REQUESTED → CLOSED → ARCHIVED`

`CANCELLED` and `POSTPONED` are controlled branches. Transitions are explicit and audited. Privileged overrides require reason, actor, time, prior state, and target state.

The booking gate requires a completed Docusign envelope, a created retainer invoice, paid retainer or approved exception, available event date, and complete required contact details. Successful booking idempotently creates Dropbox folders, a calendar event, portal access, workflow run, dated tasks, checkpoints, confirmation, and audit evidence.

## Operational engines

### Workflow engine

The normalized model is `Trigger → Conditions → Actions → Completion Evidence`. Runs include workflow version, idempotency key, input snapshot, attempts, result, retry state, timestamps, and correlation data. Invoice, folder, contract, assignment, event, and message side effects use stable idempotency keys.

### Checkpoint engine

Checkpoints define ownership, due-date rules, visibility, blocking status, dependencies, completion method, evidence, reminders, escalation, waiver permission, status, and completion actor. Completion is driven by deterministic evidence such as form submission, provider webhook, invoice reconciliation, schedule approval, assignment acceptance, or a privileged manual action.

### Readiness engine

Readiness is calculated from required blocking checkpoints. Default wedding requirements cover contract, retainer and final balance, questionnaire, venue and contacts, approved run of show, COI when needed, accepted crew, current schedule acknowledgements, locations, travel, and shot list. A waiver requires permission and a reason and may expire.

### Automation and jobs

Cloud Tasks handles asynchronous provider work, PDF creation, email/SMS, AI, uploads, reconciliations, relative dates, invoices, reminders, review requests, health checks, retries, and readiness recalculation. Pub/Sub distributes normalized domain events. Failed terminal jobs enter a dead-letter path visible to platform administrators.

## Core product capabilities

- Custom lead intake, consultations, calendar availability, Zoom meetings, reminders, rescheduling, and timezone-safe conflict detection
- Versioned packages and immutable price/package snapshots
- Versioned proposals with branded PDFs, acceptance, expiry, and supersession
- Docusign templates, signers, envelopes, webhooks, completed documents, certificates, hashes, and Dropbox archival
- QuickBooks customer matching, hosted invoices, partial payments, status reconciliation, void/refund awareness, and scheduled final invoices
- Dropbox folder and document operations based on provider IDs and revisions rather than names alone
- Versioned conditional questionnaires with save/resume and internal/client field controls
- Reusable vendor records and complete COI request, inbound attachment, AI extraction, discrepancy review, human approval, venue delivery, and archival
- Crew profiles, invitations, acceptance, job briefs, documents, calendar acknowledgement, and mobile event-day access
- Structured, versioned run-of-show schedules with conflict checks, approvals, publishing, PDF, Dropbox, and renewed acknowledgements
- Post-production milestones, manual gallery delivery URLs, configurable review requests, and project closeout
- Reporting for conversion, revenue references, balances, readiness, cycle time, COI, crew, schedules, task completion, reviews, integration reliability, and automations

## Provider integrations

Required provider adapters are QuickBooks Online, Google Calendar, Zoom, Dropbox, Docusign, Stripe, SendGrid, Twilio, and Vertex AI. Each adapter supports connection lifecycle, health, normalized errors, tenant configuration, retry behavior, local mock mode, provider identifiers, webhook normalization, and least-privilege OAuth scopes.

QuickBooks is the accounting system of record. Docusign completion is the contract-signing authority. Provider webhooks are signature-verified, stored idempotently, normalized to internal domain events, and safe to replay.

## SaaS packaging

Entitlements—not plan-name conditionals—control limits and capabilities.

- **Solo:** $69 monthly / $690 yearly; one internal user, one brand, 500 monthly AI actions, ten active subcontractor relationships.
- **Studio:** $199 monthly / $1,990 yearly; five internal users, unlimited subcontractors, COI, custom workflows, advanced schedules/reports, Zoom, SMS, 2,500 AI actions.
- **Multi-Brand:** $399 monthly / $3,990 yearly; fifteen internal users, three brands, branded subdomains, API access, advanced reporting, 7,500 AI actions.

Additional users, brands, SMS, and AI usage are add-ons. Setup and migration services remain outside automated billing initially.

## Safety and privacy

Sports workflows do not create child accounts, message children directly, use facial recognition, publish child profiles, or collect unnecessary birthdates. Parents/guardians manage releases and access. Retention and deletion are configurable. StudioCue must not claim automatic legal compliance; customers should obtain counsel for child-directed workflows.

Signed Docusign documents are never modified. Card and bank credentials are never stored. OAuth refresh tokens never reach the browser and are never stored as Firestore plaintext.

## Delivery sequence

The implementation follows eight build milestones: foundation; core CRM; workflow platform; booking; planning; crew; post-event; and SaaS operations. Each milestone must finish with type checking, linting, tests, a production build, and an updated build log.
