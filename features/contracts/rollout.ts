/**
 * Whether a studio can have StudioCue write and sign its contracts.
 *
 * Held off for everyone until counsel has reviewed the consent and
 * certificate wording (docs/contracts.md). Until then a platform admin turns
 * it on per studio: `tenantFeatures/{tenantId}.nativeContractSigning`.
 *
 * Must match NATIVE_SIGNING_GENERALLY_AVAILABLE in
 * functions/src/contracts/commands.ts; tests/native-contract-surface.test.ts
 * compares them.
 */
export const NATIVE_SIGNING_GENERALLY_AVAILABLE = false;

export function nativeSigningOn(features: { nativeContractSigning?: unknown } | null | undefined): boolean {
  return NATIVE_SIGNING_GENERALLY_AVAILABLE || features?.nativeContractSigning === true;
}

/**
 * Whether the studio sends its terms and the couple's coverage as one
 * agreement with two signatures (H2 Part B). Off for everyone until counsel
 * has seen the two-signature ceremony; a platform admin turns it on per
 * studio: `tenantFeatures/{tenantId}.combinedAgreement`. Needs native signing.
 */
export function combinedAgreementOn(
  features: { nativeContractSigning?: unknown; combinedAgreement?: unknown } | null | undefined,
): boolean {
  return nativeSigningOn(features) && features?.combinedAgreement === true;
}
