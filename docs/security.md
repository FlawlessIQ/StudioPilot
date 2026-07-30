# Security Model

## Trust boundaries

The browser is untrusted. Firebase Authentication proves identity; server middleware and Firestore/Storage Rules enforce authorization. Firebase Admin credentials exist only in trusted compute.

Every sensitive operation is denied unless authentication, tenant membership, permission, and relevant project access pass. Tenant IDs supplied by the browser are never accepted without comparison to the active membership.

Production application APIs also sit behind Cloud Run IAM. Direct anonymous
invocation is denied. Only the Firebase App Hosting runtime service account can
invoke them; its same-origin proxy uses a Google identity token and forwards the
browser's Firebase ID token in a separate internal header. Functions still
perform all user, tenant, role, permission, and App Check validation. The proxy
uses a fixed function-name allowlist and cannot route to provider webhooks or
arbitrary services.

## Authentication

- verified email required before a server session
- Firebase ID token verified with revocation checking
- short-lived, `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` session cookie
- CSRF header/cookie comparison on session creation
- branded password-reset and verification messages through the server-owned
  SendGrid queue, with Firebase remaining authoritative for single-use action
  codes and password/email state
- account-recovery responses do not reveal whether an email is registered and
  repeated requests are rate limited by a one-way email key and request
  fingerprint
- App Check enforced on callable/HTTP command surfaces where applicable
- MFA hooks are reserved in identity policy and can be required per role later

## Provider security

- secrets and OAuth client credentials use Secret Manager
- provider refresh tokens never reach the browser
- least-privilege OAuth scopes
- webhook HMAC/signature verification before parsing
- raw provider events stored idempotently by provider event ID/hash
- all provider errors normalized before reaching clients
- provider account or realm IDs resolve the tenant connection before contract or invoice queries
- Docusign completion and QuickBooks zero-balance evidence cannot be written by browsers or AI

## Data and files

- Firestore documents require tenant keys; project records require project keys
- repositories require an explicit tenant argument
- file paths are tenant/project prefixed
- uploads are limited by size and allowlisted MIME type
- file signature verification and malware scanning are performed in a restricted processing service before approval workflows
- PDFs are parsed/rendered in isolated Cloud Run workers with time and memory limits
- signed Docusign PDFs are immutable
- reusable studio files remain quarantined until signature validation and
  malware scanning pass; only trusted workers may create extracted drafts
- imported legal, payment, signature, insurance, approval, and provider-state
  claims are blocking validation issues and cannot be activated as truth

## AI privacy and authority

- persisted AI action records contain source identifiers, model/instruction
  versions, structured drafts, confidence, validation, human decisions, and
  downstream command references
- AI actions cannot execute a `never_ai_authoritative` or
  `provider_evidence_required` decision; reviewed-draft capabilities require an
  explicit approval record before a deterministic command can run
- schedule-generation interaction telemetry stores counts, timestamps,
  source-record IDs, and a one-way preferences hash—not questionnaire answers,
  preference text, participant names, venue addresses, or the generated brief
- product telemetry contains bounded operational properties and measurements;
  it must not contain message bodies, document text, provider tokens, payment
  instruments, or client access codes
- evaluation fixtures use redacted synthetic wedding materials and assert
  classification, citation, human-review, and unsupported-authority thresholds

## Audit and support

Browser clients cannot write or delete audit events. Trusted services append events with before/after snapshots, actor, entity, correlation, provider event, and automation run references. Support access is explicit, time-bounded, and audited; routine impersonation is prohibited.

Platform operations require a Firebase `platformAdmin` custom claim in addition
to App Check. Support grants require an exact tenant, a business reason, and an
expiry of no more than 60 minutes. Expired grants must be denied at read time;
their presence in Firestore is not authorization. Stripe Checkout and Customer
Portal require an active owner membership. Stripe webhooks verify raw-body HMAC,
freshness, and provider event idempotency before subscription state changes.
Payment instruments never enter StudioCue.

Subscription limits and AI quotas are deterministic trusted-service checks.
Feature flags cannot bypass an entitlement, role, project assignment, or quota.

## Workflow and readiness authority

- browsers cannot mutate workflow versions, runs, checkpoints, tasks, automation runs, or readiness assessments directly
- published workflow versions and active-run snapshots are immutable
- checkpoint evidence and dependencies are verified in trusted transactions
- default waiver authority is restricted to the Studio Owner and requires a reason
- clients see only client/shared checkpoints; subcontractors see only crew/shared checkpoints on assigned projects
- AI output cannot resolve checkpoints or alter readiness
- `PLANNING → READY` requires the same-tenant canonical readiness assessment to pass
- inbound COI routes use a shared provider secret plus hashed,
  project-specific reply tokens
- inbound attachments are quarantined; MIME allowlisting, magic-byte
  verification, and ClamAV must pass before AI extraction is queued
- AI can extract COI fields but cannot write the human decision
- published schedules are immutable and browser clients cannot directly approve or replace them
- crew assignment writes are server-only; commands recheck tenant membership, project access, role, and assignment ownership
- crew invitation tokens are random, expiring, and one-way hashed on assignment records
- client invitation tokens are random, expire after seven days, are stored only
  as hashes, rotate on resend, and can be revoked by an authorized studio user
- subcontractors can read only their own profile, availability, assignments, scoped documents, and assigned schedule
- subcontractors receive a server-materialized `crewScheduleView` containing
  only their published crew/shared schedule items; the full schedule,
  compensation, private client notes, and studio-only items are not cached
- offline crew storage caches only the sanitized role brief and is cleared when
  the assignment or published schedule changes
- publishing a new schedule clears accepted crew acknowledgements so obsolete versions cannot satisfy readiness
- crew uploads are user/project path-bound, create-only, type and size validated, and remain under studio review
- post-production, delivery, review, and closeout records are server-write-only
- delivery commands require backup, editing, gallery, project-state, tenant, and permission gates
- review clicks are engagement evidence only and cannot complete the review workflow
- album reminders stop when selection, design, revision, approval, or
  fulfillment evidence exists; AI never selects images or approves album design
- closeout requires every deterministic evidence gate and Studio Owner or Admin authority
- report export jobs are restricted to financial-reporting roles and retain tenant-scoped filters

## Retention, export, and deletion

Business deletion is a controlled retention workflow. Tenant export runs as an
audited background job and produces a time-limited archive. Owner confirmation
starts a 30-day cooling-off period; platform approval requires a completed
export. Physical erasure remains a separately controlled production operation
so it cannot occur through a casual browser action. Backups follow Google Cloud
and Firebase recovery procedures and must be tested periodically.

## Sports and minors

StudioCue does not create child accounts, provide direct child messaging, use facial recognition, create public child profiles, or collect unnecessary birthdates. Parents/guardians own accounts and releases. Customers must obtain legal advice before operating child-directed workflows; StudioCue does not claim automatic legal compliance.
