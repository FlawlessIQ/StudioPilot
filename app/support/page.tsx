import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with StudioCue and its connected services.",
};

export default function SupportPage() {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header><Link href="/"><Logo /></Link><Link href="/"><ArrowLeft size={15} /> Back home</Link></header>
      <article>
        <p className="eyebrow">StudioCue support</p>
        <h1>How can we help?</h1>
        <p className="legal-lead">Get help with your workspace, client workflows, billing, or connected providers.</p>

        <h2>Contact support</h2>
        <p>Email <a href="mailto:support@studio-cue.com">support@studio-cue.com</a>. Include your studio name, the affected project or integration, what you expected to happen, and any non-sensitive error message you saw.</p>

        <h2>Zoom integration help</h2>
        <p>For connection, meeting, or permission issues, follow the <Link href="/docs/zoom">StudioCue Zoom integration guide</Link>. It explains how to connect, use, and remove Zoom from your workspace.</p>

        <h2>Protect sensitive information</h2>
        <p>Never email passwords, OAuth tokens, API keys, payment card details, government identifiers, or unredacted client documents. StudioCue support will not ask for your password or provider secret.</p>

        <h2>Privacy and account requests</h2>
        <p>For access, correction, export, or deletion requests, email <a href="mailto:support@studio-cue.com?subject=Privacy%20request">support@studio-cue.com</a> with the subject “Privacy request.” See the <Link href="/privacy">Privacy Policy</Link> for details.</p>
      </article>
    </main>
  );
}
