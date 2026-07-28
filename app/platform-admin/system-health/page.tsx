import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function SystemHealthPage() {
  return (
    <AdminShell active="System health">
      <header>
        <div>
          <p className="eyebrow">Production monitoring</p>
          <h1>System health</h1>
          <p>Scheduled checks, structured failures, and actionable operational signals.</p>
        </div>
      </header>
      <LiveAdminCollection domain="health" />
    </AdminShell>
  );
}
