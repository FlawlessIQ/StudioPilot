# Branded Email and Client Access

StudioCue sends transactional email through the server-owned `emailJobs`
pipeline and SendGrid. Browsers never receive the SendGrid API key and cannot
write message history or delivery state.

## Client invitation flow

Studio users invite clients from **Studio → Clients**:

1. Select the project the client should be allowed to access.
2. If necessary, link the project. The trusted CRM command updates both
   `contacts.projectIds` and `projects.clientContactIds` and creates an audit
   event.
3. Send the portal invitation. StudioCue creates a seven-day random token,
   stores only its SHA-256 hash, and queues a tenant-branded SendGrid message.
4. The client signs in or registers with the invited email and verifies it.
5. Accepting the invitation creates or extends a `client` membership containing
   only the invited project ID.

The studio can resend or revoke a pending invitation. Resending rotates the
token so the earlier link stops working. The client screen shows queued, sent,
delivered, opened, clicked, bounced, expired, revoked, and accepted evidence
without exposing the token.

## Brand resolution

Every email uses one renderer with:

- tenant `brandName` or `businessName`
- optional HTTPS logo from `emailBranding.logoUrl` or `logoUrl`
- optional `emailBranding.primaryColor` or `brandColors.primary`
- tenant contact/reply-to email when configured
- a StudioCue attribution footer
- responsive HTML and a complete plain-text alternative

Untrusted tenant, contact, project, and provider values are HTML escaped. Only
HTTP(S) action URLs and HTTPS logo URLs are rendered.

Studio Owners can edit these values in **Studio setup → Settings → Email
branding**. Updates are validated by an App Check-protected, owner-only server
command and recorded in the immutable audit log. The settings page includes a
live preview so the studio can inspect the hierarchy, color, identity, action,
and reply behavior before saving.

## Template catalog

The shared catalog covers:

- staff, client, and crew invitations
- email verification and password reset
- inquiry acknowledgement
- consultation confirmation and reminder
- package follow-up and proposal
- contract and retainer/final invoice notices
- booking confirmation
- questionnaire request and reminder
- COI request, correction, and venue delivery
- crew reminder
- schedule review and final publication
- event reminder and thank-you
- delivery and review request

Unknown future job types receive the same safe branded fallback instead of an
unstyled message.

## Authentication email

StudioCue owns the password-reset and verification presentation:

- the browser requests an email through the App Check-protected
  `authEmailCommand`
- password-reset responses never disclose whether an account exists
- per-address cooldown records limit repeated requests
- Firebase Admin generates the authoritative single-use action code
- only the action code is relayed into the branded StudioCue reset or
  verification page
- an existing account uses its active tenant brand when one is available;
  pre-workspace accounts use the StudioCue product brand
- the SendGrid worker delivers the branded message and records provider events

Firebase remains authoritative for code validity, email verification, and
password changes.

## Production configuration

Required Function configuration:

- Secret Manager: `SENDGRID_API_KEY`
- runtime environment: `EMAIL_DELIVERY_MODE=live`
- runtime environment: `SENDGRID_FROM_EMAIL=<authenticated-domain sender>`
- optional runtime environment: `SENDGRID_FROM_NAME`

Before enabling live mode, confirm there are no unintended queued jobs, verify
the sending domain, and run controlled delivery, bounce, open, click, resend,
revoke, password-reset, and verification tests.
