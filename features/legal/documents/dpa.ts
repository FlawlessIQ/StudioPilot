import type { LegalDocument } from "../document-types";
import { DPA_EFFECTIVE, DPA_VERSION, LEGAL_ENTITY } from "../legal";

const { name, email } = LEGAL_ENTITY;

export const DATA_PROCESSING_ADDENDUM: LegalDocument = {
  slug: "dpa",
  path: "/legal/dpa",
  title: "Data Processing Addendum",
  description: "How StudioCue processes Client Data on behalf of Studios: instructions, confidentiality, security, subprocessors, breach notice, assistance, deletion and state-law terms.",
  version: DPA_VERSION,
  effective: DPA_EFFECTIVE,
  intro: [
    `This Data Processing Addendum (“DPA”) forms part of the StudioCue [Terms of Service](/terms) between ${name} (“StudioCue”) and the Customer (the Studio). It applies automatically when the Customer accepts the Terms and governs StudioCue’s processing of Client Data on the Customer’s behalf. Capitalized terms not defined here have the meanings given in the Terms.`,
  ],
  sections: [
    {
      id: "definitions",
      title: "1. Definitions",
      blocks: [
        { list: [
          "**“Data Protection Laws”** means all U.S. federal and state privacy and data-protection laws applicable to the processing of Client Data under the Agreement, including the California Consumer Privacy Act as amended and comparable state consumer-privacy laws.",
          "**“Client Data”** has the meaning given in the Terms and includes all personal information, personal data and similar terms as defined in Data Protection Laws, within Customer Data.",
          "**“Process”** means any operation performed on Client Data, such as collection, storage, use, disclosure, transmission and deletion.",
          "**“Subprocessor”** means any third party engaged by StudioCue to process Client Data.",
          "**“Security Incident”** means a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorized disclosure of, or access to, Client Data processed by StudioCue.",
        ] },
      ],
    },
    {
      id: "roles",
      title: "2. Roles and scope",
      blocks: [
        { p: "The Customer is the business (or controller) and StudioCue is the service provider (or processor) with respect to Client Data. The Customer determines the purposes and means of processing Client Data. The details of processing are set out in Annex 1. Each party will comply with the obligations that apply to it under Data Protection Laws." },
        { p: "The Customer is responsible for the lawfulness of the Client Data it provides and of its instructions, including providing any required notices to, and obtaining any required consents from, individuals, and for ensuring that its instructions comply with Data Protection Laws." },
      ],
    },
    {
      id: "instructions",
      title: "3. Processing on instructions",
      blocks: [
        { p: "StudioCue will process Client Data only on the Customer’s documented instructions, which consist of: the Agreement; the Customer’s use and configuration of the Service; and any further written instructions agreed by the parties. StudioCue will inform the Customer if, in its opinion, an instruction violates Data Protection Laws, and is not required to follow such an instruction. StudioCue may process Client Data where required by law, in which case it will inform the Customer before processing unless the law prohibits it." },
      ],
    },
    {
      id: "service-provider",
      title: "4. U.S. state-law service-provider terms",
      blocks: [
        { p: "With respect to Client Data, StudioCue certifies that it understands and will comply with the following restrictions. StudioCue will not:" },
        { list: [
          "sell or share Client Data, as those terms are defined in Data Protection Laws;",
          "retain, use or disclose Client Data for any purpose other than the business purposes specified in the Agreement, including for any commercial purpose other than providing the Service, or outside the direct business relationship between StudioCue and the Customer;",
          "combine Client Data with personal information it receives from or on behalf of another person or collects from its own interactions with individuals, except as permitted by Data Protection Laws (for example, to detect security incidents or protect against fraud); or",
          "use Client Data to train or improve artificial-intelligence models.",
        ] },
        { p: "StudioCue will provide the same level of privacy protection as required of the Customer by Data Protection Laws, will notify the Customer if it determines that it can no longer meet its obligations under those laws, and grants the Customer the right, on notice, to take reasonable and appropriate steps to stop and remediate unauthorized use of Client Data." },
      ],
    },
    {
      id: "confidentiality",
      title: "5. Confidentiality and personnel",
      blocks: [
        { p: "StudioCue will ensure that personnel authorized to process Client Data are bound by appropriate obligations of confidentiality, receive appropriate training, and have access only to the Client Data necessary to perform their duties." },
      ],
    },
    {
      id: "security",
      title: "6. Security",
      blocks: [
        { p: "StudioCue will implement and maintain appropriate technical and organizational measures to protect Client Data against Security Incidents, taking into account the state of the art, the costs of implementation and the nature, scope, context and purposes of processing. These measures include, at a minimum, those described in Annex 2. StudioCue may update its measures from time to time provided that the update does not materially decrease the overall protection of Client Data." },
      ],
    },
    {
      id: "subprocessors",
      title: "7. Subprocessors",
      blocks: [
        { p: "The Customer gives StudioCue general authorization to engage Subprocessors. StudioCue’s current Subprocessors are listed on the [Subprocessors](/subprocessors) page, which identifies each Subprocessor, its purpose and location. StudioCue will:" },
        { list: [
          "enter into a written agreement with each Subprocessor imposing data-protection obligations no less protective than those in this DPA, to the extent applicable to the services provided;",
          "update the Subprocessors page at least 15 days before authorizing a new Subprocessor to process Client Data, except where an emergency replacement is needed to maintain the Service, in which case StudioCue will update the page as soon as practicable;",
          "remain responsible for each Subprocessor’s compliance with its obligations.",
        ] },
        { p: `The Customer may object to a new Subprocessor on reasonable data-protection grounds by emailing [${email}](mailto:${email}) within 15 days after the update. The parties will discuss the objection in good faith. If StudioCue cannot reasonably accommodate it, the Customer may terminate the affected subscription and receive a refund of prepaid fees for the unused remainder of the then-current billing period.` },
        { p: "Third-Party Services that the Customer chooses to connect (such as Google Calendar, Zoom, QuickBooks Online or Dropbox) are engaged by the Customer, not by StudioCue, and are not StudioCue’s Subprocessors; data flows to them at the Customer’s direction." },
      ],
    },
    {
      id: "assistance",
      title: "8. Assistance with individuals’ requests",
      blocks: [
        { p: "Taking into account the nature of the processing, StudioCue will assist the Customer by appropriate technical and organizational measures, insofar as possible, in responding to requests from individuals to exercise their rights under Data Protection Laws. The Service provides tools for the Customer to access, correct, export and delete Client Data. If StudioCue receives a request from an individual relating to Client Data, it will promptly refer the individual to the Customer and will not respond directly except to confirm the referral or as required by law. StudioCue will also provide reasonable assistance with any data-protection assessments and consultations with regulators that the Customer is required to carry out in relation to the Service." },
      ],
    },
    {
      id: "incidents",
      title: "9. Security Incidents",
      blocks: [
        { p: "StudioCue will notify the Customer without undue delay, and in any event within 72 hours, after becoming aware of a Security Incident affecting the Customer’s Client Data. The notice will be sent to the Account Owner’s email address and will describe, to the extent known: the nature of the incident; the categories and approximate number of individuals and records concerned; the likely consequences; and the measures taken or proposed to address it. StudioCue will take reasonable steps to contain, investigate and mitigate the incident, will provide updates as information becomes available, and will reasonably cooperate with the Customer’s legal obligations to notify individuals or authorities. Notification is not an acknowledgement of fault or liability." },
      ],
    },
    {
      id: "deletion",
      title: "10. Return and deletion",
      blocks: [
        { p: "During the Subscription Term, the Customer may export and delete Client Data using the Service. After termination, StudioCue will make Client Data available for export for 30 days, and will then delete it from the active Service, with residual backup copies overwritten within 90 days, except where retention is required by law. Signature evidence records retained with signed agreements, and audit records needed to demonstrate compliance, are deleted with the workspace they belong to." },
      ],
    },
    {
      id: "audits",
      title: "11. Information and audits",
      blocks: [
        { p: "StudioCue will make available to the Customer, on reasonable written request no more than once in any 12-month period (or following a Security Incident or a regulator’s request), information reasonably necessary to demonstrate compliance with this DPA, which may include responses to a reasonable security questionnaire, summaries of StudioCue’s security measures, and certifications or reports of its infrastructure providers. Any further audit will be at the Customer’s expense, on at least 30 days’ notice, during business hours, subject to confidentiality obligations and in a manner that does not compromise the security of the Service or other customers’ data." },
      ],
    },
    {
      id: "location",
      title: "12. Location of processing",
      blocks: [
        { p: "StudioCue stores and processes Client Data in the United States. If the Customer is subject to laws that restrict transfers of personal data to the United States, the Customer must not use the Service for such data unless the parties have first agreed appropriate transfer terms in writing." },
      ],
    },
    {
      id: "liability",
      title: "13. Liability and precedence",
      blocks: [
        { p: "Each party’s liability arising out of or relating to this DPA is subject to the limitations of liability in the Terms. In the event of a conflict between this DPA and the Terms regarding the processing of Client Data, this DPA prevails. This DPA remains in effect for as long as StudioCue processes Client Data on the Customer’s behalf." },
      ],
    },
    {
      id: "annex-1",
      title: "Annex 1 — Details of processing",
      blocks: [
        { table: {
          head: ["Item", "Description"],
          rows: [
            ["Subject matter", "Provision of the StudioCue Service to the Customer"],
            ["Duration", "The Subscription Term, plus the export and deletion periods in Section 10"],
            ["Nature and purpose", "Hosting, storage, organization, retrieval, transmission, display and deletion of Client Data to operate inquiries, proposals, agreements and electronic signatures, invoices, questionnaires, schedules, crew coordination, communications, delivery and reviews; AI-assisted drafting and extraction for the Customer’s review; security, support and maintenance"],
            ["Categories of individuals", "The Customer’s prospective and current clients and their families, partners, guests and representatives; contacts at corporate and organizational clients; parents and guardians of minors; the Customer’s crew, contractors, vendors, venues and planners; and any other individuals whose information the Customer submits"],
            ["Categories of personal data", "Names and contact details; event dates, locations and schedules; preferences and planning answers; names of people to be photographed; agreement content and signature evidence; invoice amounts, billing addresses and payment status (not payment-card or bank details); messages; uploaded documents and images; crew roles, availability, rates and tax-form status"],
            ["Sensitive data", "None intended. The Customer must not submit the categories of data prohibited by Section 13 of the Terms. Names of minors may be included only where the Customer’s work requires it"],
            ["Frequency", "Continuous, for the duration of the Agreement"],
          ],
        } },
      ],
    },
    {
      id: "annex-2",
      title: "Annex 2 — Technical and organizational security measures",
      blocks: [
        { list: [
          "**Infrastructure.** Hosting on Google Cloud in the United States, a provider with independent security certifications (including ISO/IEC 27001 and SOC 2), with managed physical security and redundancy.",
          "**Encryption.** TLS for data in transit; encryption at rest for databases, file storage and backups; secrets and integration credentials held in a managed secret store and encrypted.",
          "**Tenant isolation.** Every record carries its Customer identifier; access is enforced server-side and by database security rules on every request, so one Customer’s data cannot be read by another.",
          "**Access control.** Role-based permissions within each workspace; sensitive actions (billing, permissions, signatures, payments) performed only through authenticated server-side commands; least-privilege access for StudioCue personnel, with administrative access restricted to authorized personnel.",
          "**Authentication.** Managed identity platform with email verification, optional Google sign-in, protection against email enumeration, and abuse protection for public forms.",
          "**Application security.** Input validation on all commands; verification of signed webhooks from payment and integration providers; idempotent processing; rate limiting of public endpoints; dependency vulnerability monitoring.",
          "**Logging and monitoring.** Audit records for sensitive changes; operational and security logging; automated alerting on errors, outages and failed jobs.",
          "**Resilience.** Daily and weekly database backups, with tested restoration; deletion protection on the production database.",
          "**AI safeguards.** AI processing within StudioCue’s own cloud project; no training on Client Data; AI cannot send client-facing communications, sign, record payments or change permissions without human approval.",
          "**Personnel.** Confidentiality obligations; security awareness; prompt removal of access when no longer required.",
          "**Incident response.** Documented procedures to detect, contain, investigate and notify Security Incidents.",
        ] },
      ],
    },
  ],
};
