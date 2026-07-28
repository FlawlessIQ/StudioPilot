import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function IntegrationsPage() {
  return (
    <AdminShell active="Integrations">
      <header>
        <div>
          <p className="eyebrow">Provider fleet</p>
          <h1>Integration health</h1>
          <p>Normalized connection state across tenant provider accounts.</p>
        </div>
      </header>
      <LiveAdminCollection domain="integrations" />
    </AdminShell>
  );
}
