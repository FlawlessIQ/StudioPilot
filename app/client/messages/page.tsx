import { LiveClientMessages } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientMessagesPage() {
  return (
    <PortalShell active="Messages">
      <LiveClientMessages />
    </PortalShell>
  );
}
