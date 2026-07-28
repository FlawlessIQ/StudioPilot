import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Audit Log" };

export default function AuditPage() {
  return (
    <AppShell active="Workflows">
      <StudioDomainPage
        domain="audit"
        eyebrow="Immutable evidence"
        title="Audit log"
        description="Meaningful user, system, automation, AI, and provider actions."
      />
    </AppShell>
  );
}
