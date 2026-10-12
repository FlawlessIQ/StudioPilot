# Group events — design (job types Phase 5)

**Status (2026-10-12): all four phases built.** The roster (Phase 1) and
sign-up (Phase 2) are live; mini-session days (Phase 4) and delivery and
reviews (Phase 3, "Built: delivery and reviews" below) are on main. What
shipped differs from this design in places; docs/group-event-signup-plan-2026-10-10.md
records what was built. Still owed: one real cheer day walked with Gabe.

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

## Built: delivery and reviews (2026-10-12)

Phase 3 as built. It differs from the sketch above in three ways: there is
no `deliveryRecords` per parent, the link is matched by pasted names (not
file names), and the job's state is not moved.

**Where it lives.** The link is on the parent's own record,
`eventParticipants/{id}.delivery`: `{ url, host, attachedAt, releasedUrl,
releasedAt, releasedUnpaid }`. It is never in `deliveryRecords`, for the same
reason invoices stay out of `invoiceReferences`: the job's readers would treat
a parent's photos as the organiser's.

- The pure rules are in `features/group-events/delivery.ts`, copied to
  `functions/src/group-events/delivery.ts` with a drift test.
- The send-time rules are in `functions/src/group-events/participant-delivery-core.ts`.

**Attaching links.** crmCommand `attachParticipantDeliveries` takes up to 200
`{ participantId, url | null }`. Only https links are accepted (`deliveryUrlProblem`),
and the host is named with post-event's `linkHost`. There are three ways in, from
the roster's "Add links" sheet or a person's entry:

- **One at a time**, from a person's entry.
- **Match by name.** Paste lines like "Ava Smith — https://…" (a comma, a
  tab or the link first also work). They are matched by athlete name,
  ignoring case, spacing, accents and curly quotes. Before anything is saved,
  the sheet shows:
  - names that match nobody;
  - names two places share;
  - a place named twice;
  - lines with no link or no name.

  The studio picks a person for each of those or skips the line. Cancelled
  places are never matched.
- **One link for everyone**, for a team gallery.

Saving never sends anything.

**Releasing.** crmCommand `releaseParticipantDeliveries` takes `participantIds`,
which is either null (everyone ready, up to 150 per press) or one place.

- **Unpaid places are held** until they've paid ("held — not paid" on the
  roster). The studio can send one anyway from that person's entry
  (`allowUnpaid`, one place at a time only).
- **Cancelled places** never get anything.
- **One email per place per link.** The email's id is
  `group_delivery_{participant}_{sha(link)}`, so a second press sends nothing.
  A replaced link shows "New link, not sent yet" and sends once more.
- **No email on file:** the place is still released (and counts as delivered),
  and the link shows on their order page.
- **The email** is `group_delivery`, with `audience: "parent"` and
  `soleRecipient`. Its button opens their link, and their order page is the
  second link. It is held while the studio's billing has lapsed.
- **Read again as it goes:** a cancelled place, a job put away, called off or
  on hold, or a link replaced since holds it. A quiet (imported) job still
  sends, because the studio pressed release itself.
- **The order page** (`/e/order/{orderToken}`) shows "Your photos" with the
  link they were sent. A link attached but not yet released doesn't show.

**Review asks.** One `group_review_request` per parent, ever, with id
`group_review_{participant}`.

- **Scheduled** at their first release, 3 days later (the wedding's first
  ask), only for a place with an email. It is stored as `reviewAsk` plus a
  top-level `reviewAskDueAt`.
- **Queued** by the hourly `reviewRequestScheduler`
  (`sweepParticipantReviewAsks`). There is no new function, no invoker change
  and no new index, because it uses a single-field range read.
- **Held** (and never retried) when:
  - the studio has no review link saved (it points at the studio's saved
    link, `studioReviewDestination`);
  - the job has "Don't ask" (`reviewRequestsSkippedAt`);
  - the job is put away, called off, on hold or quiet;
  - the place was cancelled or has no delivery.
- **Rechecked as it sends** (operations/jobs.ts).
- **Treated as a client automation** (`clientAutomationEmailTypes`, both
  copies).

**Close-out.** `prepareCloseout` reads the roster. On a job with its roster on
and someone on it, it adds a `participants` requirement: everyone not
cancelled is paid (or owes nothing) and delivered. That requirement is
evidence only and can't be vouched for; a no-show is cancelled from the roster
instead. On such a job:

- the "Gallery delivered" row is met when every place is delivered;
- the "Review request sent" row is met when any parent's ask was queued.

Weddings read nothing new.

**Today and the roster** show "18 of 24 delivered · 3 ready to send · 2 held
until paid". A past event stays on Today while links wait to be sent.

**The job moves to DELIVERED on its own** (Conor, 2026-10-12): the release
press that sends the last place not cancelled its link moves the job there,
paid or not (money is close-out's question). From EVENT_COMPLETE or
POST_PRODUCTION, or from BOOKED/PLANNING/READY once the event date has passed
(a studio that never marked the day done). The parents' links are the delivery
evidence; no wedding release, delivery record or couple review ask is made.
`rosterDeliveryMove` in `group-events/delivery.ts`; audited as
`group_event.delivered`.

**Not done:**

- There is no per-parent "don't ask" (the job-level one covers the event).
- There is no file-name matching.
- Crew field mode doesn't show deliveries.

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
