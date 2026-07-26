import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <header><Link href="/"><Logo /></Link><Link href="/"><ArrowLeft size={15} /> Back home</Link></header>
      <article>
        <p className="eyebrow">Policy framework · Draft for legal review</p>
        <h1>Privacy at StudioHub</h1>
        <p className="legal-lead">StudioHub is designed around tenant isolation, minimum necessary access, and explicit operational evidence.</p>
        <h2>Data we process</h2>
        <p>Studios provide account, client, project, vendor, crew, document, schedule, and integration data needed to operate their photography business. StudioHub does not store client card or bank credentials.</p>
        <h2>How information is used</h2>
        <p>Information supports requested workflows, secure portals, provider synchronization, communications, reporting, audit history, and permission-aware AI assistance. AI output remains advisory for legal, payment, insurance, and readiness decisions.</p>
        <h2>Security and retention</h2>
        <p>Access is tenant- and project-scoped. Provider tokens remain server-side and encrypted. Export, archive, retention, and deletion workflows are audited. Production terms and retention periods must be finalized with counsel before pilot launch.</p>
        <h2>Children and sports workflows</h2>
        <p>StudioHub does not create child accounts, message children directly, use facial recognition, or create public child profiles. Parents or guardians manage access and releases.</p>
      </article>
    </main>
  );
}
