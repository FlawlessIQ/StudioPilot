import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function FailedJobsPage() {
  return (
    <AdminShell active="Failed jobs">
      <header>
        <div>
          <p className="eyebrow">Dead-letter operations</p>
          <h1>Failed jobs</h1>
          <p>Manual reruns preserve the original input snapshot and idempotency key.</p>
        </div>
      </header>
      <LiveAdminCollection domain="failed_jobs" />
    </AdminShell>
  );
}
