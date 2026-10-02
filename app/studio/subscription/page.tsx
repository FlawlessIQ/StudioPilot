import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { LiveSubscription } from "@/components/saas/live-subscription";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Plan & billing" };

export default function SubscriptionPage() {
  return (
    <AppShell active="Subscription">
      <LiveSubscription />
    </AppShell>
  );
}
