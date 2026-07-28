# StudioCue Build Progress

## Platform-to-tenant workspace access — 2026-07-28

Status: implemented and validated.

Delivered:

- platform administrators with an active studio membership now choose between
  platform administration and their studio workspace after sign-in
- the platform sidebar exposes a direct, membership-aware studio switch
- the studio sidebar exposes a return path for platform administrators
- onboarding persists the newly created tenant as the active workspace
- missing owner membership recovery is limited to tenants created by the same
  authenticated user, refuses suspended or altered memberships, and is audited
- workspace routing has explicit unit coverage

Validation record:

- strict TypeScript: passed
- ESLint: passed
- unit/domain suite: 71 passed
- Cloud Functions TypeScript build: passed
- Next.js production build: passed with 87 routes

## Pilot hardening and live-data completion — 2026-07-27

Status: implementation and local validation complete; production deployment is
complete for rules, indexes, and trusted Functions. The web release follows the
GitHub `main` promotion.

Delivered:

- replaced seeded studio, client, crew, and platform-administration operational
  screens with tenant- and project-scoped Firestore data
- active-workspace selection is honored consistently by browser command clients
- live dashboard, project details, subscription usage, reports, CSV export,
  documents, messages, automation runs, and provider health views
- secure staff, client, and subcontractor invitation flows using verified email,
  seven-day expiry, one-way token hashes, project scoping, and audit evidence
- versioned questionnaire-template builder and project assignment with resolved
  relative due dates
- vendor creation and project association
- complete COI request, unique inbound reply, extraction, deterministic
  discrepancy comparison, human approval/rejection, correction, venue delivery,
  and Dropbox archival orchestration
- permission-aware Vertex AI Copilot with record citations, facts/suggestions
  separation, quota enforcement, and immutable action audit
- structured AI schedule generation with strict schema, deterministic conflict
  validation, editable human-review draft, and explicit publish action
- live provider health checks plus audited disconnect/reconnect controls
- SendGrid message history and signature-verified delivery-event webhook
- public Features, Integrations, Pricing, Wedding, Corporate, Sports, and trial
  routes aligned to the current $69 / $199 / $399 commercial plan ladder
- eliminated the generic operational demo catch-all and removed invented unread,
  financial, health, pipeline, and success metrics
- production-ready documentation and a separated manual launch checklist
- deployed Firestore rules/indexes and production Functions for Copilot,
  schedule generation, client invitations, planning/COI, provider health,
  SendGrid delivery events, background operations, and file safety
- granted the Functions runtime Vertex AI access and private relay invocation
  for the new endpoints

Validation record:

- strict TypeScript: passed
- ESLint: passed with zero warnings
- unit/domain suite: 68 passed
- Firestore rules suite: passed
- Storage rules suite: passed
- Playwright acceptance suite: 10 passed across desktop and mobile Chromium
- Cloud Functions TypeScript build: passed
- Next.js production build: passed with 86 routes

Safety state:

- outbound email remains in mock mode
- provider worker operations remain in mock mode
- Stripe billing remains live
- switching email or provider execution live requires the manual gates in
  [`docs/manual-launch-checklist.md`](./manual-launch-checklist.md)

## Firebase production foundation — 2026-07-27

Status: provisioned; initial App Hosting release deployed successfully.

Delivered:

- Firebase project `studiohub-prod` and Firebase web application
- Blaze billing through the selected third billing account
- email/password Authentication and email-enumeration protection
- Firestore Native database in `nam7` with delete protection
- Cloud Storage bucket in `us-east1`
- deployed Firestore rules, indexes, and Storage rules
- native Next.js App Hosting build configuration for `us-east4`
- cost-conscious zero-minimum-instance runtime configuration
- production integration mock mode until App Check and provider secrets are
  configured
- Vertex AI/Gemini, serverless compute, job orchestration, App Check, security,
  observability, Calendar, artifact-scanning, quota, budget, and asset APIs
- initialized Google-managed service identities for runtime dependencies
- domain-restricted reCAPTCHA Enterprise registration for Firebase App Check
- GitHub Developer Connect link scoped to `FlawlessIQ/StudioPilot`
- successful production rollout from GitHub commit `2706c25`
- automatic production rollouts from the `main` branch
- verified public homepage and health endpoint

Production provider Functions and third-party connections remain intentionally
undeployed until their App Check registration, least-privilege credentials,
webhook signatures, callback URLs, and Secret Manager bindings are available.

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

## Production hardening pass

Status: implementation complete; final release validation is recorded below.

Delivered:

- verified account registration and idempotent studio onboarding
- role-aware route boundaries and sign-out across application shells
- live tenant-scoped project, lead, dashboard, questionnaire, crew, integration,
  and data-control paths with explicit preview fallbacks
