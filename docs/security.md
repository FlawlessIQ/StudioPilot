# Security Model

## Trust boundaries

The browser is untrusted. Firebase Authentication proves identity; server middleware and Firestore/Storage Rules enforce authorization. Firebase Admin credentials exist only in trusted compute.

Every sensitive operation is denied unless authentication, tenant membership, permission, and relevant project access pass. Tenant IDs supplied by the browser are never accepted without comparison to the active membership.

## Authentication

- verified email required before a server session
- Firebase ID token verified with revocation checking
- short-lived, `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` session cookie
- CSRF header/cookie comparison on session creation
- password reset through Firebase
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

## Audit and support

Browser clients cannot write or delete audit events. Trusted services append events with before/after snapshots, actor, entity, correlation, provider event, and automation run references. Support access is explicit, time-bounded, and audited; routine impersonation is prohibited.

Platform operations require a Firebase `platformAdmin` custom claim in addition
to App Check. Support grants require an exact tenant, a business reason, and an
expiry of no more than 60 minutes. Expired grants must be denied at read time;
their presence in Firestore is not authorization. Stripe Checkout and Customer
Portal require an active owner membership. Stripe webhooks verify raw-body HMAC,
freshness, and provider event idempotency before subscription state changes.
Payment instruments never enter StudioHub.

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
- inbound COI routes use hashed project reply tokens and restricted PDF validation
- AI can extract COI fields but cannot write the human decision
- published schedules are immutable and browser clients cannot directly approve or replace them
- crew assignment writes are server-only; commands recheck tenant membership, project access, role, and assignment ownership
- crew invitation tokens are random, expiring, and one-way hashed on assignment records
- subcontractors can read only their own profile, availability, assignments, scoped documents, and assigned schedule
- publishing a new schedule clears accepted crew acknowledgements so obsolete versions cannot satisfy readiness
- crew uploads are user/project path-bound, create-only, type and size validated, and remain under studio review
- post-production, delivery, review, and closeout records are server-write-only
- delivery commands require backup, editing, gallery, project-state, tenant, and permission gates
- review clicks are engagement evidence only and cannot complete the review workflow
- closeout requires every deterministic evidence gate and Studio Owner or Admin authority
- report export jobs are restricted to financial-reporting roles and retain tenant-scoped filters

## Retention, export, and deletion

Business deletion is a two-step archive and retention workflow. Tenant export runs as an audited background job and produces a time-limited encrypted archive. Destructive deletion requires owner authorization, a retention check, a second confirmation, and deletion evidence. Backups follow Google Cloud and Firebase recovery procedures and are tested periodically.

## Sports and minors

StudioHub does not create child accounts, provide direct child messaging, use facial recognition, create public child profiles, or collect unnecessary birthdates. Parents/guardians own accounts and releases. Customers must obtain legal advice before operating child-directed workflows; StudioHub does not claim automatic legal compliance.
