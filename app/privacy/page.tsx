import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LEGAL_ENTITY, PRIVACY_EFFECTIVE, PRIVACY_VERSION, legalDate } from "@/features/legal/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How StudioCue collects, uses, protects, and deletes information.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy · StudioCue",
    description: "How StudioCue collects, uses, protects, and deletes information.",
  },
};

export default function PrivacyPage() {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header><Link href="/"><Logo /></Link><Link href="/"><ArrowLeft size={15} /> Back home</Link></header>
      <article>
        <p className="eyebrow">Version {PRIVACY_VERSION} · Effective {legalDate(PRIVACY_EFFECTIVE)}</p>
        <h1>Privacy at StudioCue</h1>
        <p className="legal-lead">StudioCue is designed around tenant isolation, minimum necessary access, and clear control over business data.</p>

        <h2>Who we are</h2>
        <p>StudioCue is workflow software for photography and video studios, operated by {LEGAL_ENTITY.name}, {LEGAL_ENTITY.addressOneLine}. Questions or privacy requests can be sent to <a href="mailto:support@studio-cue.com">support@studio-cue.com</a>.</p>

        <h2>Studios and their clients</h2>
        <p>StudioCue has two kinds of relationship with personal information:</p>
        <ul className="legal-list">
          <li><strong>Studio accounts.</strong> For the people who sign up for and use a studio workspace, StudioCue decides how their account information is used and is responsible for it under this policy.</li>
          <li><strong>A studio&apos;s clients, crew and vendors.</strong> When a studio puts information about the people, families and businesses it works for, and its crew and vendors into StudioCue, the studio decides what is collected and why, and StudioCue processes it on the studio&apos;s behalf under our <Link href="/terms">Terms of Service</Link>. If you are a studio&apos;s client and want to access, correct or delete your information, please contact the studio first; we will help the studio respond, and you can also write to us.</li>
        </ul>

        <h2>Data we process</h2>
        <p>Studios may provide account, client, project, vendor, crew, document, schedule, communication, invoice, and integration data needed to operate their business. We also process limited technical information needed to secure, support, and improve the service. StudioCue does not store client payment-card or bank-account credentials.</p>

        <h2>How information is used</h2>
        <p>We use information to deliver requested workflows, secure portals, provider synchronization, communications, reporting, audit history, customer support, and permission-aware AI assistance. AI output is advisory for legal, payment, insurance, and readiness decisions.</p>

        <h2>Electronic signatures</h2>
        <p>When a studio sends an agreement through StudioCue and a client signs it, StudioCue records, as evidence of each signature, the name typed, the email address the signer is signed in with, the date and time, the signer&apos;s IP address, and the device and browser used, together with the version of the electronic-signature consent they agreed to and a fingerprint of the exact agreement text. This record is kept with the agreement, printed on its signing record, and available to the signer, the studio, and StudioCue to operate the service. It is retained for as long as the agreement is, so that the signature can be verified if it is ever questioned.</p>

        <h2>Google Calendar data</h2>
        <p>A studio may connect its own Google Calendar so StudioCue can offer clients only consultation times the studio is genuinely free, and place booked work on that calendar. StudioCue requests two Google OAuth scopes. The Google user data accessed under each is:</p>
        <ul className="legal-list">
          <li><strong>https://www.googleapis.com/auth/calendar.freebusy</strong> — the free/busy availability of the primary calendar of the connected Google Account. StudioCue receives only the start and end times of periods marked busy. This scope does not permit reading the title, description, location, attendees, or any other content of a calendar entry, and StudioCue does not receive that content.</li>
          <li><strong>https://www.googleapis.com/auth/calendar.events.owned</strong> — calendar events on calendars the connected Google Account owns. StudioCue creates consultation and event-day entries for that studio&apos;s booked work, and reads, updates, or deletes those same entries when the studio reschedules or cancels. It acts only on entries it created, identified by an event identifier stored with the corresponding consultation or project. It does not list a studio&apos;s calendars or modify entries created by anyone else.</li>
        </ul>
        <p>In addition to the calendar data above, StudioCue stores the OAuth access and refresh tokens issued for that Google Account, and for each entry it creates, the Google event identifier and event link.</p>
        <p><strong>How it is used.</strong> Free/busy availability is used to compute which consultation times to offer, and the event scope is used to keep the studio&apos;s calendar in step with its bookings. Google user data is used only to provide these features for the authorizing customer. It is not sold, used for advertising, shared with unrelated customers, or used to train or improve generalized artificial-intelligence or machine-learning models. Google Calendar data is not sent to StudioCue&apos;s AI features.</p>
        <p><strong>How it is stored and retained.</strong> Free/busy availability is requested at the moment a set of consultation times is calculated and is not written to StudioCue&apos;s records. Event identifiers and links are retained for as long as the consultation or project they belong to exists. Access and refresh tokens are held server-side in managed secret storage and are never exposed to the browser.</p>
        <p><strong>How to stop and remove access.</strong> Disconnecting Google Calendar in StudioCue removes its reference to the stored credential and ends all further access to the Google Account, including availability reads and calendar writes. Revoking StudioCue from the Google Account permissions page invalidates the issued tokens directly. Removing an entry in Google Calendar does not change the corresponding record in StudioCue.</p>

        <h2>AI features and Limited Use</h2>
        <p>StudioCue&apos;s use of raw or derived user data received from Google Workspace APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Google user data is not used, transferred, or sold to create, train, or improve foundational or generalized artificial-intelligence or machine-learning models, whether in raw, aggregated, anonymized, or derived form.</p>
        <p>StudioCue&apos;s AI-assisted drafting and review features run on Google Vertex AI, using Google&apos;s Gemini models, inside StudioCue&apos;s own Google Cloud project. StudioCue integrates no third-party AI service providers, model gateways, model aggregators, or self-hosted models. Data obtained from the Google Calendar API is not sent to these features at all: they operate on the studio&apos;s own StudioCue records, such as project, package, questionnaire, and document data. AI output is advisory and is never the authority for legal, payment, signature, permission, or readiness decisions, each of which requires a human decision.</p>

        <h2>Zoom data</h2>
        <p>If a studio connects Zoom, StudioCue processes OAuth authorization details and the meeting information needed to create, view, update, and cancel that studio&apos;s Zoom meetings. Zoom information is used only to provide the connected workflow for the authorizing customer. It is not sold, used for advertising, shared with unrelated customers, or used to train AI models.</p>

        <h2>Service providers and sharing</h2>
        <p>StudioCue uses service providers to host and operate the application, and the connected services a studio chooses to use. They are named, with what each does and where, on our <Link href="/subprocessors">subprocessors page</Link>. We disclose only the information needed for those providers to perform their services, under terms that protect it. We may also disclose information when required by law, to protect the service and its users, or as part of a business transaction subject to appropriate safeguards.</p>
        <p><strong>We do not sell personal information, and we do not share it for cross-context behavioral advertising.</strong> StudioCue shows no advertising.</p>

        <h2>Cookies and browser storage</h2>
        <p>StudioCue uses only the cookies and browser storage it needs to work: keeping you signed in, securing your session, protecting forms from abuse, and remembering small preferences such as a dismissed notice. We do not use advertising cookies or third-party tracking, and we do not run analytics that follow you across other websites. If StudioCue encounters an error in your browser, a short technical report (the error, the page and your browser type, without your personal details) is sent to us so we can fix it.</p>

        <h2>Where information is stored</h2>
        <p>StudioCue stores and processes information in the United States, on Google Cloud.</p>

        <h2>Security</h2>
        <p>Access is tenant- and project-scoped. Provider tokens remain server-side and are protected using managed secret storage and encryption. StudioCue uses HTTPS in transit, access controls, audit records, and operational monitoring. No system is completely secure, so suspected issues should be reported promptly to <a href="mailto:support@studio-cue.com">support@studio-cue.com</a>.</p>

        <h2>Retention and deletion</h2>
        <ul className="legal-list">
          <li><strong>Workspace data</strong> (clients, jobs, agreements, documents, messages and files) is kept while the studio&apos;s account is open. A studio can delete records or a whole job at any time. When an account closes, the studio has 30 days to export its data; we then delete the workspace, and remaining copies in our backups expire within 90 days.</li>
          <li><strong>Signature evidence</strong> is kept with the agreement it belongs to, for as long as the agreement is kept.</li>
          <li><strong>Inquiries that never became bookings</strong> stay in the studio&apos;s workspace until the studio closes or deletes them.</li>
          <li><strong>StudioCue subscription and billing records</strong> are kept for seven years to meet tax and accounting obligations.</li>
          <li><strong>Backups</strong> are kept for up to 84 days. <strong>Security and operational logs</strong> are kept for up to 30 days, longer only when needed to investigate a security incident.</li>
        </ul>
        <p>A studio may disconnect an integration at any time to stop future synchronization. To request deletion of an account, email <a href="mailto:support@studio-cue.com?subject=Deletion%20request">support@studio-cue.com</a>.</p>

        <h2>Your privacy rights</h2>
        <p>Depending on where you live — including under the privacy laws of California and other U.S. states — you may have rights to know what personal information we hold, to access, correct, export or delete it, to restrict or object to processing, to withdraw consent, and to opt out of the sale or sharing of personal information (we do neither). We will not discriminate against you for exercising these rights. You may also have the right to appeal a decision or complain to a data-protection authority.</p>
        <p>To exercise a right, email <a href="mailto:support@studio-cue.com?subject=Privacy%20request">support@studio-cue.com</a> with the subject “Privacy request.” We may verify your identity and authority before fulfilling a request. Authorized agents may submit requests where permitted by law.</p>

        <h2>Children and sports workflows</h2>
        <p>StudioCue is for businesses and adults. Accounts are for people 18 and over, and we do not knowingly collect personal information directly from children under 13. StudioCue does not create child accounts, message children directly, use facial recognition, or create public child profiles. When a studio&apos;s work involves minors, such as family sessions or youth sports, the parent, guardian or organization is the studio&apos;s client and manages access and releases; a child&apos;s name appears only where the studio enters it. If you believe a child has given us personal information directly, contact <a href="mailto:support@studio-cue.com">support@studio-cue.com</a> and we will delete it.</p>

        <h2>Changes to this policy</h2>
        <p>We may update this policy as StudioCue changes. The version and effective date above identify the latest version. For a material change we will email studio account owners and show a notice in StudioCue before it takes effect.</p>

        <h2>Contact</h2>
        <p>{LEGAL_ENTITY.name}<br />{LEGAL_ENTITY.addressLines.map((line) => (<span key={line}>{line}<br /></span>))}<a href="mailto:support@studio-cue.com">support@studio-cue.com</a></p>
      </article>
    </main>
  );
}
