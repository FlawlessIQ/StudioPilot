import type { Metadata } from "next";
import { EventDayCopilot } from "@/components/ai/event-day-copilot";
import { AppShell } from "@/components/layout/app-shell";
import { ProjectContextBar } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Event Day" };

export default async function EventDayPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <AppShell active="Event day">
      {project ? <ProjectContextBar projectId={project} /> : null}
      <EventDayCopilot initialProjectId={project} />
    </AppShell>
  );
}
