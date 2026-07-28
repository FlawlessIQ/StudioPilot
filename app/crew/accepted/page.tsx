import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewAccepted } from "@/components/crew/live-crew-views";

export default function AcceptedJobsPage() {
  return (
    <CrewPortalShell active="Accepted jobs">
      <LiveCrewAccepted />
    </CrewPortalShell>
  );
}
