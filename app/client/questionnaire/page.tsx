import { LiveClientQuestionnaire } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientQuestionnairePage() {
  return (
    <PortalShell active="Questionnaires">
      <LiveClientQuestionnaire />
    </PortalShell>
  );
}
