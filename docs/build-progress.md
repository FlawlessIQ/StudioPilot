# StudioHub Build Progress

Last updated: 2026-07-26

## Milestone 1 — Foundation

Status: complete and validated.

Delivered:

- initialized Next.js App Router application with strict TypeScript and Tailwind
- premium public product experience and responsive app shells
- studio dashboard emphasizing next actions, blockers, ownership, and readiness
- client, crew, and platform-administration shells with scoped information
- Firebase browser initialization, Auth emulator support, and Admin SDK boundary
- tenant, user, membership, role, permission, audit, and project schemas
- deterministic project state machine with explicit transitions
- server authorization helper and tenant-scoped repository base
- Firestore and Storage rules, indexes, and emulator configuration
- secure Cloud Function session-exchange architecture
- normalized provider contracts plus local mock adapter
- entitlement model independent of Stripe plan names
- demo seed for every required role and representative project types
- unit, permission, tenant-isolation, state, schema, provider, entitlement, and rules tests
- architecture, product, security, local setup, and ADR documentation

Validation record:

- strict TypeScript: passed
- ESLint: passed with zero warnings
- unit and policy suite: 13 passed
- Firestore Emulator rules suite: 1 passed, including assigned-project access and cross-tenant denial
- Cloud Functions TypeScript build: passed
- production web build: passed
- production dependency audit: no high or critical runtime advisories; remaining inherited Google Cloud UUID advisories are moderate and tracked

Milestone 2 may begin without carrying a broken build forward.

## Milestone 2 — Core CRM

Status: implementation complete; final release validation recorded below.

Delivered:

- typed, tenant-scoped contact, lead, event-type, project, package, and package-snapshot schemas
- tenant-scoped Firestore repositories and service-layer authorization boundaries
- branded public inquiry form with React Hook Form, Zod, App Check, spam field, rate limiting, duplicate detection, contact reuse, audit logging, and honest mock preview mode
- authenticated, App Check protected CRM command endpoint for contacts, projects, state transitions, packages, and immutable package selection
- idempotent command execution records and optimistic project state versions
- exact integer-cent package calculations with basis-point discounts, taxes, and retainers
- dedicated responsive Leads, Projects, Project Detail, Clients, and Packages areas
- Wedding, Corporate, and Sports event-type seed records
- representative contacts, lead, package, and immutable snapshots in the emulator seed
- narrowed browser rules for CRM data, assigned-job contact access, and immutable snapshots
- composite indexes for lead intake, contact lookup, package browsing, snapshots, and tenant inquiry URLs
- Core CRM data-model documentation and automated lead/package tests
- desktop and mobile Playwright coverage for inquiry submission and CRM filtering

Validation record:

- strict TypeScript: passed
- Core CRM and existing unit/policy suite: 19 passed
- Firestore Emulator rules suite: passed, including client CRM denial, job-scoped contact access, cross-tenant denial, and snapshot immutability
- Playwright end-to-end suite: 4 passed across desktop and mobile Chromium
- Cloud Functions TypeScript build: passed
- ESLint: passed with zero warnings
- production web build: passed
- production dependency audit: no high or critical runtime advisories; inherited Google Cloud UUID advisories remain moderate and tracked

Milestone 3 may begin without carrying a broken build forward.

## Milestone 3 — Workflow Platform

Status: implementation complete; final release validation recorded below.

Delivered:

- typed workflow-template, workflow-run, checkpoint, task, automation-run, and readiness-assessment models
- immutable published workflow versions and exact template snapshots on project runs
- deterministic relative dates across event, booking, project-created, and workflow-start anchors
- dependency-aware workflow instantiation with idempotent active-run protection
- evidence-gated checkpoint completion and owner-only default waiver authority
- expiring waivers that stop satisfying readiness
- deterministic score, blocker, overdue, at-risk, owner, and next-action calculation
- readiness enforcement in project service and authenticated state-transition commands
- normalized automation conditions, typed action handlers, idempotency, retry scheduling, and approval-required actions
- tenant-scoped repositories and append-only audit repository
- App Check protected workflow commands for template creation, instantiation, checkpoint resolution, task operations, and readiness recalculation
- narrowed Firestore rules for role, project assignment, checkpoint visibility, and server-only mutations
- Wedding, Corporate, and Sports workflow seeds; Wedding contains the complete readiness baseline
- responsive Workflow Templates, Workflow Detail, Tasks, Readiness, Automation Runs, and Audit Log experiences
- workflow, readiness, background-job, and data-model documentation
- automated relative-date, snapshot, idempotency, dependency, evidence, waiver, readiness, and automation coverage

