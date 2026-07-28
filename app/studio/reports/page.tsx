import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { LiveReports } from "@/components/reporting/live-reports";

export const metadata: Metadata = { title: "Reports · StudioHub" };

export default function ReportsPage() {
  return (
    <AppShell active="Reports">
      <LiveReports />
    </AppShell>
  );
}
