import { AppShell } from "@/components/layout/app-shell";
import { CoiWorkflowPanel } from "@/components/planning/coi-workflow-panel";
import { LiveDomainView } from "@/components/studio/live-domain-view";

export default function InsurancePage() {
  return (
    <AppShell active="Insurance">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Certificate operations</p>
            <h1>COI workflow</h1>
            <p>AI extracts and compares; a permitted studio reviewer always makes the decision.</p>
          </div>
        </header>
        <div className="human-boundary">
          <span>
            <strong>Legal sufficiency is never automated.</strong>
            <small>Extraction and deterministic comparison are review aids only.</small>
          </span>
        </div>
        <LiveDomainView domain="insurance" />
        <CoiWorkflowPanel />
      </div>
    </AppShell>
  );
}
