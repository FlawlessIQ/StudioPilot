import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { MessageInbox } from "@/components/communications/message-inbox";
import { CrewMessageInbox } from "@/components/communications/crew-message-inbox";

export const metadata: Metadata = { title: "Messages" };
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; view?: string; assignment?: string }>;
}) {
  const { project, view, assignment } = await searchParams;
  // Crew write to the studio from their jobs; those threads were readable
  // only on each assignment page (GR, 2026-10-09).
  const crew = view === "crew" || Boolean(assignment);
  return (
    <AppShell active="Communications">
      <div className="live-domain-page">
        {/* `page-heading-echo`: on phones the top bar already says "Messages",
            so the eyebrow + title are hidden and only the one-line intro
            remains — the header stops repeating the screen name. */}
        <header className="page-heading page-heading-echo page-heading-compact">
          <div>
            <p className="eyebrow">{crew ? "Crew communication" : "Client communication"}</p>
            <h1>{crew ? "Crew messages" : "Client messages"}</h1>
            <p>
              {crew
                ? "What your crew sent from their jobs. Replies go to them by email and on their job."
                : "Every conversation with a client, in one place. Replies you send from here are recorded on the project."}
            </p>
          </div>
        </header>
        <div className="crm-tabs">
          <Link className={crew ? "" : "active"} href="/studio/messages">
            Clients
          </Link>
          <Link className={crew ? "active" : ""} href="/studio/messages?view=crew">
            Crew
          </Link>
        </div>
        {crew ? <CrewMessageInbox initialAssignmentId={assignment} /> : <MessageInbox initialProjectId={project} />}
      </div>
    </AppShell>
  );
}