- OAuth PKCE, Secret Manager credential storage/refresh, provider consumers,
  stable idempotency, retry, and dead-letter processing
- daily final-invoice and overdue scheduling
- private PDF/AI consumers and quarantine-first COI file safety
- paginated tenant exports, deletion controls, and audited expiring support access
- PWA/offline event-day access and privacy-safe Sentry reporting

Validation record:

- strict TypeScript: passed
- unit and policy suite: 59 passed
- Firestore Emulator rules suite: passed
- Storage Emulator rules suite: passed
- Cloud Functions TypeScript build: passed
- Python worker syntax validation: passed
- ESLint: passed with zero warnings
- production web build: passed
- Playwright end-to-end suite: 16 passed across desktop and mobile Chromium

Provider sandbox certification and production credentials/configuration remain
operational release gates; see `docs/production-readiness.md`.

## Production Secret Manager activation

Status: secret containers and least-privilege runtime bindings prepared.

Delivered:

- repeatable production secret provisioning and metadata-only status commands
- automatic-replication containers for implemented and reserved provider
  credentials
- resource-level `secretAccessor` grants for the Functions runtime only on
  secrets consumed by implemented code
- idempotent, non-disclosing generation of the application-owned SendGrid
  Inbound Parse token
- no project-wide secret accessor role and no provider access for App Hosting,
  PDF, or file-safety runtimes
- explicit Stripe and Sentry Function secret declarations
- direct Google Cloud credential-entry, activation, and rotation runbook

Provider mode remains mocked until required secret versions, nonsecret provider
identifiers, provider-side callbacks, and sandbox certification are complete.

## Stripe webhook relay

Status: public relay implemented; private handler activation awaits the Stripe
endpoint signing secret.

Delivered:

- dedicated App Hosting `POST /api/webhooks/stripe` route
- exact raw-body preservation for Stripe signature verification
- required signature-header and 1 MiB payload-boundary checks
- Google service-identity forwarding to the private `stripeWebhook` Function
- private invoker restoration for the Stripe Function after deployment
- production endpoint URL and minimum subscription-event inventory

## Dropbox OAuth activation

Status: callback relay and Dropbox-only activation implemented.

Delivered:

- Dropbox app secret stored in Secret Manager and app key kept in ignored
  production Function configuration
- exact public OAuth callback route with state/code bounds and same-origin
  redirect enforcement
- private Google service-identity forwarding to `integrationOAuth`
- Dropbox-only UI activation without enabling unfinished providers
- App Folder access model with offline refresh-token architecture

## Google Calendar OAuth activation

Status: production credentials configured and Calendar activation implemented.

Delivered:

- Google Calendar and People APIs enabled in `studiohub-prod`
- OAuth client secret stored in Secret Manager and client ID kept in ignored
  production Function configuration
- Calendar read and event-write scopes with offline refresh-token support
- shared, bounded OAuth callback relay and private `integrationOAuth` handler
- private Run service URL used as the exact Google ID-token audience
- provider-specific UI activation alongside Dropbox without enabling unfinished
  providers

Required before external pilot access:

- complete one real OAuth connection using `conor@flawlessiq.com`
- verify availability lookup and create, update, and cancel a test event
- verify reconnecting does not create duplicate events
- move the Google OAuth audience from Testing to In production
- submit the OAuth brand and Calendar scopes for Google verification

## Zoom OAuth staging

Status: development credentials and required scopes configured; public
activation enabled for local OAuth testing.

Configured least-privilege user-managed scopes:

- `meeting:write:meeting`
- `meeting:read:meeting`
- `meeting:update:meeting`
- `meeting:delete:meeting`
- `meeting:read:list_meetings`

Required before production publication:

- complete a local-test OAuth connection
- create, retrieve, update, list, and delete one test meeting
- verify reconnecting does not create duplicate meetings
- replace development credentials with Zoom production credentials
- complete Zoom Marketplace production review

## Production activation — Phase 1

Status: deployed and ready for App Hosting rollout.

Delivered:

- independent runtime controls for Firebase Authentication, Firestore-backed UI,
  and external providers
- production configuration with live Firebase auth/data and provider mock mode
- Firebase Authentication authorized-domain registration for the App Hosting URL
- 14 Node.js 22 second-generation Functions in `us-east4`, including a health
  canary and 13 core application APIs
- private Cloud Run IAM on application APIs, with invocation restricted to the
  App Hosting runtime service account
- same-origin App Hosting proxy that obtains a Google service identity token,
  forwards Firebase user identity and App Check evidence, and uses an explicit
  function allowlist
