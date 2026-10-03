import type { LegalDocument } from "../document-types";
import { COPYRIGHT_EFFECTIVE, COPYRIGHT_VERSION, LEGAL_ENTITY } from "../legal";

const { name, addressOneLine, email } = LEGAL_ENTITY;

export const COPYRIGHT_POLICY: LegalDocument = {
  slug: "copyright",
  path: "/legal/copyright",
  title: "Copyright Policy",
  description: "How to report alleged copyright infringement on StudioCue, how to file a counter-notice, and our repeat-infringer policy.",
  version: COPYRIGHT_VERSION,
  effective: COPYRIGHT_EFFECTIVE,
  intro: [
    "StudioCue respects the intellectual property of others, and photographers above all. We respond to notices of alleged copyright infringement that comply with the Digital Millennium Copyright Act (17 U.S.C. § 512).",
  ],
  sections: [
    {
      id: "notice",
      title: "1. Reporting infringement",
      blocks: [
        { p: "If you believe material hosted on StudioCue infringes your copyright, send a written notice to our designated agent that includes:" },
        { ordered: [
          "your physical or electronic signature;",
          "identification of the copyrighted work you claim is infringed;",
          "identification of the material you claim is infringing, with information reasonably sufficient for us to locate it (such as a URL);",
          "your name, address, telephone number and email address;",
          "a statement that you have a good-faith belief that the use is not authorized by the copyright owner, its agent or the law; and",
          "a statement, under penalty of perjury, that the information in the notice is accurate and that you are the copyright owner or authorized to act on the owner’s behalf.",
        ] },
      ],
    },
    {
      id: "agent",
      title: "2. Designated agent",
      blocks: [
        { p: `Copyright Agent, ${name}, ${addressOneLine}, United States · [${email}](mailto:${email}?subject=Copyright%20notice) (subject: “Copyright notice”).` },
      ],
    },
    {
      id: "counter",
      title: "3. Counter-notices",
      blocks: [
        { p: "If material you posted was removed and you believe it was removed by mistake or misidentification, you may send a counter-notice to our designated agent that includes: your physical or electronic signature; identification of the material removed and where it appeared; a statement under penalty of perjury that you have a good-faith belief it was removed by mistake or misidentification; your name, address and telephone number; and a statement that you consent to the jurisdiction of the federal district court for your address (or, if outside the United States, the District of New Jersey) and will accept service of process from the person who filed the original notice. We may restore the material in 10 to 14 business days unless the complainant notifies us that it has filed a court action." },
      ],
    },
    {
      id: "repeat",
      title: "4. Repeat infringers",
      blocks: [
        { p: "We terminate, in appropriate circumstances, the accounts of users who are repeat infringers. Knowingly submitting a false notice or counter-notice may expose you to liability under 17 U.S.C. § 512(f)." },
      ],
    },
  ],
};
