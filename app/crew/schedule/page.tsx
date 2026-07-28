import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewSchedule } from "@/components/crew/live-crew-views";

export default function CrewSchedulePage() {
  return (
    <CrewPortalShell active="Schedule">
      <LiveCrewSchedule />
    </CrewPortalShell>
  );
}
