import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function BookingPage() {
  return (
    <AppShell active="Booking">
      <StudioDomainPage
        domain="booking_gates"
        eyebrow="Booking checklist"
        title="Booking readiness"
        description="Confirm the contract, retainer, event date, and client details before marking a project booked."
      />
    </AppShell>
  );
}
