import type { Metadata } from "next";
import { AiApprovalQueue } from "@/components/ai/ai-approval-queue";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "AI review",
  description:
    "Review sourced AI drafts, workflow approvals, and action receipts.",
};

export default function AiQueuePage() {
  return (
    <AppShell active="AI queue">
      <AiApprovalQueue />
    </AppShell>
  );
}
