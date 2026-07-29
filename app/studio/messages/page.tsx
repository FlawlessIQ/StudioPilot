import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { CommunicationsCenter } from "@/components/communications/communications-center";

export const metadata: Metadata = { title: "Communications" };
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
            <h1>Communications</h1>
            <p>Write, approve, schedule, and trace branded project email from one place.</p>
          </div>
        </header>
        <CommunicationsCenter initialProjectId={project} />
      </div>
    </AppShell>
  );
}
