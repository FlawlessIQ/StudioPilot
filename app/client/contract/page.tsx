import { ClientContract } from "@/components/client/kit/client-contract";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientContractPage() {
  return (
    <PortalShell active="Contract">
      <ClientContract />
    </PortalShell>
  );
}
