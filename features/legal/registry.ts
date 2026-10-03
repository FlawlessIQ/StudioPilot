import type { LegalDocument } from "./document-types";
import { TERMS_OF_SERVICE } from "./documents/terms";
import { PRIVACY_POLICY } from "./documents/privacy";
import { DATA_PROCESSING_ADDENDUM } from "./documents/dpa";
import { ACCEPTABLE_USE_POLICY } from "./documents/acceptable-use";
import { COOKIE_NOTICE } from "./documents/cookies";
import { CLIENT_AND_CREW_TERMS } from "./documents/client-terms";
import { ESIGN_DISCLOSURE } from "./documents/esign";
import { SUBPROCESSORS } from "./documents/subprocessors";
import { COPYRIGHT_POLICY } from "./documents/copyright";

/** Every published legal document, in the order the legal hub lists them. */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  TERMS_OF_SERVICE,
  PRIVACY_POLICY,
  DATA_PROCESSING_ADDENDUM,
  ACCEPTABLE_USE_POLICY,
  COOKIE_NOTICE,
  CLIENT_AND_CREW_TERMS,
  ESIGN_DISCLOSURE,
  SUBPROCESSORS,
  COPYRIGHT_POLICY,
];

export function legalDocument(slug: string): LegalDocument {
  const found = LEGAL_DOCUMENTS.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`Unknown legal document: ${slug}`);
  return found;
}
