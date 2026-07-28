import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function AuditLogsPage() {
  return (
    <AdminShell active="Audit logs">
      <header>
        <div>
          <p className="eyebrow">Immutable record</p>
          <h1>Audit logs</h1>
          <p>High-signal user, provider, automation, support, and AI events.</p>
        </div>
      </header>
      <LiveAdminCollection domain="audit" />
    </AdminShell>
  );
}
