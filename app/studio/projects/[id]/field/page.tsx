import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { EventFieldMode } from "@/components/group-events/event-field-mode";

export const metadata: Metadata = { title: "Field mode" };

/** A group event on the day: the QR for walk-ups, the live roster and payments. */
export default async function EventFieldPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell active="Jobs">
      <EventFieldMode backHref={`/studio/projects/${id}`} projectId={id} />
    </AppShell>
  );
}
