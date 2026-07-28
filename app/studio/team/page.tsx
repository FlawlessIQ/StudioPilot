import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { TeamManagement } from "@/components/team/team-management";

export const metadata: Metadata = {
  title: "Team",
  description: "Invite your team and control what each person can see and change.",
};

export default function TeamPage() {
  return (
    <AppShell active="Team">
      <div className="saas-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">People & permissions</p>
            <h1>Team</h1>
            <p>
              Invite staff, assign least-privilege roles, and revoke access
              without sharing tenant credentials.
            </p>
          </div>
          <UsersRound />
        </header>
        <TeamManagement />
      </div>
    </AppShell>
  );
}
