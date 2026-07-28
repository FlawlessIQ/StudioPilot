import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewHome } from "@/components/crew/live-crew-views";

export default function CrewPortalPage() {
  return (
    <CrewPortalShell>
      <LiveCrewHome />
    </CrewPortalShell>
  );
}
