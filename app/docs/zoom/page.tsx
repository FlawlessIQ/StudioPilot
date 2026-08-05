import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Zoom Integration Guide",
  description: "Connect Zoom to StudioCue and manage studio meetings.",
};

export default function ZoomDocumentationPage() {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header><Link href="/"><Logo /></Link><Link href="/support"><ArrowLeft size={15} /> Support</Link></header>
      <article>
        <p className="eyebrow">Integration guide</p>
        <h1>Using Zoom with StudioCue</h1>
        <p className="legal-lead">Connect a Zoom account so StudioCue can manage consultation, planning, and client-call meetings from your studio workflow.</p>

        <h2>Connect Zoom</h2>
        <ol>
          <li>Sign in to StudioCue and open <Link href="/studio/integrations">Studio integrations</Link>.</li>
          <li>Select Zoom, then choose Connect.</li>
          <li>Sign in to Zoom, review the requested permissions, and authorize StudioCue.</li>
          <li>After Zoom returns you to StudioCue, confirm that the integration shows as connected.</li>
        </ol>

        <h2>Permissions requested</h2>
        <p>StudioCue requests only meeting permissions needed to list, create, read, update, and delete meetings for the authorized Zoom user. StudioCue does not request permission to access recordings, chat messages, contacts, or account administration.</p>

        <h2>Manage meetings</h2>
        <p>Use the relevant StudioCue project or scheduling workflow to create a Zoom meeting. StudioCue returns the meeting link to the workflow. Authorized users can review, reschedule, or cancel the meeting from StudioCue, and changes are synchronized with Zoom.</p>

        <h2>Troubleshooting</h2>
        <p>If the connection fails, confirm that you are signing in to the intended Zoom account and that your Zoom administrator allows marketplace apps. If a meeting cannot be updated, reconnect Zoom and try again. For further help, email <a href="mailto:support@studio-cue.com?subject=Zoom%20integration%20support">support@studio-cue.com</a> without including passwords or OAuth credentials.</p>

        <h2>Disconnect or remove Zoom</h2>
        <p>Open <Link href="/studio/integrations">Studio integrations</Link>, select Zoom, and choose Disconnect. You may also remove StudioCue from the Zoom App Marketplace under Added Apps. Disconnecting prevents future Zoom synchronization. Existing business records remain subject to StudioCue&apos;s <Link href="/privacy">Privacy Policy</Link> and applicable retention obligations.</p>

        <h2>Data handling</h2>
        <p>OAuth credentials are kept server-side and protected using managed secret storage. Zoom data is used only to provide the authorized customer&apos;s meeting workflow and is not used to train AI models. See the <Link href="/privacy">Privacy Policy</Link> for retention, deletion, and privacy-right information.</p>
      </article>
    </main>
  );
}
