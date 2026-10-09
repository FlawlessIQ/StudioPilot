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
- StudioCue contracts: ready to sign, reminder (3 and 7 days), signed copy
  (the sealed PDF attached), withdrawn, and the studio's "your client signed"
- booking confirmation
- questionnaire request and reminder
- COI request, correction, and venue delivery
- crew reminder (two days before the call; see "Before the day" below)
- schedule review and final publication
- event reminder (a week before) and thank-you
- delivery and review request

Proposal delivery is approval-gated. The email worker attaches the exact
approved PDF, uses the secure client-portal action URL, and writes SendGrid
message and delivery evidence back to the proposal. Resending creates a new
idempotent email job without mutating the approved offer snapshot.

StudioCue contract emails (`contract_ready`, `contract_reminder`) are read
against the contract as they send: one for a contract already signed or
withdrawn is held, not sent. `contract_reminder` is also on the held list for
quiet imported bookings. `contract_signed` carries the signed copy as an
attachment — ESIGN expects the signer to be given one.

Unknown future job types receive the same safe branded fallback instead of an
unstyled message.

## Tenant template versions

Studio Owners and Studio Admins can use **Communications → Branded template
studio** to customize supported journeys. Every save creates a new immutable
`messageTemplates` version. Activating a version changes only future email jobs;
prior versions and sent messages remain unchanged. The active pointer is stored
separately in `messageTemplatePointers`, making rollback an explicit activation
instead of a content mutation.

The designer includes an inbox preview, responsive branded body preview,
allow-listed variables, test delivery, active-version evidence, and version
history. Test jobs carry a server-side template snapshot so testing a draft
never requires publishing it. Tenant text is escaped by the renderer and
action URLs still come from deterministic application workflows.

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

## "Ahead of our call" — before the consultation (2026-10-02)

Nothing reached a couple between booking their consultation and the call: the
`consultation_reminder` template existed and nothing queued it.
`consultationPrepScheduler` (hourly, `functions/src/booking/consultation-prep.ts`)
now prepares one note per scheduled consultation, the day before the call by
default (Settings → Automatic drafts → "Ahead of the consultation"; its
`offsetDays` count back from the call, up to a week; 0 is three hours before).
A call booked later than that gets it within the hour.

- **The facts:** when and how (Zoom link, phone, place), the couple's own
  answers to their event form read back, and the link to their inquiry page to
  change anything or move the call.
- **"A few things we'd like to talk about":** the questionnaire analysis's
  suggested questions — never its notes for the studio (risks, contradictions).
- **Approval by default:** `aiActions/ai_consultation_prep_{consultationId}`,
  capability `consultation_prep_draft`, on Today with "Approve & send" and a
  "Call …" chip. Approving one for a call that moved or passed is refused
  (`CONSULTATION_PREP_STALE`); Today drops it once the call has started.
- **Automatic:** sends the facts alone — the AI's lines always need a person.
  The trust dial offers it after three unedited approvals.
- **Never** for a quiet job (imported, paused, cancelled, on hold, archived).

Settings saved before this existed still parse: `consultation_prep` is optional
with a default, and the wedding-date engine (`lifecycleTriggers`) never
schedules it. Walk it with `scripts/uat/consultation-prep-walk.mts`.

## Before the day — the couple's week-of note and the crew's call time (2026-10-02)

Both templates existed and nothing queued them: `event_reminder` was sent only
by a studio's own optional workflow rule (the day before), and `crew_reminder`
never. `eventReminderScheduler` (hourly,
`functions/src/communications/event-reminders.ts`; rules in
`event-reminders-core.ts`, pure with an explicit `now`) now sends both.

- **The couple, a week out.** From 9 AM in the wedding's own zone seven days
  before, until two days before (closer than that the day-before checklist is
  the note). Booked, Planning or Ready only; never for a quiet job (imported,
  paused, cancelled, lost, on hold, archived). The button is their timeline
  (`/client/schedule`) when a schedule is published with anything on it for
  them, else their portal; the portal is the second link. Both partners get it.
- **Each accepted crew member, two days before their call.** From 9 AM in the
  wedding's zone two days before the call date (the assignment's `arrivalAt`
  read in that zone, else the event date), until the call time. The email gives
  the role, the call time and finish in the wedding's clock (named), the place
  from the assignment (else the job's venue), whether the run of show is out,
  and the button to that job's day sheet (`/crew/schedule?assignment=…`).
  Accepted assignments only. A job put away, cancelled or on hold reminds
  nobody; a *quiet* job still reminds its crew — quiet is about the couple
  (ADR 0005), and crew who accepted through StudioCue already hear from it.
- **Zone:** the project's `timezone`, else the studio's, else UTC; put on the
  job so the renderer formats every time in it.
- **One each:** `emailJobs/event_reminder_{tenant}_{project}_{eventDate}` and
  `emailJobs/crew_reminder_{tenant}_{assignment}_{callDate}`, created once. A
  wedding or call that moves to another day gets the new day's reminder.
- **Read again as it sends** (`operations/jobs.ts`): the couple's is held if
  the job stopped (`clientOutreachGuard`), left Booked/Planning/Ready, changed
  date, or the day came; it is also on the quiet-booking held list. The crew's
  is held if the assignment is no longer accepted, the job stopped or the call
  moved to another day — and renders the call time and place the assignment
  has *now*.
- **Not on the "Review each time" dial.** The lifecycle drafts carry words
  StudioCue wrote (a balance, a checklist) that a person should read first.
  These carry nothing to check — a fixed note and a link, or the times the crew
  member already accepted — so they send like the review, album and
  final-details reminders. A studio rewords either in the template studio.

## The couple's own shot list (2026-10-09)

A couple's "must-take photos", uploaded as they already have them: a document,
PDF, photo or screenshot of their notes, and an optional note. Photographer
studios only (`tradeProfile().shotList`), weddings only.

- **Asked for** four weeks before the day by default (Settings → Planning
  timeline: on/off, 2–8 weeks). `planningFormScheduler` calls
  `requestShotListIfDue` (functions/src/planning/shot-list-upload.ts), which
  creates `clientShotLists/{projectId}` (`requested`, due two weeks out) and
  queues `shot_list_request` with a link to `/client/shot-list` (an invitation
  for a couple without portal access). Never to imported, paused or put-away
  jobs; never twice (`create`). "Ask now" on the job sends the same request.
- **Sent** from the portal (`/client/shot-list`, mobile-first): files go to
  `tenants/{t}/projects/{p}/clients/{uid}/shot-list/`, scanned like every
  upload; `submit_shot_list` saves them to the record (`received`, up to 10
  files). Couples can send before they're asked and add more later.
- **Today** shows "{couple} sent their shot list" until the studio opens a file
  or taps "Got it" (`markShotListSeen` sets `studioSeenAt`). A later send puts
  it back.
- **The job** shows a "Their shot list" card: not asked yet (and when it will
  be), asked (and due), or sent, with the files to open (clean only) and the
  note.
