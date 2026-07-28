import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Workflow Templates" };

export default function WorkflowsPage() {
  return (
    <AppShell active="Workflows">
      <StudioDomainPage
        domain="workflows"
        eyebrow="Repeatable process"
        title="Workflow templates"
        description="Turn your studio process into reusable steps, deadlines, reminders, and handoffs."
        action={{ href: "/studio/workflows/new", label: "Create workflow" }}
      />
    </AppShell>
  );
}
