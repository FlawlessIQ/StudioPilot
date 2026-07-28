import { LiveClientPackage } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientPackagePage() {
  return (
    <PortalShell active="Package">
      <LiveClientPackage />
    </PortalShell>
  );
}
