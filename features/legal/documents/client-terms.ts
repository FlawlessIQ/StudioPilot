import type { LegalDocument } from "../document-types";
import { CLIENT_TERMS_EFFECTIVE, CLIENT_TERMS_VERSION, LEGAL_ENTITY } from "../legal";

const { name, email } = LEGAL_ENTITY;

export const CLIENT_AND_CREW_TERMS: LegalDocument = {
  slug: "client-terms",
  path: "/legal/client-terms",
  title: "Client and Crew Terms",
  description: "The terms for people who use StudioCue at a studio's invitation: clients, their families and partners, crew, planners and vendors.",
  version: CLIENT_TERMS_VERSION,
  effective: CLIENT_TERMS_EFFECTIVE,
  intro: [
    `These terms apply to you if a photography or video business (your “Studio”) has invited you to use StudioCue — for example to view a proposal, sign an agreement, pay an invoice, complete a questionnaire, review a schedule, receive a gallery link, or, as crew, accept work and view event details. StudioCue is provided by ${name}. By using StudioCue at a Studio’s invitation, you agree to these terms.`,
  ],
  sections: [
    {
      id: "relationship",
      title: "1. Your relationship is with your Studio",
      blocks: [
        { p: "StudioCue is software your Studio uses to run its business. Your Studio, not StudioCue, provides the photography, video or other services you have booked, sets its prices and policies, decides what information to collect, and is responsible for its agreements, invoices and communications with you. StudioCue is not a party to any agreement between you and your Studio and is not responsible for the Studio’s services, conduct, availability or obligations. Please direct questions about your booking, payments, refunds, schedule or deliverables to your Studio." },
      ],
    },
    {
      id: "access",
      title: "2. Your access",
      blocks: [
        { list: [
          "Your access is provided by your Studio and lasts for as long as the Studio keeps it open. The Studio can change or end your access at any time.",
          "Keep your sign-in link and account secure, and do not share them. If you sign in with a magic link, anyone with access to your email may be able to sign in, so keep your email account secure.",
          "You must be at least 18 to create an account. Where a booking concerns a minor, the parent, guardian or responsible organization should use StudioCue on the minor’s behalf.",
          "You may use StudioCue only for your dealings with the Studio that invited you, and in accordance with our [Acceptable Use Policy](/legal/acceptable-use).",
        ] },
      ],
    },
    {
      id: "information",
      title: "3. Your information",
      blocks: [
        { p: "Information you provide through StudioCue — such as your contact details, event details, questionnaire answers, messages and files — is shared with your Studio and processed by StudioCue on the Studio’s behalf. The Studio’s privacy notice describes how it uses your information. Our [Privacy Policy](/privacy) explains how StudioCue handles it, including what we record when you sign electronically. To access, correct or delete your information, contact your Studio; you may also contact us and we will help." },
      ],
    },
    {
      id: "signatures",
      title: "4. Signing electronically",
      blocks: [
        { p: "If your Studio sends you an agreement to sign, you will be asked to accept our [Electronic Signature Disclosure and Consent](/legal/esign) before signing. You may ask your Studio for a paper copy, or to sign on paper, at any time, free of charge." },
      ],
    },
    {
      id: "payments",
      title: "5. Payments",
      blocks: [
        { p: "If you pay an invoice through a link in StudioCue, your payment is processed by your Studio’s payment provider (for example QuickBooks Payments) under that provider’s terms. StudioCue does not receive or hold your payment or your card or bank details. Questions about charges, refunds or payment plans should go to your Studio." },
      ],
    },
    {
      id: "crew",
      title: "6. Crew, planners and vendors",
      blocks: [
        { p: "If you use StudioCue as crew, a planner or a vendor, your engagement, pay, insurance, tax status and working arrangements are solely between you and the Studio. StudioCue is not your employer or agent and does not guarantee any offer of work. Treat client and event information you see as confidential and use it only to perform your work for the Studio." },
      ],
    },
    {
      id: "disclaimer",
      title: "7. Disclaimers and liability",
      blocks: [
        { p: "StudioCue is provided to you free of charge by your Studio’s subscription, “as is” and “as available.” To the fullest extent permitted by law, StudioCue disclaims all warranties, and is not liable for any indirect or consequential damages or for any loss arising from your dealings with your Studio. Nothing in these terms limits any rights you have under consumer-protection laws that cannot be waived." },
      ],
    },
    {
      id: "general",
      title: "8. General",
      blocks: [
        { p: `These terms are governed by the laws of the State of New Jersey. We may update them; the version and effective date above identify the current version, and your continued use after an update means you accept it. Questions about StudioCue: [${email}](mailto:${email}).` },
      ],
    },
  ],
};