- exact production CORS allowlist for direct-call compatibility
- Functions build source-bucket read access, build logging, and artifact
  repository publishing with scoped IAM grants
- production Function artifact cleanup policy
- corrected public lead lookup against the tenant `publicSlug`
- Function placement in `us-east4`, with the Storage safety trigger explicitly
  pinned to the `us-east1` bucket region

Validation record:

- strict TypeScript: passed
- unit and policy suite: 59 passed
- Cloud Functions TypeScript build: passed
- ESLint: passed
- production web build: passed, including the private function proxy route
- direct anonymous calls to private application APIs: blocked with HTTP 403
- production health Function: HTTP 200

External providers remain in mock mode. Stripe, provider OAuth, signed webhooks,
inbound email, and secret-dependent workers have not been deployed.

Secret-free production operations activated:

- integration/dead-letter health checks every 15 minutes
- tenant export processing every 5 minutes
- review-request scheduling every 60 minutes
- final-invoice scheduling daily at 06:00 UTC
- authenticated Scheduler-to-Function invocation
- successful manual operations-health execution with Firestore persistence
- daily Firestore backups retained for 14 days
- Sunday Firestore backups retained for 12 weeks
- project-scoped `$100 USD` monthly budget with 50%, 80%, 100%, and forecast
  notifications on billing account `016B2F-16CC53-B5EEA1`
- private branded PDF worker in `us-east4`
- private ClamAV file-signature and malware-scanning worker colocated with
  Storage in `us-east1`
- production Functions environment pinned to provider mock mode with private
  worker URLs
- Storage finalize trigger deployed in `us-east1` with Eventarc authentication
- end-to-end safe PDF scan passed: trigger 200, worker 200, PDF signature valid,
  ClamAV clean, and object metadata promoted from pending to clean
- malware scanner tuned to 2 GiB and concurrency two after production memory
  telemetry; the exact isolated test object was removed after validation

## Commercial pricing revision — July 27, 2026

Status: implemented and production billing infrastructure deployed.

Delivered:

- public list pricing revised to Solo $69/$690, Studio $199/$1,990, and
  Multi-Brand $399/$3,990
- shared typed pricing configuration used by the marketing and subscription
  interfaces
- full responsive pricing comparison added to the marketing homepage
- monthly and annual subscription actions exposed in the studio workspace
- three live Stripe products and six immutable recurring Price objects
- StudioCue-specific Stripe Customer Portal configuration for plan changes,
  payment-method updates, invoice history, and end-of-period cancellation
- duplicate-subscription protection that routes existing subscribers to the
  Customer Portal instead of opening a second Checkout subscription
- independent billing mock control so provider adapters can remain in mock mode
  while Stripe billing operates live
- private `billingCommand` deployed with App Hosting invocation limited to the
  production runtime service account

Validation record:

- strict TypeScript: passed
- ESLint: passed
- unit and policy suite: 67 passed
- Cloud Functions TypeScript build: passed
- production Next.js build: passed
- desktop and mobile pricing layout checks: passed with no horizontal overflow

## Pilot hardening — tenant truth and access — July 27, 2026

Status: deployed backend; App Hosting release in progress from `main`.

Delivered:

- production operations job scheduler for provider, email, AI, and PDF queues
- retry/dead-letter indexes and a verified authenticated Scheduler execution
- independent outbound email gate; queued work can run without sending mail
- private SendGrid Inbound Parse COI processor behind the App Hosting boundary
- live workspace context for user, tenant, role, plan, and assigned projects
- removal of production demo fallback from project, lead, and dashboard rows
- explicit loading, empty, permission, and failure states
- Studio Owner team management with plan-capacity enforcement
- expiring, one-way-hashed staff invitations and verified-email acceptance
- audited role changes, suspension, invitation revocation, and acceptance
- role-filtered Studio navigation
- verified-email crew invitation activation with subcontractor entitlements
- project-scoped client portal data for package, contract, invoice,
  questionnaire, schedule, delivery, and review records
- project-scoped crew data for invitations, briefs, schedule segments,
  requirements, document uploads, profile, and availability
- real assignment-specific ICS generation with no hard-coded client data
- deterministic client schedule approval and review/download confirmation

Validation record:

- strict TypeScript: passed
- ESLint: passed
- unit and policy suite: 68 passed
- Firestore security-rule suite: passed
- Cloud Functions TypeScript build: passed
- production Next.js build: passed
- operations Scheduler manual execution: passed after index readiness

## Studio shell and OAuth recovery — July 28, 2026

Status: implementation complete; production deployment pending.

Delivered:

- redesigned the Studio shell with a compact dark navigation rail, grouped
  lifecycle navigation, clearer active state, and a single account control
