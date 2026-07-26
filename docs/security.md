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

## Retention, export, and deletion

Business deletion is a two-step archive and retention workflow. Tenant export runs as an audited background job and produces a time-limited encrypted archive. Destructive deletion requires owner authorization, a retention check, a second confirmation, and deletion evidence. Backups follow Google Cloud and Firebase recovery procedures and are tested periodically.

## Sports and minors

StudioHub does not create child accounts, provide direct child messaging, use facial recognition, create public child profiles, or collect unnecessary birthdates. Parents/guardians own accounts and releases. Customers must obtain legal advice before operating child-directed workflows; StudioHub does not claim automatic legal compliance.
