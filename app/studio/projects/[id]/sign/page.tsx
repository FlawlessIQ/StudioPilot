import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { EventSign } from "@/components/group-events/event-sign";

export const metadata: Metadata = { title: "Sign-up sign" };

/** The printable sign for a group event's sign-up: QR code, packages, how to pay. */
export default async function EventSignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell active="Jobs">
      <EventSign projectId={id} />
    </AppShell>
  );
}
