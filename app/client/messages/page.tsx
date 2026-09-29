import { ClientMessages } from "@/components/client/kit/client-messages";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientMessagesPage() {
  return (
    <PortalShell active="Messages">
      <ClientMessages />
    </PortalShell>
  );
}
