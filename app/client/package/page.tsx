import { ClientPackage } from "@/components/client/kit/client-package";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientPackagePage() {
  return (
    <PortalShell active="Package">
      <ClientPackage />
    </PortalShell>
  );
}
