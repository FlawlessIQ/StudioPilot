import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewAvailability } from "@/components/crew/live-crew-views";

export default function CrewAvailabilityPage() {
  return (
    <CrewPortalShell active="Availability">
      <LiveCrewAvailability />
    </CrewPortalShell>
  );
}
