import { PortalShell } from "@/components/layout/portal-shell";
import { ClientVendorTeam } from "@/components/client/kit/client-vendor-team";

export default function ClientVendorTeamPage() {
  return (
    <PortalShell active="Plan">
      <ClientVendorTeam />
    </PortalShell>
  );
}
