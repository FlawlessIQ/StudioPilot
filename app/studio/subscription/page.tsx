import { AppShell } from "@/components/layout/app-shell";
import { LiveSubscription } from "@/components/saas/live-subscription";

export default function SubscriptionPage() {
  return (
    <AppShell active="Subscription">
      <LiveSubscription />
    </AppShell>
  );
}
