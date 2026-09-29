import { ClientFiles } from "@/components/client/kit/client-files";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientDocumentsPage() {
  return (
    <PortalShell active="Files">
      <ClientFiles />
    </PortalShell>
  );
}
