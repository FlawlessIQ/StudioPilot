import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { CopilotWorkspace } from "@/components/ai/copilot-workspace";

export const metadata: Metadata = { title: "Cue" };

export default function CopilotPage() {
  return (
    <AppShell active="Cue">
      <CopilotWorkspace />
    </AppShell>
  );
}
