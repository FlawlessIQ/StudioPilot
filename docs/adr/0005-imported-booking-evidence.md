# ADR 0005: Imported bookings are their own evidence, and arrive quiet

Status: accepted (2026-09-17)

Amends [ADR 0003](0003-provider-evidence-booking-gate.md).

## Context

ADR 0003 makes provider evidence the authority for booking: UI actions and AI
output cannot establish contract or payment completion. Manual attestation
(`completionAuthority: "manual_attested"`) was later added so a studio could
record a signature or payment that happened outside StudioCue, on a named
person's word, without pretending a provider verified it.

Every studio adopting StudioCue also arrives with bookings made before it
existed — contracts signed and retainers paid months ago. None of them could be
held:

- A project could only be created as `LEAD`, and the only route to `BOOKED` was
  the live booking path.
- Walked for an old booking, that path acts as if the booking is happening now.
  `complete_booking_side_effects` queues a "You're booked" email to the couple
  unconditionally; an active booking orchestration raises a new retainer invoice
  in QuickBooks and emails it; the workflow is dated from today; and the
  lifecycle scheduler catches up, so a wedding ten days out is handed its
  thirty-day messages on its first morning.
- Most old bookings cannot walk it anyway: it prices from the studio's current
  package, requires an accepted proposal, and rejects a $0 retainer.

## Decision

1. **An imported booking records `completionAuthority: "imported"`** on its
   contract and on the record of what was paid. It means: this booking predates
   StudioCue, and the named studio member vouched for it on this date. It is
   never recorded as a provider event and never replayed through the
   manual-attestation commands.
2. **Imported evidence is the studio's word, like manual attestation.** Wherever
   the booking gate or the orchestrator distinguishes provider evidence from a
   studio's word, both authorities are read as the studio's word
   (`studioVouchedAuthorities`). An import never makes a provider-verified claim.
3. **The import writes the booking directly, in its real state** (`BOOKED` or
   `PLANNING` only), and does not touch booking orchestration, the booking gate,
   the side-effects job or any email queue. Money already paid is one paid
   retainer record whose evidence itemises each payment, so the final balance —
   contract total less paid retainers — is right with nothing downstream
   changed. It carries no provider customer, so no final invoice is raised for
   a booking already billed elsewhere.
4. **It arrives quiet.** `clientAutomationsPausedAt` is set on import. While set,
   the lifecycle scheduler, final-invoice scheduler, workflow automation rules,
   autopay and the email sender's automated types all hold back. There is no
   single chokepoint for this, so each checks, and
   `tests/quiet-imported-bookings.test.ts` names every one.
5. **Only a deliberate studio action ends the quiet** (`bringImportedBookingLive`,
   owner or admin). Creating calendar events and folders, and inviting the couple
   to their portal, are separate choices within it; an imported booking never
   receives a booking confirmation email, whenever it is brought in.
6. **Only owners and admins may import**, the same permission as recording a
   signature or a payment by hand, because an import asserts both.

## Consequences

- A new automation that reaches couples must check `clientAutomationsPaused`.
  Adding one without it is the failure this decision is most exposed to; the
  test above is the guard.
- Imported bookings are visibly distinguishable from live ones in the audit
  trail (`booking.imported`, `booking.brought_live`) and on every contract and
  payment record.
- Past weddings, and work already in post-production or delivered, are not
  importable yet: each of those states expects records an import does not
  create.

## Amendment, 2026-10-26: past jobs, and who worked them

Decided by Conor (docs/import-bookings-review-2026-10-26.md).

7. **Past and in-progress jobs are importable**: event done, in editing,
   delivered and finished, besides booked and planning. The event date must
   match: upcoming for booked and planning, passed for the rest. Editing and
   delivered need a studio that delivers something after the event. Each
   later state is written directly (no booking path, no transitions) with the
   records its screens and closeout read, every one marked as done before
   StudioCue:
   - in editing: the post-production trigger opens the checklist, as for any
     job moved to Editing;
   - delivered: the checklist done through "delivery sent", a delivery record
     with `completionAuthority: "imported"` when the studio gives the link, and
     `reviewRequestsSkippedAt` (`imported_past_job`) so closeout does not wait
     for asks that were never scheduled here;
   - finished: all of that, plus a completed closeout so the job archives like
     any other.
   The paid record now says `paidInFull` when the payments cover the total, so
   closeout's final balance is met for every import, upcoming ones included.
   A past job arrives quiet like any other; bringing it live opens the portal
   but schedules no calendar event and invites no one. Review requests and
   album reminders join the quiet list.
8. **Who worked a job is part of what is imported.** A job's crew is lines of
   role, count and names, with an assistant role per trade. Each named person
   is matched to the roster by name; a name not there is added to it with no
   email and no invite (`addedByImport`). Each gets an accepted assignment
   (on a past job too, as a live job's crew stay accepted until completed)
   with `completionAuthority: "imported"`, no
   calendar invite and no email. A roster entry with no email is never offered
   work and cannot be invited until the studio adds one.

## Amendment, 2026-10-26: signed and owed, and what was confirmed

An import can now say the contract is signed and the retainer is not in yet
(`retainerOwedCents`). That is written as a retainer bill still due — kind
`retainer`, status `sent`, no provider, no customer, `importedOwed: true` —
never as a payment and never raised anywhere. Recording the payment by hand
settles it like any bill out with a client. It is refused after the event:
what's owed then is the balance.

Where a sheet's figures and its own notes disagree, the import asks before the
row goes in (features/imports/import-questions.ts), and the answers travel
with the booking as `confirmations`. They are stored on the job as
`importConfirmations`, with who answered and when: the studio's word that it
checked, alongside its word that the contract was signed.

## Amendment, 2026-10-27: after the import

An imported job walked forward on production (one 11 days out, one in editing) found the import right and what followed it wrong:

- **Steps due before the import.** Still recorded as done before StudioCue, but for a day still to come only the booking and the money (`Booking` and `Payments` checkpoints, and not a retainer still owed). Planning, certificate, crew, schedule and shot-list steps stay open: a wedding 11 days out came in "2 things before the day" with two photographers sold and nobody booked.
- **Booking changes.** An imported job has no accepted proposal, and "Change the booking" refused it. The change is now written against what the import recorded (`contracts/imported-amendment-base.ts`); signed, it files as the job's first accepted proposal.
- **The final bill** takes off every retainer record (paid and owed), and an import with nothing paid can be billed its whole balance.
- **Quiet means paused, not imported.** Couple-facing features gate on `clientOutreachStop` (the pause), never on `importedAt`, which never clears: brought in, an imported couple is asked for their shot list and vendors like any other.
- **Final details sign-off** is not opened on an imported job with no form back and no signed contract read: there is nothing to confirm.
- **History** says an imported agreement was signed before StudioCue, not sent for signature or verified by a provider.

And the second pass, the same day:

- **Quiet time is the old system's time.** A lifecycle message that fell due before the couple was brought in (`broughtLiveAt`) is skipped, not caught up all at once on bring-in, as steps due before the import are done before StudioCue. A review ask due while the job is quiet waits a day at a time instead of being skipped for good.
- **Imported after the day,** the journey shows what the day overtook as "Before StudioCue", not "missed" (`JourneyInput.importedOn`).
- **An unbilled balance is visible:** Invoices counts final balances due and on no bill ("Not billed yet"), and the job's Final balance step says "Due now — not billed yet".
- The Plan brief says what crew the package sold and how many are still to book; the history opens with the import and the bring-in; the import preview names the couple as the job is named.
