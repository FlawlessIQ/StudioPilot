import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { AiScheduleGenerator } from "@/components/planning/ai-schedule-generator";

export const metadata: Metadata = { title: "Generate Schedule · StudioHub" };

export default function NewSchedulePage() {
  return (
    <AppShell active="Schedules">
      <div className="planning-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">AI-assisted planning</p>
            <h1>Schedule draft</h1>
            <p>Generate, inspect, edit, and deliberately publish a structured run of show.</p>
          </div>
        </header>
        <AiScheduleGenerator />
      </div>
    </AppShell>
  );
}
