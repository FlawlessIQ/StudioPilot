import type { Metadata } from "next";
import { AiApprovalQueue } from "@/components/ai/ai-approval-queue";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Waiting on you",
  description:
    "Everything Cue prepared that is waiting on your approval, with its sources and receipts.",
};

export default function AiQueuePage() {
  return (
    <AppShell active="Waiting on you">
      <AiApprovalQueue />
    </AppShell>
  );
}
