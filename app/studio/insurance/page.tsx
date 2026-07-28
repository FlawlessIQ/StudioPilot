import { AppShell } from "@/components/layout/app-shell";
import { CoiWorkflowPanel } from "@/components/planning/coi-workflow-panel";
import { LiveDomainView } from "@/components/studio/live-domain-view";

export default function InsurancePage() {
  return (
    <AppShell active="Insurance">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Venue insurance</p>
            <h1>Certificates of insurance</h1>
            <p>Request, review, correct, and deliver venue certificates in one place.</p>
          </div>
        </header>
        <div className="human-boundary">
          <span>
            <strong>Legal sufficiency is never automated.</strong>
            <small>StudioCue can spot possible discrepancies, but a studio reviewer always decides.</small>
          </span>
        </div>
        <LiveDomainView domain="insurance" />
        <CoiWorkflowPanel />
      </div>
    </AppShell>
  );
}
