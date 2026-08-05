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
        <p className="eyebrow">Effective August 5, 2026</p>
        <h1>Privacy at StudioCue</h1>
        <p className="legal-lead">StudioCue is designed around tenant isolation, minimum necessary access, and clear control over business data.</p>

        <h2>Who we are</h2>
        <p>StudioCue provides workflow software for photography studios. Questions or privacy requests can be sent to <a href="mailto:support@studio-cue.com">support@studio-cue.com</a>.</p>

        <h2>Data we process</h2>
        <p>Studios may provide account, client, project, vendor, crew, document, schedule, communication, invoice, and integration data needed to operate their business. We also process limited technical information needed to secure, support, and improve the service. StudioCue does not store client payment-card or bank-account credentials.</p>

        <h2>How information is used</h2>
        <p>We use information to deliver requested workflows, secure portals, provider synchronization, communications, reporting, audit history, customer support, and permission-aware AI assistance. AI output is advisory for legal, payment, insurance, and readiness decisions.</p>

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
