import { AppShell } from "@/components/layout/app-shell";
import { IntegrationManager } from "@/components/integrations/integration-manager";

export default function IntegrationsPage() {
  return (
    <AppShell active="Integrations">
      <div className="integrations-page">
        <header className="integrations-heading">
          <div>
            <p className="eyebrow">Studio connections</p>
            <h1>Your tools, working together.</h1>
            <p>
              Connect your calendar, meetings, files, contracts, and accounting.
            </p>
          </div>
          <span className="integrations-heading-note">
            Each connection is private to this workspace and can be removed at
            any time.
          </span>
        </header>
        <IntegrationManager />
      </div>
    </AppShell>
  );
}
