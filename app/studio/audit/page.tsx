import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Audit Log" };

export default function AuditPage() {
  return (
    <AppShell active="Workflows">
      <StudioDomainPage
        domain="audit"
        eyebrow="Your studio's record"
        title="Audit log"
        description="What people, Cue and connected apps did in your studio, newest first."
      />
    </AppShell>
  );
}
