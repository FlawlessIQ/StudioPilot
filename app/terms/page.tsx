import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header><Link href="/"><Logo /></Link><Link href="/"><ArrowLeft size={15} /> Back home</Link></header>
      <article>
        <p className="eyebrow">Terms framework · Draft for legal review</p>
        <h1>StudioCue Terms</h1>
        <p className="legal-lead">These pilot terms describe the intended product boundary and require final legal review before commercial use.</p>
        <h2>Service</h2>
        <p>StudioCue provides photography operations software, workflow coordination, secure portals, integrations, and assistive AI features. It does not provide legal, accounting, insurance, or child-safety advice.</p>
        <h2>Customer responsibilities</h2>
        <p>Customers are responsible for lawful data collection, permissions, message consent, provider accounts, contract language, insurance review, child-directed workflows, and the accuracy of business configuration.</p>
        <h2>Third-party providers</h2>
        <p>QuickBooks, Docusign, Stripe, Google, Zoom, Dropbox, SendGrid, Twilio, and other providers remain governed by their own terms. Provider status is reconciled but cannot be guaranteed continuously.</p>
        <h2>AI features</h2>
        <p>AI drafts and recommendations require human review. AI cannot establish signatures, payment completion, insurance sufficiency, user permission, or event readiness.</p>
      </article>
    </main>
  );
}
