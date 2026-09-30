# Changing a signed booking (booking amendments)

Shipped 2026-09-29 (972ca7e).

Before this, a signed wedding was frozen:

- packages locked at signing;
- the accepted proposal was final;
- a signed contract could not be voided;
- a new contract could only be prepared before booking.

A couple who wanted video added, or their date moved, left the studio with no
way forward in StudioCue. An **amendment** is that way forward.

## The flow

1. **The studio writes up the change.** It can start from:
   - the job page: *Change the booking*;
   - Today: a couple's request, prefilled;
   - Cue: `change_booking`, or asking to add a package or move the date on a signed job.

   It picks a new date and/or which packages to keep and which to add from the catalogue. This is `bookingCommand draftAmendment`.
   - It refuses a date another job holds (`DATE_TAKEN:<names>`) unless the studio ticks *We can cover both*.
   - It refuses `NOTHING_TO_CHANGE`.
2. **The studio signs and sends it** (`sendAmendment`, owner or admin), where
   native signing is on and an agreement template exists. Otherwise the
   studio records a signature taken elsewhere (`recordAmendmentSigned`,
   signing mode `record`).
3. **The couple signs one document** in their portal (home card, and on
   *Your agreement*). The document says what changes and restates the whole
   agreement as amended. Evidence rules are the contract's (ADR 0006): their
   own session, the document hash, current consent wording, a typed name.
   The code is `server/contracts/amendment-signing.ts`.
4. **Signing applies it.** `bookingAmendmentSigned`
   (`functions/src/booking/amendment-apply.ts`) runs on either signature.

The job **never leaves its stage**. The original agreement stands until the
change is signed. *Withdraw the change* (`cancelAmendment`) leaves everything
as it was.

## What applying changes

| | |
|---|---|
| Proposal | The change's proposal is held in `amendmentProposals/amend_{id}` until signed, so nothing that reads "the latest proposal" sees it early. On signing it is filed as `proposals/amend_{id}` (accepted), and the old one is superseded. |
| Contract | `contracts/amendment_{id}` (completed) sits beside the original. The original gets `amendedByContractId`. |
| Job | New packages and date; `pendingAmendmentId` cleared; `amendmentCount` + 1. |
| Money | The retainer is never re-priced, and payments are kept and credited. An unpaid final written for the old total or date is **superseded** and re-raised (`raiseFinalInvoice`, `functions/src/booking/final-invoice.ts`) when it had been raised, the job had paid in full, or the date is ≤ 28 days out. A superseded QuickBooks bill becomes a *Void the old invoice in QuickBooks* task, because there is no provider void. Money paid beyond the new total becomes a refund task. |
| Date | Crew are re-offered at the shifted times (`reconfirmForDateChange`) and emailed. Cascades, staffing plan and crew calendar entries shift. So do checkpoints anchored to the event date, unsubmitted questionnaires, and insurance requirements and requests. A `move_booking_calendar_events` provider job patches Google events. A published timeline gets a re-publish task. |
| Couple requests | Pending `packageRequests` that the change satisfies (the package is now on the job, or the date matches) are marked approved with `resultAmendmentId`. |
| Emails | Couple: confirmation. Studio: notification. Crew: re-offer. |

**Consultations (added 2026-09-30):**
- When the date moves, the change sheet lists the couple's upcoming calls
  with the time each would move to: the same local time, the same number of
  days on, and correct across a daylight-saving change (`shiftInZone`).
- Calls within eight weeks of the wedding are pre-ticked. Each new time is
  checked against the studio's Google Calendar (`getCalendarBusyIntervals`)
  and its other consultations. A clash is shown, not refused.
- On signing, ticked calls move in place through the same
  `reschedule_consultation_resources` job as `rescheduleConsultation`, so the
  Zoom meeting and the couple's invitation update. A call rescheduled some
  other way since is left alone.
- The couple reads each move as a line in the change.

**Crew calendars StudioCue didn't create (added 2026-09-30):**
- Every assignment carries `calendarSequence`, which rises on each date move.
- The "your date moved" email to crew who had accepted attaches the next
  version of the same event (`functions/src/crew/calendar-ics.ts`: same UID,
  higher SEQUENCE). Opening it moves the event in Apple, Google or Outlook.
- The in-app download (`lib/crew/calendar-file.ts`) uses the same UID and
  sequence, so re-adding replaces instead of duplicating.
- Events StudioCue created through the studio's Google Calendar are patched
  directly (`move_booking_calendar_events`).

## Couples asking

After signing, a couple can still ask, on *Your agreement* under *Need to
change your booking?*:

- to add a package (`request_package`, as before signing);
- to move their date (`request_date_change`).

Both write a `packageRequests` doc (`kind: "package" | "date_change"`) and
email the studio. Today shows a card whose *Write up the change* opens the
change sheet prefilled. The sheet is held at page level, because Today
unmounts cards while it refreshes.

## Found while building it

`isStandingInvoice` takes a **status**. Three new call sites passed the
whole record. That stringifies to `[object Object]`, which "stands", so a
superseded final still counted as owed and no replacement was raised. It was
fixed before shipping, and `tests/booking-amendment.test.ts` now refuses any
call that passes a record.

Tests: `tests/booking-amendment.test.ts`.
