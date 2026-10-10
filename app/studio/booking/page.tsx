import type { Metadata } from "next";
import { BookingAutopilotWorkspace } from "@/components/booking/booking-autopilot-workspace";
import { BookingEvidenceIntro } from "@/components/booking/booking-evidence-intro";
import { ProjectBookingWorkspace } from "@/components/booking/project-booking-workspace";
import { AppShell } from "@/components/layout/app-shell";
import { ProjectContextBar, StudioDomainPage } from "@/components/studio/live-domain-view";
import { BookingChecklistIntro } from "@/components/studio/page-intros";

export const metadata: Metadata = {
  title: "Booking",
  description:
    "Turn an inquiry into a package, an offer, an agreement, and a paid retainer or deposit — with the studio approving each step.",
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
            <BookingEvidenceIntro />
          </section>
          <ProjectBookingWorkspace projectId={project} />
        </div>
      ) : (
        <StudioDomainPage
          description={<BookingChecklistIntro />}
          domain="booking_gates"
          eyebrow="Booking checklist"
          title="Booking readiness"
        />
      )}
    </AppShell>
  );
}
