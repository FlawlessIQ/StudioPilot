import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { CopilotWorkspace } from "@/components/ai/copilot-workspace";

export const metadata: Metadata = { title: "Event Copilot · StudioHub" };

export default function CopilotPage() {
  return (
    <AppShell>
      <CopilotWorkspace />
    </AppShell>
  );
}
