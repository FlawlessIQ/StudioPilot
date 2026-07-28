import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewProfile } from "@/components/crew/live-crew-views";

export default function CrewProfilePage() {
  return (
    <CrewPortalShell active="Profile">
      <LiveCrewProfile />
    </CrewPortalShell>
  );
}