- redesigned the Integrations area as a responsive connection center with
  provider-specific identity, capabilities, connection health, and focused
  actions
- replaced the misleading `Credentials required` fallback with accurate
  `Ready to connect`, `Connected`, and `Development mode` states
- added human-readable, dismissible OAuth callback success and error messages
- preserved tenant-scoped OAuth tokens in Secret Manager; no refresh token is
  exposed to the browser or written to Firestore plaintext
- fixed Firebase runtime project detection for OAuth credential persistence by
  supporting `GOOGLE_CLOUD_PROJECT`, `GCLOUD_PROJECT`, and Admin SDK project
  metadata
- added sanitized OAuth failure logging with provider, tenant, method, and
  normalized error code, excluding authorization codes and tokens

Validation record:

- strict TypeScript: passed
- ESLint: passed
- Cloud Functions TypeScript build: passed
- desktop integration layout visual QA: passed
- 390px mobile integration layout visual QA: passed with no horizontal overflow

## Dropbox confidential OAuth correction — July 28, 2026

Status: implementation complete; production deployment pending.

Delivered:

- Dropbox now uses the confidential server-side authorization-code flow with
  its protected client secret and one-time state validation
- PKCE is no longer sent to Dropbox, so the Dropbox app does not need public
  client or implicit-grant access enabled
- Google Calendar and Zoom retain PKCE protection
- Firebase Functions now builds TypeScript automatically before every deploy,
  preventing stale compiled JavaScript from reaching production
- provider-strategy regression coverage added

Validation record:

- strict TypeScript: passed
- ESLint: passed
- Cloud Functions TypeScript build and lint: passed
- unit and policy suite: 74 passed

## StudioCue brand and workspace design system — July 28, 2026

Status: implementation complete; production deployment pending.

Delivered:

- renamed the customer-facing product from StudioHub to StudioCue across the
  marketing site, authenticated application, portals, email and PDF copy,
  seeded content, operational defaults, documentation, and PWA metadata
- replaced the old favicon with the existing aperture brand mark and updated
  the Open Graph preview asset and metadata
- defined the missing shared surface, border, typography, state, and accent
  design tokens used by newer product areas
- constrained authenticated workspace content to a calmer operational grid
  with consistent desktop margins and responsive mobile padding
- improved page-heading hierarchy, panel radii, section spacing, field
  visibility, focus states, notices, and action sizing
- replaced oversized blank-state containers with compact, informative empty
  states
- refined Calendar, Questionnaires, Vendors, and Event Copilot layouts,
  including removal of the nested Vendors page container
- normalized page metadata so route titles do not repeat the product name

Validation record:

- strict TypeScript: passed
- ESLint: passed
- unit and policy suite: 74 passed
- public marketing desktop visual QA: passed
- 390px mobile visual QA: passed with no horizontal overflow
- production source compilation: passed; local cache completion deferred to
  Firebase App Hosting because the development Mac was at disk capacity

## StudioCue guided workspace UX — July 28, 2026

Status: implementation complete; production deployment pending.

Delivered:

- reduced routine Studio navigation from a long feature inventory to eight
  task-oriented destinations: Home, Pipeline, Projects, Calendar, People,
  Library, Reports, and Studio setup
- moved platform administration out of routine Studio navigation and into the
  audited account menu
- replaced the decorative search box with tenant-scoped project, client, and
  task search plus useful quick actions
- replaced the nonfunctional mobile menu link with an accessible, dismissible
  navigation drawer
- added a first-run setup checklist with progress, clear next actions, inquiry
  preview, package creation, calendar connection, project creation, and team
  invitation steps
- added Library and Studio setup hubs so reusable resources and administrative
  settings are easier to find
- added contextual project navigation and direct actions for tasks and
  readiness
- replaced raw client and project identifier entry with record selectors in
  project and task creation
- added a real month calendar populated by project dates and consultations
- replaced questionnaire field syntax with a visual add, remove, reorder, type,
  and required-field builder
- moved secondary creation tools behind clear disclosure controls where they
  no longer compete with the page’s primary record list
- made the public inquiry page tenant-branded and unavailable without a valid,
  active studio slug; removed the unrelated sample photography brand
- rewrote technical, architecture-led interface copy in projects, integrations,
  booking, readiness, questionnaires, workflow, documents, communications,
  client portal, and settings areas into task-led language
- added responsive layouts for the setup checklist, search, hubs, calendar,
  questionnaire builder, and project workspace navigation

Validation record:

- strict TypeScript: passed
- ESLint: passed
- unit and policy suite: 74 passed
- production Next.js webpack build: passed, including all 89 application routes
- Chrome-driven final visual sweep pending because the currently selected
  Chrome profile does not have the ChatGPT Chrome Extension enabled
