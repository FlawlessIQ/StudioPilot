import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Documents" };
export default function DocumentsPage() {
  return <AppShell active="Documents"><StudioDomainPage domain="documents" eyebrow="Project files" title="Documents" description="Find contracts, schedules, insurance certificates, briefs, and other project documents." /></AppShell>;
}