Validation record:

- strict TypeScript: passed
- unit and policy suite: 31 passed
- Firestore Emulator rules suite: passed, including workflow visibility, assigned-project access, server-only mutation, and cross-tenant denial
- Playwright end-to-end suite: 6 passed across desktop and mobile Chromium
- Cloud Functions TypeScript build: passed
- ESLint: passed with zero warnings
- production web build: passed
- production dependency audit: no high or critical runtime advisories; inherited Google Cloud UUID advisories remain moderate and tracked

Milestone 4 may begin without carrying a broken build forward.

## Milestone 4 — Booking

Status: implementation complete; final release validation complete.

Delivered:

- timezone-aware consultation scheduling with conflict and Calendar availability checks
- Zoom meeting and Google Calendar event orchestration with stable provider IDs
- immutable proposal versions with exact client, event, package, pricing, payment, and terms snapshots
- branded proposal preview plus isolated Cloud Run PDF service and visually verified fixture
- Docusign envelope references, signer ordering, completion evidence, and signed-file download contract
- QuickBooks customer/invoice contracts, hosted payment references, balance sync, and configurable final-invoice dates
- Dropbox folder/file contracts using IDs, revisions, canonical paths, and scoped temporary links
- deterministic booking gate with explicit retainer exceptions and idempotent completion steps
- App Check and Firebase Auth protected booking command endpoint
- signature-verified, idempotent Docusign and QuickBooks webhook endpoints
- studio Calendar, Proposals, Contracts, Invoices, Booking, and Integration Health areas
- client Package, Contract, and QuickBooks-hosted Payments areas
- provider mock mode, booking seeds, Firestore rules/indexes, tests, and operational documentation

Validation record:

- strict TypeScript: passed
- unit and policy suite: 41 passed
- Firestore Emulator rules suite: passed, including client booking visibility, staff financial denial, server-only provider state, and integration isolation
- Playwright end-to-end suite: 8 passed across desktop and mobile Chromium
- Cloud Functions TypeScript build: passed
- ESLint: passed with zero warnings
- production web build: passed
- expanded Firebase emulator seed: executed successfully
- proposal PDF: one-page Letter render visually inspected and logical text/page checks passed
- production dependency audit: no high or critical runtime advisories; inherited Google Cloud UUID advisories remain moderate and tracked

Milestone 5 may begin without carrying a broken build forward.

## Milestone 5 — Planning

Status: implementation complete; final release validation complete.

Delivered:

- versioned questionnaire templates/responses with conditional and locked field contracts
- reusable vendor and venue records with multi-project associations
- complete COI requirement/request state, hashed reply routing, inbound PDF validation, extraction jobs, discrepancy review, and mandatory human decisions
- structured, immutable run-of-show versions with conflict, travel, assignment, location, and coverage checks
- client review and approval state plus renewed crew acknowledgement on publication
- strict Vertex AI schedule draft schema separating items, assumptions, missing facts, conflicts, risks, and questions
- trusted planning command and SendGrid inbound endpoints
- studio Questionnaire, Vendor, COI, Schedule list, and timeline experiences
- client questionnaire and mobile schedule experiences
- branded schedule PDF fixture and planning seed data
- narrowed Firestore rules/indexes, automated tests, and planning documentation

Validation record:

- strict TypeScript: passed
- unit and policy suite: 47 passed
- Firestore Emulator rules suite: passed, including client schedule/questionnaire access, studio-only insurance, and server-only planning mutations
- Playwright end-to-end suite: 10 passed across desktop and mobile Chromium
- Cloud Functions TypeScript build: passed
- ESLint: passed with zero warnings
- production web build: passed
- expanded Firebase emulator seed: executed successfully
- schedule PDF: one-page Letter render visually inspected and logical text/page checks passed
- production dependency audit: no high or critical runtime advisories; inherited Google Cloud UUID advisories remain moderate and tracked

Milestone 6 may begin without carrying a broken build forward.

## Milestone 6 — Crew

Status: implementation complete; final release validation complete.

Delivered:

