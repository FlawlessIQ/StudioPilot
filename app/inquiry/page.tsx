import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LeadIntakeForm } from "@/components/crm/lead-intake-form";

export const metadata: Metadata = {
  title: "Photography inquiry · Alder & Muse",
  description: "Tell Alder & Muse about your event and request photography availability.",
};

export default function InquiryPage() {
  return (
    <main className="inquiry-page">
      <header>
        <Logo />
        <Link href="/"><ArrowLeft size={15} /> Back to StudioCue</Link>
      </header>
      <div className="inquiry-layout">
        <aside className="inquiry-intro">
          <p className="eyebrow">Alder &amp; Muse Photography</p>
          <h1>Let’s make something worth remembering.</h1>
          <p>
            Share the essentials and our studio will confirm availability, then send a
            thoughtful next step—never an automated price guess.
          </p>
          <div className="inquiry-assurance">
            <span><ShieldCheck size={18} /><strong>Human reviewed</strong><small>Every inquiry is reviewed by our studio team.</small></span>
            <span><LockKeyhole size={18} /><strong>Private by default</strong><small>Your details stay within this studio workspace.</small></span>
          </div>
        </aside>
        <LeadIntakeForm />
      </div>
    </main>
  );
}
