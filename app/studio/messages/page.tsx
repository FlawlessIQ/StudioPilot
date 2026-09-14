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
        {/* `page-heading-echo`: on phones the top bar already says "Messages",
            so the eyebrow + title are hidden and only the one-line intro
            remains — the header stops repeating the screen name. */}
        <header className="page-heading page-heading-echo">
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
