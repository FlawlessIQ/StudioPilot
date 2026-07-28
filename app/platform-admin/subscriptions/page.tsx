import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function SubscriptionsPage() {
  return (
    <AdminShell active="Subscriptions">
      <header>
        <div>
          <p className="eyebrow">Stripe references</p>
          <h1>Subscriptions</h1>
          <p>Normalized subscription state and entitlements; payment instruments remain in Stripe.</p>
        </div>
      </header>
      <LiveAdminCollection domain="subscriptions" />
    </AdminShell>
  );
}
