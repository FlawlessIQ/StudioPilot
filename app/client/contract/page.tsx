import { LiveClientContract } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientContractPage() {
  return (
    <PortalShell active="Contract">
      <LiveClientContract />
    </PortalShell>
  );
}
