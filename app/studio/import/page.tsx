import type { Metadata } from "next";
import { BackToSetup } from "@/components/setup/back-to-setup";
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
  searchParams: Promise<{ session?: string; from?: string }>;
}) {
  const { session, from } = await searchParams;
  return (
    // The breadcrumb label comes from studioRouteLabels in the shell, not
    // from this prop — app/studio/layout.tsx mounts the shell and a
    // page-level one short-circuits. The back link is the real change
    // here: the import studio had no way out of it but the sidebar.
    <AppShell active="Library">
      <div className="template-import-shell">
        <BackToSetup fallback={{ href: "/studio/library", label: "Back to library" }} from={from} />
        <TemplateImportStudio resumeSessionId={session ?? null} />
      </div>
    </AppShell>
  );
}
