import { PortalShell } from "@/components/layout/portal-shell";
import { ClientPlan } from "@/components/client/kit/client-plan";

export default function ClientPlanPage() {
  return (
    <PortalShell active="Plan">
      <ClientPlan />
    </PortalShell>
  );
}
