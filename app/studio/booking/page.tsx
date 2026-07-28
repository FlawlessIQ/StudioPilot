import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function BookingPage() {
  return (
    <AppShell active="Booking">
      <StudioDomainPage
        domain="booking_gates"
        eyebrow="Deterministic gate"
        title="Booking readiness"
        description="Contract, retainer, availability, and contact evidence must pass exactly once."
      />
    </AppShell>
  );
}
