/**
 * The legal versions a new studio accepts at signup — the functions copy of
 * features/legal/legal.ts (functions/ cannot import features/).
 * tests/legal-pages.test.ts fails if the two disagree.
 */
export const TERMS_VERSION = "1.0";
export const PRIVACY_VERSION = "2.0";

/** What is stored on the tenant and the owner when the workspace is created. */
export function legalAcceptance(uid: string, at: string) {
  return {
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: at,
    acceptedBy: uid,
    // The register page says "By creating an account, you agree to the Terms
    // of Service and Privacy Policy" above the button that leads here.
    method: "signup",
  };
}
