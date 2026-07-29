import type { Metadata } from "next";
import { TemplateImportStudio } from "@/components/ai/template-import-studio";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "AI import studio",
  description:
    "Turn your studio’s existing documents, messages, forms, and pages into StudioCue templates.",
};

export default function TemplateImportPage() {
  return (
    <AppShell active="AI setup">
      <TemplateImportStudio />
    </AppShell>
  );
}
