import { AppShell } from "@/components/layout/app-shell";
import { IntegrationManager } from "@/components/integrations/integration-manager";

export default function IntegrationsPage() {
  return <AppShell active="Integrations"><div className="booking-page"><header className="page-heading"><div><p className="eyebrow">Provider health</p><h1>Integrations</h1><p>Tenant-scoped OAuth connections, least-privilege scopes, Secret Manager credentials, and normalized failures.</p></div></header><IntegrationManager/><p className="source-note">OAuth refresh tokens are written directly to Secret Manager and never returned to the browser or stored in Firestore plaintext.</p></div></AppShell>;
}
