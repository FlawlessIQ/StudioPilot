import type { Metadata } from "next";
import { BookingAutopilotWorkspace } from "@/components/booking/booking-autopilot-workspace";
import { ProjectBookingWorkspace } from "@/components/booking/project-booking-workspace";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = {
  title: "Booking autopilot",
  description:
    "Move from consultation notes to a reviewed package, proposal, contract, retainer, and deterministic booking gate.",
};

export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <AppShell active="Booking">
      {project ? (
        <div className="booking-autopilot-page">
          <BookingAutopilotWorkspace projectId={project} />
          <section className="booking-evidence-heading">
            <p className="eyebrow">Provider-authoritative completion</p>
            <h2>Contract, retainer, and booking gate</h2>
            <p>
              Docusign and QuickBooks evidence—not AI—control booking
              completion.
            </p>
          </section>
          <ProjectBookingWorkspace projectId={project} />
        </div>
      ) : (
        <StudioDomainPage
          description="Confirm the consultation, proposal, contract, retainer, event date, and client details before marking a project booked."
          domain="booking_gates"
          eyebrow="Booking checklist"
          title="Booking readiness"
        />
      )}
    </AppShell>
  );
}
