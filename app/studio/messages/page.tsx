import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { MessageInbox } from "@/components/communications/message-inbox";

export const metadata: Metadata = { title: "Client messages" };
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <AppShell active="Communications">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Client communication</p>
            <h1>Client messages</h1>
            <p>Every conversation with a client, in one place. Replies you send from here are recorded on the project.</p>
          </div>
        </header>
        <MessageInbox initialProjectId={project} />
      </div>
    </AppShell>
  );
}