- typed crew profiles, availability, assignment terms, requirements, and status lifecycle
- explicit assignment transitions with acceptance and decline evidence
- idempotent, App Check protected crew commands with role, project, and exact assignment ownership checks
- expiring, one-way hashed invitation tokens and server-only email delivery jobs
- calendar file download plus authoritative calendar acknowledgement
- current schedule ID/version acknowledgement and automatic reset on every new publication
- deterministic crew-assignment readiness blockers
- secure project/user-scoped uploads with MIME, size, create-only, and human-review boundaries
- studio crew directory, assignment monitoring, readiness, and requirement evidence screens
- subcontractor pending/accepted jobs, schedule, requirements, documents, profile, and availability areas
- mobile event-day brief with scoped contacts, locations, directions, responsibilities, and persistent action bar
- narrowed Firestore and Storage rules, composite indexes, representative seeds, automated tests, and operations documentation

Validation record:

- strict TypeScript: passed
- unit and policy suite: 51 passed
- Firestore Emulator rules suite: passed, including exact subcontractor ownership, assigned-project access, financial denial, and server-only mutation
- Storage Emulator rules suite: passed, including own-user path, assigned-project, create-only, and MIME denial checks
- Playwright end-to-end suite: 12 passed across desktop and mobile Chromium
- Cloud Functions TypeScript build: passed
- ESLint: passed with zero warnings
- production web build: passed
- expanded Firebase Auth and Firestore emulator seed: executed successfully
- production dependency audit: no high or critical runtime advisories; inherited Google Cloud UUID advisories remain moderate and tracked

Milestone 7 may begin without carrying a broken build forward.

## Milestone 7 — Post-Event

Status: implementation complete; final release validation complete.

Delivered:

- typed post-production steps, delivery records, review requests, and project closeout snapshots
- deterministic post-production dependencies and delivery gate
- HTTPS gallery validation and manual provider support with future gallery adapter contracts
- atomic delivery recording, project state advancement, review scheduling, and audit evidence
- default review sequence at three and ten days after delivery
- hourly idempotent review-request scheduler and server-only email jobs
- explicit review confirmation that stops reminders without treating clicks as posted reviews
- deterministic closeout requirements, restricted completion, and closeout PDF job
- tenant-scoped report aggregation, date/project/user filters, CSV export, and print view
- studio post-production, delivery, reviews, closeout, and reports experiences
- client delivery and review-confirmation experiences
- Firestore rules/indexes, representative post-event seed data, automated tests, and operations documentation

Validation record:

- strict TypeScript: passed
- unit and policy suite: 56 passed
- Firestore Emulator rules suite: passed, including client delivery/review visibility, post-production denial, closeout denial, and server-only mutation
- Playwright end-to-end suite: 14 passed across desktop and mobile Chromium
- Cloud Functions TypeScript build: passed
- ESLint: passed with zero warnings
- production web build: passed
- expanded Firebase Auth and Firestore emulator seed: executed successfully
- production dependency audit: no high or critical runtime advisories; inherited Google Cloud UUID advisories remain moderate and tracked

Milestone 8 may begin without carrying a broken build forward.

## Milestone 8 — SaaS Operations

Status: implementation complete; final release validation complete.

Delivered:

- Stripe Checkout and Customer Portal command with owner membership, Firebase Auth, and App Check enforcement
- raw-body, timestamped HMAC Stripe webhook validation with provider-event idempotency
- normalized subscription snapshots, configured price mapping, and immutable entitlement snapshots
- deterministic internal-user, brand, subcontractor, and monthly AI quota enforcement
- tenant/month AI, SMS, and API usage schemas plus quota projections
- 15-minute integration health scheduler with normalized operational snapshots
- platform-admin commands protected by custom claim and App Check
- audited feature flags, tenant suspension, expiring support access, and controlled dead-letter reruns
- studio Subscription and Usage experience with explicit Stripe payment boundary
- platform Tenants, Users, Subscriptions, Integrations, Failed Jobs, Feature Flags, Audit Logs, Support, and System Health experiences
- server-only Firestore rules, composite indexes, representative subscription/usage/health/failure seed data, and production environment references
- SaaS operations, webhook, background-job, security, data-model, and production deployment runbooks

Validation record:

- strict TypeScript: passed
- unit and policy suite: 59 passed
- Firestore Emulator rules suite: passed, including subscription/usage role boundaries and platform-only feature/support records
- Storage Emulator rules regression suite: passed
- Playwright end-to-end suite: 16 passed across desktop and mobile Chromium
- Cloud Functions TypeScript build: passed
- ESLint: passed with zero warnings
- production web build: passed
- expanded Firebase Auth and Firestore emulator seed: executed successfully

All eight planned build milestones are complete without carrying a broken build state.
