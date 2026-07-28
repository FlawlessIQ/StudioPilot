import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Communications" };
export default function MessagesPage() {
  return <AppShell active="Communications"><StudioDomainPage domain="messages" eyebrow="Client communication" title="Communications" description="Review messages sent for this studio and see whether they were delivered." /></AppShell>;
}
