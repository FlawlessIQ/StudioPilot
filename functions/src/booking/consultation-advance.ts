/**
 * Where booking a consultation takes a project — mirror.
 *
 * `functions/` is a separate package and cannot import from `features/`, so this
 * mirrors features/projects/state-machine.ts's `consultationBookingAdvancesTo`.
 * That copy holds the tests and is the source of truth; change both together.
 *
 * The walk of 2026-08-26 found the lifecycle stopped dead: a consultation
 * booked on StudioCue's own calendar ticked the journey step but left the
 * project at LEAD, and the booking workspace then refused the notes. The manual
 * stage control stays available — a consultation held over the phone is real —
 * so this makes the booking sufficient evidence, not required evidence.
 */

export function consultationBookingAdvancesTo(from: string): string | null {
  return from === "LEAD" ? "CONSULTATION" : null;
}
