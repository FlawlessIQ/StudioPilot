import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { ReleaseEvidenceReport } from "@/components/reporting/release-evidence-report";

export const metadata: Metadata = { title: "Release evidence" };

export default function ReleaseEvidencePage() {
  return (
    <AppShell active="Reports">
      <ReleaseEvidenceReport />
    </AppShell>
  );
}
