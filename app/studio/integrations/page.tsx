import { AppShell } from "@/components/layout/app-shell";
import { IntegrationManager } from "@/components/integrations/integration-manager";

export default function IntegrationsPage() {
  return <AppShell active="Integrations"><div className="integrations-page"><header className="integrations-heading"><div><p className="eyebrow">Studio connections</p><h1>Your tools, working as one studio.</h1><p>Connect the platforms behind your calendar, consultations, files, contracts, and accounting.</p></div><span className="integrations-heading-note">OAuth connections are isolated to FlawlessIQ and can be revoked at any time.</span></header><IntegrationManager/></div></AppShell>;
}
