import { tradeProfile } from "../trades/trades";

/**
 * Whether a studio can have StudioCue write and sign its contracts.
 *
 * On for every studio since 2026-10-02 (Conor's decision, ahead of the
 * counsel review of the consent and certificate wording, which is still owed
 * — docs/contracts.md). Before that a platform admin turned it on per studio
 * with `tenantFeatures/{tenantId}.nativeContractSigning`, which still works.
 *
 * Must match NATIVE_SIGNING_GENERALLY_AVAILABLE in
 * functions/src/contracts/commands.ts; tests/native-contract-surface.test.ts
 * compares them.
 */
export const NATIVE_SIGNING_GENERALLY_AVAILABLE = true;

export function nativeSigningOn(features: { nativeContractSigning?: unknown } | null | undefined): boolean {
  return NATIVE_SIGNING_GENERALLY_AVAILABLE || features?.nativeContractSigning === true;
}

/**
 * Whether the studio sends its terms and the client's booking as one
 * agreement with two signatures (H2 Part B): the one link a client books in.
 *
 * On by default for a trade whose journey books in one link (trades.ts
 * `journey.oneLinkBooking` — a DJ, a makeup artist, a hair stylist; Conor,
 * 2026-10-09), because their clients sign and pay the deposit in one visit.
 * A photographer studio still needs a platform admin to turn it on,
 * `tenantFeatures/{tenantId}.combinedAgreement`, until counsel has seen the
 * two-signature ceremony. Needs native signing either way.
 *
 * `trade` is the studio's (`tenants/{id}.trade`, or the tenant itself); a
 * missing one is a photographer, so a caller that passes none reads as before.
 * functions/src/contracts/combined-commands.ts `combinedAgreementEnabled`
 * decides the same way on the server.
 */
export function combinedAgreementOn(
  features: { nativeContractSigning?: unknown; combinedAgreement?: unknown } | null | undefined,
  trade?: unknown,
): boolean {
  if (!nativeSigningOn(features)) return false;
  return features?.combinedAgreement === true || tradeProfile(trade).journey.oneLinkBooking;
}
