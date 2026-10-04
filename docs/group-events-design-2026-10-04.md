# Group events — design (job types Phase 5)

**Status: design for Conor's approval. Nothing built.** Before building,
walk one real cheer day with Gabe against this document (see "Questions for
Gabe" at the end).

## The problem

Gabe shoots cheer and other sports days where **each parent pays for their
own athlete's photos**. One event, many paying clients. StudioCue's journey
is built on one job, one client, one bill — so today the studio books the day
as a single job with the organiser as client and records the takings by hand
("paid on the day"). That loses what parents need: their own receipt, their
own photos, and a way to pay before the day.

Making each parent a separate job would put 60 jobs on Today for one
Saturday, 60 copies of the same date, venue and crew, and 60 run-of-shows.
The event is one piece of work; the parents are its buyers.

## The shape

- **The job is the event.** One job, kind `sports` (or any kind the studio
  marks as a group event), with the date, venue, crew, run of show and
  readiness it already has. The organiser is the job's optional contact.
- **Each parent is a participant on the job**, not a job. A participant has
  a name, email, phone (optional), the athlete's name, the package chosen, a
  bill, and later a delivery.
- **A sign-up link per event.** The studio shares one link with the
  organiser (who posts it to the team). A parent opens it, picks a package,
  enters their details and the athlete's name, and pays now or chooses
  "pay on the day".
- **The day**: a roster on the job (and on the crew day sheet) — every
  participant, paid or unpaid, with **Take payment** per row for cash, card or
  a QR to pay online.
- **After**: delivery per participant (their athlete's gallery or folder
  link), a review ask per parent, and the job closes when every participant
  is settled and delivered.

## Data

Top-level, tenant-scoped, as every StudioCue collection:

| Collection | Key fields |
| --- | --- |
| `eventParticipants/{id}` | `tenantId`, `projectId`, `status` (`registered` → `paid` / `pay_on_day` → `delivered`, or `cancelled`), `parentName`, `email`, `phone`, `athleteName`, `team` (optional), `packageSnapshotId`, `invoiceId`, `deliveryRecordId`, `source` (`signup_link` / `studio`), `consents` (see Minors), audit fields |
| `eventSignupLinks/{id}` | `tenantId`, `projectId`, `tokenHash`, `status` (`open` / `closed`), `closesAt`, `packageIds` offered, `capacity` (optional), `payment` (`now` / `now_or_day` / `day`) |

On the job: `groupEvent: { enabled, signupLinkId, participantCount, paidCount }`
— counts maintained by the commands, so Today and the Jobs table read one
document, not the roster.

Packages: each participant gets an immutable package snapshot like any job
does (`packageSnapshots`, `participantId` set), so pricing, tax and receipts
reuse the existing money code. Invoices: one `invoiceReferences` per
participant, `participantId` set, `kind: "final"` (paid in full), through
the studio's invoicing provider — QuickBooks Payments pay links work as they
do for weddings.

## Server

All writes through a new `groupEventCommand` (functions), checking the usual
six things, plus a public `groupEventSignup` endpoint modelled on
`publicLeadIntake`:

- **Studio commands**: `openSignup`, `closeSignup`, `addParticipant`,
  `editParticipant`, `cancelParticipant`, `recordDayPayment`,
  `attachParticipantDelivery`, `releaseDeliveries`.
- **Public sign-up**: App Check, rate limit by trusted client IP
  (`lib/security/client-ip.ts`), token lookup by hash, the studio's
  subscription must allow work (`subscription-access.ts`), capacity and
  close date enforced in a transaction. Creates the participant, the
  snapshot and — for "pay now" — the invoice and its pay link, then emails
  the parent a confirmation with their own link.
- **Participant link**: each parent gets a private link (`/p/{token}`, like
  the inquiry link `/i/{token}`) to see their order, pay, and later open
  their photos. No account needed — the same choice the inquiry link made,
  because parents of a 60-athlete team will not create logins.
- **Emails**: `group_signup_confirmation`, `group_payment_reminder` (day
  before, unpaid "pay now" only), `group_delivery`, `group_review_request`.
  All through the email worker, so the billing hold and the reserved-domain
  guard apply automatically.

Rules: both collections `allow write: if false`; studio members read their
tenant's participants; nothing readable by a participant directly — the
participant link is served by a route with the Admin SDK, scoped by token,
like the client portal.

## Studio screens

- **Job page → People tab** (group events only): roster table with filters
  (paid, unpaid, pay on day, delivered), totals, **Copy sign-up link**,
  **Add a participant**, **Export CSV**. Compact rows on phones (never
  expanded cards).
- **Today**: one row for the event — "Saturday cheer · 42 signed up · 31
  paid" — and a card only for things that need the studio (the link closes
  tomorrow, unpaid participants the day before, deliveries ready to
  release).
- **Crew day sheet**: the roster, read-only, with **Take payment** for crew
  the studio allows to collect.
- **Delivery**: per participant, or one bulk upload where file or folder
  names match athlete names, reviewed by the studio before release.

## Minors and privacy

The athlete is usually a child, so the rules from the Terms and Privacy
Policy apply in full:

- The **parent is the client**. No child accounts, no child email, no
  birthdates.
- Only the athlete's **name** (and team) is collected — what the studio needs
  to sort photos. No face matching, no biometric processing.
- Sign-up asks the parent to confirm they are the athlete's parent or
  guardian and consent to the photos being taken and delivered to them;
  recorded on the participant with the version of the wording.
- Galleries are delivered only to that participant's private link.
- Participants are deleted with the job (per-job purge) and covered by the
  tenant export.

## Phasing

1. **Roster without sign-up** (S–M): participants added by the studio,
   roster on the job and day sheet, Take payment, per-participant receipts.
   Replaces the hand-recorded stopgap.
2. **Sign-up link and pay now** (M): public sign-up, participant link,
   confirmation and reminder emails, invoices per participant.
3. **Delivery and reviews** (M): per-participant delivery, bulk match by
   name, review asks, close-out rule.
4. **Mini-session days** reuse 1–3 with time slots (the "Later" item in the
   job-types plan).

## Questions for Gabe

1. Does the organiser ever pay part (e.g. team photo) while parents buy
   individual packages? If yes, the organiser is also a participant.
2. How are photos sorted today — by athlete name, number, or team — and is
   the athlete's name enough?
3. Pay-on-the-day: cash, card reader, or a QR to pay online? Who collects —
   Gabe only, or crew too?
4. Do parents ever buy for two athletes at once? (One participant per
   athlete, or one order with several athletes?)
5. When does sign-up close relative to the event, and is there ever a cap?
6. Are prints or products part of the packages, or digital only?
