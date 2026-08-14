import type { Metadata } from "next";
import { TemplateImportStudio } from "@/components/ai/template-import-studio";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "AI import studio",
  description:
    "Turn your studio’s existing documents, messages, forms, and pages into StudioCue templates.",
};

export default async function TemplateImportPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  return (
    <AppShell active="AI setup">
      <TemplateImportStudio resumeSessionId={session ?? null} />
    </AppShell>
  );
}
