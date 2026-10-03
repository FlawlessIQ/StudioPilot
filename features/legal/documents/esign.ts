import type { LegalDocument } from "../document-types";
import { ESIGN_PAGE_EFFECTIVE, LEGAL_ENTITY } from "../legal";
import { currentEsignConsent } from "../../contracts/esign-consent";

/**
 * The consent every signer accepts, published word for word from
 * features/contracts/esign-consent.ts — the same text the signing screen
 * shows and hashes into each signature record — so the page can never say
 * something different from what was agreed.
 */
export const ESIGN_DISCLOSURE: LegalDocument = {
  slug: "esign",
  path: "/legal/esign",
  title: "Electronic Signature Disclosure and Consent",
  description: "The disclosure and consent every signer accepts before signing an agreement electronically through StudioCue.",
  version: currentEsignConsent.id.replace(/^esign-consent-v/, ""),
  effective: ESIGN_PAGE_EFFECTIVE,
  intro: [
    "Studios use StudioCue to send agreements that their clients sign electronically. Before signing, each signer is shown the disclosure below and must confirm the statement in Section 1. This page reproduces the current version exactly. The version a signer accepted is recorded with their signature.",
  ],
  sections: [
    {
      id: "consent",
      title: "1. The statement the signer confirms",
      blocks: [{ note: currentEsignConsent.label }],
    },
    {
      id: "disclosure",
      title: "2. The disclosure",
      blocks: currentEsignConsent.disclosure.map((paragraph) => {
        const [lead, ...rest] = paragraph.split(". ");
        return rest.length ? { p: `**${lead}.** ${rest.join(". ")}` } : { p: paragraph };
      }),
    },
    {
      id: "studio",
      title: "3. The studio’s signature",
      blocks: [
        { p: "The studio signs first, when it sends the agreement, by typing its signer’s name and confirming: “I’m signing this agreement for the studio, electronically, and my typed name is my signature.” The client’s signature then completes the agreement." },
      ],
    },
    {
      id: "law",
      title: "4. Legal framework",
      blocks: [
        { p: `Electronic signatures through StudioCue are designed to comply with the U.S. Electronic Signatures in Global and National Commerce Act (15 U.S.C. § 7001 et seq.) and state laws based on the Uniform Electronic Transactions Act. The agreement itself is between the studio and its client; ${LEGAL_ENTITY.name} provides the signing technology and is not a party to it. See our [Terms of Service](/terms) and [Privacy Policy](/privacy).` },
      ],
    },
  ],
};
