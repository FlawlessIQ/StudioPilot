/**
 * The consent a couple gives before signing electronically.
 *
 * ESIGN (15 U.S.C. §7001) and UETA let a signature be electronic; they also
 * expect the person to have agreed to do business that way, to be able to get
 * a copy, and to know they can ask for paper. Each version of this text is
 * kept, never edited in place: a signature records the version id and a hash
 * of the exact words, so what someone agreed to is always recoverable.
 *
 * A change in wording is a new version. Counsel reviews each one before it is
 * made current — see docs/contracts.md.
 */

export type EsignConsentVersion = {
  id: string;
  /** The checkbox label. */
  label: string;
  /** The full disclosure, shown behind "Read the full terms". */
  disclosure: string[];
};

export const ESIGN_CONSENT_V1: EsignConsentVersion = {
  id: "esign-consent-v1",
  label:
    "I agree to sign this agreement electronically, and that my typed name is my signature.",
  disclosure: [
    "You are agreeing to use electronic records and an electronic signature for this agreement instead of paper. Your typed name, together with this record of when and how you signed, has the same effect as a handwritten signature.",
    "You can ask your studio for a paper copy at any time, free of charge, by replying to any email from them or sending a message from this portal.",
    "You can decline to sign electronically before you sign. To do that, don't tick this box — message your studio instead and they will arrange another way to sign.",
    "Once signed, a copy of the complete agreement is emailed to you and stays available in this portal. To open it you need a current web browser and an email address; a PDF reader lets you save or print it.",
    "If your email address changes, update it with your studio so your copy and any notices reach you.",
  ],
};

export const currentEsignConsent = ESIGN_CONSENT_V1;

const versions: Record<string, EsignConsentVersion> = {
  [ESIGN_CONSENT_V1.id]: ESIGN_CONSENT_V1,
};

export function esignConsentVersion(id: string): EsignConsentVersion | null {
  return versions[id] ?? null;
}

/** The exact words, as one string, for hashing into the signature record. */
export function esignConsentText(version: EsignConsentVersion): string {
  return [version.label, ...version.disclosure].join("\n\n");
}

/**
 * What the studio agrees to when it signs and sends.
 *
 * The studio signs first, at send, so the couple's signature completes the
 * agreement in one step.
 */
export const STUDIO_SIGNING_STATEMENT =
  "I'm signing this agreement for the studio, electronically, and my typed name is my signature.";
