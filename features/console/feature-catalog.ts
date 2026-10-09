/**
 * Features held back per studio, as the Console lists them (docs/console.md,
 * "Feature access"). Mirror of CONSOLE_FEATURES in
 * functions/src/console/features.ts, compared by tests/console-wiring.test.ts.
 * Only features the product actually reads are here, so every switch does
 * something.
 */
export const FEATURE_CATALOG = [
  {
    key: "nativeContractSigning",
    label: "StudioCue contracts",
    description: "StudioCue writes each client's contract from the studio's agreement and they sign in their portal. Held per studio until counsel has reviewed the consent and certificate wording.",
    requires: null as string | null,
  },
  {
    key: "combinedAgreement",
    label: "Combined agreement",
    description: "Terms and prices go out as one agreement with two signatures, and signing it books the job. Already on for DJ, makeup and hair studios, whose clients book in one link; this switch turns it on for a photography studio. Needs StudioCue contracts.",
    requires: "nativeContractSigning",
  },
];
