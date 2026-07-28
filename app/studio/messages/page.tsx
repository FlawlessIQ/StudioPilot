import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Communications · StudioHub" };
export default function MessagesPage() {
  return <AppShell active="Communications"><StudioDomainPage domain="messages" eyebrow="Delivery history" title="Communications" description="Tenant-scoped transactional messages, provider IDs, delivery state, and safe mock/live mode." /></AppShell>;
}
