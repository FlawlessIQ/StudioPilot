import { AppShell } from "@/components/layout/app-shell";
import { CoiWorkflowPanel } from "@/components/planning/coi-workflow-panel";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";

export default async function InsurancePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Insurance">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            {/* "Venue insurance" and "venue certificates" described the
                opposite direction of liability: the certificate is the
                studio's own cover, issued by the studio's agent, naming the
                venue as the holder. The model was always right — this copy
                was not, which is enough to make a studio think it has to
                chase the venue for insurance. */}
            <p className="eyebrow">Your insurance</p>
            <h1>Certificate of insurance</h1>
            <p>
              Ask your insurance agent for a certificate naming the venue,
              review it, then send it on.
            </p>
          </div>
        </header>
        {project ? <ProjectContextBar projectId={project} /> : null}
        {/* Who does what, in order. Four parties are involved — the studio,
            its agent, a reviewer and the venue — and the page showed two
            email fields side by side and nothing about the sequence. */}
        <ol className="coi-flow-stages" aria-label="How a certificate gets to the venue">
          <li>You request it from your agent</li>
          <li>Your agent replies with a PDF</li>
          <li>You review it against the venue&apos;s requirements</li>
          <li>You approve it</li>
          <li>StudioCue sends it to the venue</li>
          <li>The venue acknowledges it</li>
        </ol>
        <LiveDomainView domain="insurance" projectId={project} />
        {/* The promise belongs beside the step it constrains — step 3 above,
            and the review queue inside the panel — not above any explanation
            of what the page is for. It stays, verbatim; it just stopped being
            the first thing a studio reads here. */}
        <div className="human-boundary">
          <span>
            <strong>Legal sufficiency is never automated.</strong>
            <small>StudioCue can spot possible discrepancies, but a studio reviewer always decides.</small>
          </span>
        </div>
        <CoiWorkflowPanel projectId={project} />
      </div>
    </AppShell>
  );
}
