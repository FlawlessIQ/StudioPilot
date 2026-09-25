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

/**
 * Version 2 (2026-09-25). Written to the consumer-disclosure elements of
 * ESIGN §7001(c) — not because a photography contract usually triggers them
 * (they apply where another law requires a consumer be given information in
 * writing), but so the consent holds up if one does. What changed from v1,
 * element by element, is in docs/esign-consent-review.md for counsel:
 *
 * - scope: what the consent covers, and what it does not;
 * - withdrawal after signing: how, and that it does not undo a signature;
 * - reasonable demonstration: the person affirms they can open and read the
 *   agreement on the device in front of them, which they have just done;
 * - hardware and software: named, with notice if they change;
 * - privacy: what is recorded at signing, why, and where it is kept.
 *
 * Still to be reviewed by counsel before being treated as settled.
 */
export const ESIGN_CONSENT_V2: EsignConsentVersion = {
  id: "esign-consent-v2",
  label:
    "I can open and read this agreement on this device. I agree to receive it and sign it electronically, and that my typed name is my signature.",
  disclosure: [
    "What you're agreeing to. You're choosing to receive this agreement, and the signed copy and signing record that go with it, electronically, and to sign it electronically instead of on paper. Your typed name, together with the record of when and how you signed, has the same effect as a handwritten signature. This consent covers this agreement only. Anything else your studio sends you is between you and them.",
    "Paper instead. You don't have to sign electronically. Before you sign, you can simply not tick the box and message your studio; they'll arrange a paper copy to sign instead. After you sign, you can ask your studio for a paper copy of the signed agreement at any time, free of charge, by replying to any of their emails or messaging them from this portal.",
    "Changing your mind later. You can withdraw this consent at any time by messaging your studio. Withdrawing doesn't undo a signature you've already given or change the agreement; it means any further copies or documents for this agreement will be given to you on paper.",
    "What you'll need. A phone, tablet or computer with a current version of Safari, Chrome, Edge or Firefox; an email account; and a way to open PDF files, which is built into most devices. You'll know your device works because you're reading this agreement on it now. If these requirements change in a way that could stop you opening your signed agreement, you'll be told by email before the change takes effect.",
    "Your copy. Once you sign, a copy of the complete agreement, with both signatures and its signing record, is emailed to you and stays available in this portal. Keep your email address up to date with your studio so your copy and any notices reach you.",
    "What we record when you sign. As evidence of your signature, StudioCue records the name you type, the email address you're signed in with, the date and time, your IP address, and the device and browser you're using. It's kept with the agreement and printed on its signing record, and it's available only to you, your studio, and StudioCue to run the service. See studio-cue.com/privacy.",
  ],
};

export const currentEsignConsent = ESIGN_CONSENT_V2;

/** Every version ever shown. Never remove one: signatures name the version they were given under. */
const versions: Record<string, EsignConsentVersion> = {
  [ESIGN_CONSENT_V1.id]: ESIGN_CONSENT_V1,
  [ESIGN_CONSENT_V2.id]: ESIGN_CONSENT_V2,
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
