import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewRequirements } from "@/components/crew/live-crew-views";

export default function CrewRequirementsPage() {
  return (
    <CrewPortalShell active="Requirements">
      <LiveCrewRequirements />
    </CrewPortalShell>
  );
}
