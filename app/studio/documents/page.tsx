import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Documents · StudioHub" };
export default function DocumentsPage() {
  return <AppShell active="Documents"><StudioDomainPage domain="documents" eyebrow="Evidence and files" title="Documents" description="Secure project files, scan status, visibility, provider references, and immutable versions." /></AppShell>;
}
