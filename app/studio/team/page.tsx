import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { TeamManagement } from "@/components/team/team-management";
import { PeopleSectionNav } from "@/components/layout/people-section-nav";

export const metadata: Metadata = {
  title: "Team",
  description: "Invite your team and control what each person can see and change.",
};

export default function TeamPage() {
  return (
    <AppShell active="Team">
      <div className="saas-page">
        {/* The top bar already says "Team"; hide this hero on phones. */}
        <header className="page-heading page-heading-echo">
          <div>
            <p className="eyebrow">People & permissions</p>
            <h1>Team</h1>
            <p>
              Invite the people who work with you, and choose what each can
              see and do.
            </p>
          </div>
        </header>
        <PeopleSectionNav />
        <TeamManagement />
      </div>
    </AppShell>
  );
}
