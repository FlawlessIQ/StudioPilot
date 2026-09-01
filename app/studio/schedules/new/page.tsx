import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { AiScheduleGenerator } from "@/components/planning/ai-schedule-generator";
import { TimingRuleEditor } from "@/components/planning/timing-rule-editor";

export const metadata: Metadata = { title: "Generate Schedule" };

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <AppShell active="Schedules">
      <div className="planning-page">
        <Link
          className="back-link"
          href={
            project
              ? `/studio/schedules?project=${encodeURIComponent(project)}`
              : "/studio/schedules"
          }
        >
          <ArrowLeft /> Back to schedules
        </Link>
        <header className="page-heading">
          <div>
            <p className="eyebrow">Run of show</p>
            <h1>Plan the day</h1>
            <p>
              Start from what you know, adjust anything, then publish it for
              your crew.
            </p>
          </div>
        </header>
        <AiScheduleGenerator initialProjectId={project} />
        {/*
          * Timing rules moved below the draft.
          *
          * This panel was the first thing on the page, so a photographer
          * opening "Plan the day" was met by an empty configuration form
          * reading "No rules yet" before anything they came for. Rules are
          * how a studio makes the *next* draft better, which is a second
          * visit, not a precondition for the first.
          */}
        <TimingRuleEditor />
      </div>
    </AppShell>
  );
}
