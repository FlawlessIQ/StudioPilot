import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { AiScheduleGenerator } from "@/components/planning/ai-schedule-generator";

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
          * Timing rules live inside the generator now, and only for jobs that
          * aren't weddings: a wedding's day comes from the couple's Final
          * Schedule. GR Productions (2026-10-06): "These should be deleted.
          * They don't work for every wedding."
          */}
      </div>
    </AppShell>
  );
}
