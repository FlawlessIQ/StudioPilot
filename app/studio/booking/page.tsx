import type { Metadata } from "next";
import { BookingAutopilotWorkspace } from "@/components/booking/booking-autopilot-workspace";
import { ProjectBookingWorkspace } from "@/components/booking/project-booking-workspace";
import { AppShell } from "@/components/layout/app-shell";
import { ProjectContextBar, StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = {
  title: "Booking",
  description:
    "Turn consultation notes into a package, a proposal, an agreement, and a paid retainer — with the studio approving each step.",
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
          <ProjectContextBar projectId={project} />
          <BookingAutopilotWorkspace projectId={project} />
          <section className="booking-evidence-heading">
            <p className="eyebrow">Agreement and payment</p>
            <h2>Getting them booked</h2>
            <p>
              A booking is only confirmed once the signature and the payment
              are real — verified with your signing and accounting tools, not
              assumed by StudioCue.
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
