import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewDocuments } from "@/components/crew/live-crew-views";

export default function CrewDocumentsPage() {
  return (
    <CrewPortalShell active="Documents">
      <LiveCrewDocuments />
    </CrewPortalShell>
  );
}
