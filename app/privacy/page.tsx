import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How StudioCue collects, uses, protects, and deletes information.",
};

export default function PrivacyPage() {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header><Link href="/"><Logo /></Link><Link href="/"><ArrowLeft size={15} /> Back home</Link></header>
      <article>
        <p className="eyebrow">Effective August 20, 2026</p>
        <h1>Privacy at StudioCue</h1>
        <p className="legal-lead">StudioCue is designed around tenant isolation, minimum necessary access, and clear control over business data.</p>

        <h2>Who we are</h2>
        <p>StudioCue provides workflow software for photography studios. Questions or privacy requests can be sent to <a href="mailto:support@studio-cue.com">support@studio-cue.com</a>.</p>

        <h2>Data we process</h2>
        <p>Studios may provide account, client, project, vendor, crew, document, schedule, communication, invoice, and integration data needed to operate their business. We also process limited technical information needed to secure, support, and improve the service. StudioCue does not store client payment-card or bank-account credentials.</p>

        <h2>How information is used</h2>
        <p>We use information to deliver requested workflows, secure portals, provider synchronization, communications, reporting, audit history, customer support, and permission-aware AI assistance. AI output is advisory for legal, payment, insurance, and readiness decisions.</p>

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
        <p>StudioCue uses service providers to host and operate the application and connected services selected by a studio. We disclose only the information needed for those providers to perform their services. We may also disclose information when required by law, to protect the service and its users, or as part of a business transaction subject to appropriate safeguards.</p>

        <h2>Security</h2>
        <p>Access is tenant- and project-scoped. Provider tokens remain server-side and are protected using managed secret storage and encryption. StudioCue uses HTTPS in transit, access controls, audit records, and operational monitoring. No system is completely secure, so suspected issues should be reported promptly to <a href="mailto:support@studio-cue.com">support@studio-cue.com</a>.</p>

        <h2>Retention and deletion</h2>
        <p>We retain information while it is needed to provide the service, satisfy legal or accounting obligations, resolve disputes, and enforce agreements. A studio may disconnect an integration to stop future synchronization. Account and deletion requests are handled according to applicable requirements, subject to limited backups and records we must retain.</p>

        <h2>Your privacy rights</h2>
        <p>Depending on where you live, you may have rights to access, correct, export, restrict or object to processing, withdraw consent, or delete personal information. You may also have the right to appeal a decision or complain to a data-protection authority.</p>
        <p>To exercise a right, email <a href="mailto:support@studio-cue.com?subject=Privacy%20request">support@studio-cue.com</a> with the subject “Privacy request.” We may verify your identity and authority before fulfilling a request. Authorized agents may submit requests where permitted by law.</p>

        <h2>Children and sports workflows</h2>
        <p>StudioCue does not create child accounts, message children directly, use facial recognition, or create public child profiles. Parents or guardians manage access and releases.</p>

        <h2>Changes to this policy</h2>
        <p>We may update this policy as StudioCue changes. The effective date above identifies the latest version. Material changes will be communicated through the service or another appropriate channel.</p>
      </article>
    </main>
  );
}
