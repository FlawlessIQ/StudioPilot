import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function FeatureFlagsPage() {
  return (
    <AdminShell active="Feature flags">
      <header>
        <div>
          <p className="eyebrow">Controlled rollout</p>
          <h1>Feature flags</h1>
          <p>Platform-only controls; subscription capabilities still require entitlements.</p>
        </div>
      </header>
      <LiveAdminCollection domain="feature_flags" />
    </AdminShell>
  );
}
