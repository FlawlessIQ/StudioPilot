import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewAccount } from "@/components/crew/live-crew-views";

export default function CrewAccountPage() {
  return <CrewPortalShell active="Account"><LiveCrewAccount /></CrewPortalShell>;
}
