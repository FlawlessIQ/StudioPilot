import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

/**
 * The step-by-step plan Zoom's Marketplace reviewers asked for before
 * approving the meeting-summaries update (review note, 2026-10-02). Public so
 * the link in the submission opens for them; not indexed. Test credentials
 * live in the submission, never here.
 */
export const metadata: Metadata = {
  title: "Zoom update test plan",
  description: "How to test StudioCue's Zoom meeting summaries update.",
  robots: { index: false, follow: false },
};

export default function ZoomTestPlanPage() {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header><Link href="/"><Logo /></Link><Link href="/docs/zoom"><ArrowLeft size={15} /> Zoom guide</Link></header>
      <article>
        <p className="eyebrow">For Zoom Marketplace review</p>
        <h1>Test plan: meeting summaries</h1>
        <p className="legal-lead">This update adds one scope, <code>meeting:read:summary</code>, and one event subscription, <code>meeting.summary_completed</code>. After a consultation&apos;s Zoom meeting ends, StudioCue reads its Zoom summary and attaches it to the consultation as the studio&apos;s notes.</p>

        <h2>Before you start</h2>
        <ul>
          <li><strong>StudioCue account:</strong> use the studio test login in this submission&apos;s test credentials. It opens a test studio with a sample job, <em>Sample Wedding (Zoom review demo)</em>, and no real client data.</li>
          <li><strong>Development client:</strong> this test studio is set to authorize the app&apos;s <strong>development</strong> client (client ID <code>HWCP7VhJShGrxu_tkTOHow</code>). Every other studio uses the production client. Nothing to configure: Connect Zoom uses the development client automatically for this account, and the redirect goes to <code>https://studio-cue.com/api/integrations/oauth/callback</code>, which is on the development allow list.</li>
          <li><strong>Zoom account:</strong> meeting summaries need a Zoom account with AI Companion meeting summary available. The host must be the Zoom user who authorizes the app.</li>
        </ul>

        <h2>1. Connect Zoom (authorize the development app)</h2>
        <ol>
          <li>Sign in at <a href="https://studio-cue.com/auth/login">studio-cue.com/auth/login</a> with the studio test login.</li>
          <li>Open <strong>Settings → Integrations</strong> (or go to <a href="https://studio-cue.com/studio/integrations">studio-cue.com/studio/integrations</a>).</li>
          <li>If <strong>Zoom</strong> already shows as connected (from the earlier review, through the production app), choose <strong>Disconnect</strong> first.</li>
          <li>On <strong>Zoom</strong>, choose <strong>Connect</strong>. Zoom&apos;s consent screen lists the requested scopes, including <code>meeting:read:summary</code>. Authorize.</li>
          <li><strong>Expected:</strong> you return to Integrations and Zoom shows as connected to your Zoom account.</li>
        </ol>

        <h2>2. Create a consultation with a Zoom meeting</h2>
        <ol>
          <li>Open <strong>Calendar</strong> (or go to <a href="https://studio-cue.com/studio/calendar">studio-cue.com/studio/calendar</a>).</li>
          <li>Choose any open time today or tomorrow. Soon is easiest, since you will hold the meeting.</li>
          <li>In the booking dialog, select the project <strong>Sample Wedding (Zoom review demo)</strong>. <strong>Meeting type</strong> is already <strong>Zoom</strong>. Choose <strong>Confirm booking</strong>. (Consultations from the first review are still on the job; this adds a new one.)</li>
          <li><strong>Expected:</strong> the consultation shows a Zoom join link, and the meeting appears in your Zoom account with the waiting room on and meeting summary set to start automatically.</li>
        </ol>

        <h2>3. Hold the meeting</h2>
        <ol>
          <li>Start the meeting from Zoom as the host.</li>
          <li>Talk for two minutes or more; a summary needs some conversation. For example, discuss an event date, venue and coverage.</li>
          <li>End the meeting for all.</li>
        </ol>

        <h2>4. See the summary arrive (the new functionality)</h2>
        <ol>
          <li>Zoom sends <code>meeting.summary_completed</code> when the summary is ready, usually within a few minutes of the meeting ending. StudioCue verifies the signature, then calls <code>GET /v2/meetings/&#123;meetingId&#125;/meeting_summary</code>.</li>
          <li>Open the job again (refresh if it was already open).</li>
          <li><strong>Expected:</strong> the consultation is marked completed, its notes contain the Zoom summary, and the job&apos;s history shows <strong>Zoom consultation captured</strong>. StudioCue then drafts a consultation brief from the notes for the studio to review; nothing is sent to the client automatically.</li>
        </ol>

        <h2>5. Existing behavior, unchanged</h2>
        <ul>
          <li><strong>Reschedule</strong> the consultation from the job: the Zoom meeting&apos;s time updates (<code>PATCH /v2/meetings/&#123;meetingId&#125;</code>).</li>
          <li><strong>Cancel</strong> it: the Zoom meeting is deleted (<code>DELETE /v2/meetings/&#123;meetingId&#125;</code>).</li>
          <li><strong>Disconnect:</strong> Settings → Integrations → Zoom → Disconnect removes the stored credential. Removing the app from Zoom&apos;s Added Apps has the same effect on the next call.</li>
        </ul>

        <h2>If something doesn&apos;t match</h2>
        <p>Email <a href="mailto:support@studio-cue.com?subject=Zoom%20review">support@studio-cue.com</a> and we will reply the same day. Please don&apos;t include passwords or OAuth credentials.</p>
        <p>More about the integration: <Link href="/docs/zoom">Using Zoom with StudioCue</Link>.</p>
      </article>
    </main>
  );
}
