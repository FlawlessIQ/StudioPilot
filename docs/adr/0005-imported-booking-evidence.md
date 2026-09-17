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
