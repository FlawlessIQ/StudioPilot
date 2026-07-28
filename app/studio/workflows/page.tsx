import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Workflow Templates · StudioHub" };

export default function WorkflowsPage() {
  return (
    <AppShell active="Workflows">
      <StudioDomainPage
        domain="workflows"
        eyebrow="Automation foundation"
        title="Workflow templates"
        description="Immutable versions of checkpoints, relative dates, triggers, conditions, and actions."
        action={{ href: "/studio/workflows/new", label: "Create workflow" }}
      />
    </AppShell>
  );
}
