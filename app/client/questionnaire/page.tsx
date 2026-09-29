import { ClientQuestionnaire } from "@/components/client/kit/client-questionnaire";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientQuestionnairePage() {
  return (
    <PortalShell active="Questionnaires">
      <ClientQuestionnaire />
    </PortalShell>
  );
}
