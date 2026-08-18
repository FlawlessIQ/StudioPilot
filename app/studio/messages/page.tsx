import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { CommunicationsCenter } from "@/components/communications/communications-center";

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
            <p>Read what clients send from their portal, and reply with a draft you approve before it sends. This is project messaging, not your email inbox.</p>
          </div>
        </header>
        <CommunicationsCenter initialProjectId={project} />
      </div>
    </AppShell>
  );
}
