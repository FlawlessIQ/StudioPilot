import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { LiveProjectDetail } from "@/components/projects/live-project-detail";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell active="Projects">
      <LiveProjectDetail projectId={id} />
    </AppShell>
  );
}
