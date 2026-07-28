import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Automation Runs · StudioHub" };

export default function AutomationsPage() {
  return (
    <AppShell active="Workflows">
      <StudioDomainPage domain="automations" eyebrow="Workflow execution" title="Automation runs" description="Idempotency, attempts, outcomes, and retry state from actual workflow executions." />
    </AppShell>
  );
}
