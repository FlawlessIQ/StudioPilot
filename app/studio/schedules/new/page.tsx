import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { AiScheduleGenerator } from "@/components/planning/ai-schedule-generator";
import { TimingRuleEditor } from "@/components/planning/timing-rule-editor";

export const metadata: Metadata = { title: "Generate Schedule" };

export default function NewSchedulePage() {
  return (
    <AppShell active="Schedules">
      <div className="planning-page">
        <Link className="back-link" href="/studio/schedules"><ArrowLeft /> Back to schedules</Link>
        <header className="page-heading">
          <div>
            <p className="eyebrow">AI-assisted planning</p>
            <h1>Schedule draft</h1>
            <p>Generate a first draft, review every assumption, then save it for your team to refine.</p>
          </div>
        </header>
        <TimingRuleEditor />
        <AiScheduleGenerator />
      </div>
    </AppShell>
  );
}
