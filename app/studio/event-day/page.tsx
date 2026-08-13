import type { Metadata } from "next";
import { EventDayCopilot } from "@/components/ai/event-day-copilot";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "Event Day" };

export default async function EventDayPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <AppShell active="Event day">
      <EventDayCopilot initialProjectId={project} />
    </AppShell>
  );
}
