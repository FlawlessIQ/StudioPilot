import { LiveClientDocuments } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientDocumentsPage() {
  return (
    <PortalShell active="Files">
      <LiveClientDocuments />
    </PortalShell>
  );
}
