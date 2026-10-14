import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { CoiPageIntro } from "@/components/planning/coi-page-intro";
import { CoiWorkflowPanel } from "@/components/planning/coi-workflow-panel";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Insurance" };

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
            <CoiPageIntro />
          </div>
        </header>
        {project ? <ProjectContextBar projectId={project} /> : null}
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
