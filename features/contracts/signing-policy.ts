/**
 * Who may sign a contract StudioCue wrote, and when.
 *
 * A signature captured here is evidence the booking gate relies on (see
 * docs/adr/0006-studiocue-signing-is-signer-evidence.md). It is the couple's
 * act only if it could not have been anyone else's, and only if what they
 * signed is what they were shown. Every refusal is named so the portal can say
 * something true, and so tests can pin each one.
 *
 * Pure. Called by the portal route inside the signing transaction.
 */

export type SigningRefusal =
  | "CONTRACT_NOT_FOUND"
  | "NOT_A_STUDIOCUE_CONTRACT"
  | "CONTRACT_NOT_SENT"
  | "CONTRACT_ALREADY_SIGNED"
  | "CONTRACT_VOIDED"
  | "PROJECT_NOT_AWAITING_SIGNATURE"
  | "SIGNER_NOT_A_CLIENT"
  | "WRONG_SIGNER"
  | "DOCUMENT_CHANGED"
  | "CONSENT_REQUIRED"
  | "NAME_REQUIRED";

export type SigningDecision =
  | { allowed: true; alreadySigned: false }
  | { allowed: false; refusal: SigningRefusal };

export function normaliseEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** A typed name that is plausibly a person's: two letters at least, no markup. */
export function normaliseTypedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 160) return null;
  if (!/\p{L}.*\p{L}/u.test(name)) return null;
  if (/[<>{}]/.test(name)) return null;
  return name;
}

export function canClientSignContract(input: {
  contract: {
    exists: boolean;
    provider: unknown;
    status: unknown;
    documentHash: unknown;
    clientSignerEmail: unknown;
  };
  projectState: unknown;
  signer: { membershipRole: unknown; email: unknown };
  presentedDocumentHash: string;
  consent: boolean;
  typedName: unknown;
}): SigningDecision {
  const refuse = (refusal: SigningRefusal): SigningDecision => ({
    allowed: false,
    refusal,
  });
  const { contract } = input;
  if (!contract.exists) return refuse("CONTRACT_NOT_FOUND");
  if (contract.provider !== "studiocue") return refuse("NOT_A_STUDIOCUE_CONTRACT");
  if (contract.status === "completed") return refuse("CONTRACT_ALREADY_SIGNED");
  if (contract.status === "voided" || contract.status === "superseded")
    return refuse("CONTRACT_VOIDED");
  if (contract.status !== "sent" && contract.status !== "viewed")
    return refuse("CONTRACT_NOT_SENT");
  if (input.projectState !== "CONTRACT_PENDING")
    return refuse("PROJECT_NOT_AWAITING_SIGNATURE");
  // One membership per user per tenant, so a client role here also means the
  // signer holds no studio role in this studio. A studio member cannot sign
  // as their own client.
  if (input.signer.membershipRole !== "client") return refuse("SIGNER_NOT_A_CLIENT");
  const expected = normaliseEmail(contract.clientSignerEmail);
  if (!expected || normaliseEmail(input.signer.email) !== expected)
    return refuse("WRONG_SIGNER");
  if (
    typeof contract.documentHash !== "string" ||
    contract.documentHash !== input.presentedDocumentHash
  )
    return refuse("DOCUMENT_CHANGED");
  if (!input.consent) return refuse("CONSENT_REQUIRED");
  if (!normaliseTypedName(input.typedName)) return refuse("NAME_REQUIRED");
  return { allowed: true, alreadySigned: false };
}

/** What the couple is told for each refusal. Never a code, never blame. */
export const signingRefusalCopy: Record<SigningRefusal, string> = {
  CONTRACT_NOT_FOUND: "This agreement is no longer available. Your studio can send it again.",
  NOT_A_STUDIOCUE_CONTRACT: "This agreement is signed through your studio's signing service, not here.",
  CONTRACT_NOT_SENT: "Your studio hasn't sent this agreement yet.",
  CONTRACT_ALREADY_SIGNED: "This agreement is already signed.",
  CONTRACT_VOIDED: "Your studio withdrew this agreement. They'll send a new one.",
  PROJECT_NOT_AWAITING_SIGNATURE: "This agreement isn't waiting for a signature right now. Message your studio if that seems wrong.",
  SIGNER_NOT_A_CLIENT: "Only the client named on this agreement can sign it.",
  WRONG_SIGNER: "This agreement is addressed to a different email address. Sign in with the email your studio sent it to.",
  DOCUMENT_CHANGED: "Your studio updated this agreement while you were reading it. The page has the latest version — please read it again before signing.",
  CONSENT_REQUIRED: "Tick the box to agree to sign electronically.",
  NAME_REQUIRED: "Type your full name as your signature.",
};
