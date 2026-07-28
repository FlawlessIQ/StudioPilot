import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { LiveLeadDetail } from "@/components/live/tenant-records";

export const metadata: Metadata = { title: "Inquiry" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell active="Inquiries">
      <LiveLeadDetail id={id} />
    </AppShell>
  );
}
