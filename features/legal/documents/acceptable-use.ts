import type { LegalDocument } from "../document-types";
import { AUP_EFFECTIVE, AUP_VERSION, LEGAL_ENTITY } from "../legal";

const { email } = LEGAL_ENTITY;

export const ACCEPTABLE_USE_POLICY: LegalDocument = {
  slug: "acceptable-use",
  path: "/legal/acceptable-use",
  title: "Acceptable Use Policy",
  description: "The rules for using StudioCue: lawful use, communications, content, security, minors and enforcement.",
  version: AUP_VERSION,
  effective: AUP_EFFECTIVE,
  intro: [
    "This Acceptable Use Policy (“AUP”) describes what is and is not permitted when using StudioCue. It forms part of the [Terms of Service](/terms) and applies to every Customer, Team Member and Invited User. We may update it as described in the Terms.",
  ],
  sections: [
    {
      id: "lawful",
      title: "1. Lawful and honest use",
      blocks: [
        { p: "You must use the Service only for lawful business purposes. You must not use the Service to:" },
        { list: [
          "violate any applicable law or regulation, or encourage others to do so;",
          "deceive, defraud or mislead anyone, including by misrepresenting your identity, your business, your prices or your availability;",
          "harass, threaten, defame, discriminate against or intimidate any person;",
          "facilitate the sale of illegal goods or services; or",
          "engage in any activity that would expose StudioCue or its users to legal liability.",
        ] },
      ],
    },
    {
      id: "communications",
      title: "2. Email and other communications",
      blocks: [
        { list: [
          "Send communications only to people with whom you have, or are establishing, a business relationship — such as people who have made an inquiry, booked you, or work with you — or who have otherwise agreed to hear from you.",
          "Do not send unsolicited bulk or marketing messages (spam), purchased or rented lists, chain messages or messages with misleading subject lines, sender names or headers.",
          "Honor opt-out and unsubscribe requests promptly, and include any identification and postal address the law requires.",
          "Do not use the Service to send text messages without the prior consent required by the Telephone Consumer Protection Act and applicable state law.",
          "Do not attempt to circumvent bounce handling, suppression lists or sending limits.",
        ] },
      ],
    },
    {
      id: "content",
      title: "3. Content",
      blocks: [
        { p: "You must not upload, store, send or share through the Service any content that:" },
        { list: [
          "infringes or misappropriates any copyright, trademark, trade secret, right of publicity or other right of any person, including images you do not have the right to use;",
          "is obscene, sexually exploits anyone, or depicts or sexualizes minors in any way (we report child sexual abuse material to the National Center for Missing & Exploited Children and to law enforcement);",
          "is defamatory, hateful, violent or promotes self-harm;",
          "contains viruses, malware or other harmful code; or",
          "includes the sensitive categories of information prohibited by Section 13 of the Terms, such as Social Security numbers, full payment-card or bank-account numbers, or health information.",
        ] },
      ],
    },
    {
      id: "security",
      title: "4. Security and integrity of the Service",
      blocks: [
        { p: "You must not, and must not attempt to:" },
        { list: [
          "access any account, workspace, data or system you are not authorized to access, including another Customer’s data;",
          "probe, scan or test the vulnerability of the Service, or breach or circumvent any security or authentication measure, without our prior written permission (to report a vulnerability, see Section 7);",
          "interfere with or disrupt the Service, including through denial-of-service attacks, excessive automated requests, or overloading our infrastructure;",
          "use bots, scrapers or other automated means to access the Service, except through interfaces we provide for that purpose;",
          "reverse-engineer, decompile or disassemble the Service, except to the extent permitted by law notwithstanding this restriction;",
          "copy, frame or mirror any part of the Service, or build a competing product using the Service or our Confidential Information; or",
          "share login credentials, resell or sublicense access, or circumvent plan limits, usage allowances or billing.",
        ] },
      ],
    },
    {
      id: "ai",
      title: "5. AI features",
      blocks: [
        { list: [
          "Review AI Output before relying on it or sending it; do not present AI Output as professional advice.",
          "Do not use AI features to generate content that violates this AUP, or attempt to manipulate them into revealing other customers’ information, system instructions or security details.",
          "Do not use AI features to make decisions about individuals that have legal or similarly significant effects without meaningful human review.",
        ] },
      ],
    },
    {
      id: "minors",
      title: "6. Minors",
      blocks: [
        { p: "When your work involves minors, the parent, guardian or responsible organization must be your client and the person you communicate with through the Service. Do not invite minors as users, collect more information about a minor than your work requires, or share a minor’s information or images except as authorized by the parent, guardian or organization and permitted by law." },
      ],
    },
    {
      id: "reporting",
      title: "7. Reporting abuse and vulnerabilities",
      blocks: [
        { p: `Report suspected violations of this AUP, or a security vulnerability, to [${email}](mailto:${email}?subject=Security%20or%20abuse%20report). We appreciate good-faith security research that avoids privacy violations, data destruction and service disruption, is reported to us promptly, and gives us reasonable time to fix the issue before disclosure; we will not pursue legal action against researchers who act in that way.` },
      ],
    },
    {
      id: "enforcement",
      title: "8. Enforcement",
      blocks: [
        { p: "We may investigate suspected violations of this AUP. Depending on the severity, we may remove or disable content, suspend sending, restrict features, suspend or terminate the Account, and report conduct to law enforcement or affected third parties, as provided in the Terms. Where practicable and lawful, we will notify you and give you an opportunity to remedy the issue before taking action, except where immediate action is needed to protect the Service, other users or third parties." },
      ],
    },
  ],
};
