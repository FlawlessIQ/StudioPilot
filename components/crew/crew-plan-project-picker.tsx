"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Users } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  describeEventProximity,
  eventDateHasPassed,
  formatEventDate,
} from "@/lib/format/event-date";

/**
 * The way into a job's crew plan.
 *
 * Offering someone work happens in `CrewCascadeWorkspace`, which this page
 * renders only when a `?project=` is present. Nothing linked here with one
 * set, so the whole staffing workspace was unreachable: "Add crew member"
 * made a directory entry, the confirmation said to open the job's crew
 * plan, and there was no way to open one. This is that way.
 */
export function CrewPlanProjectPicker() {
  const { records, loading } = useTenantDocuments("projects");
  // Staffing is forward-looking: a wedding that has happened cannot be
  // crewed, and a dead job should not be offered as a destination.
  const staffable = (records ?? [])
    .filter((project) => {
      const state = String(project.state ?? "");
      if (["CANCELLED", "ARCHIVED", "POSTPONED"].includes(state)) return false;
      return !eventDateHasPassed(project.eventDate);
    })
    .sort((a, b) =>
      String(a.eventDate ?? "").localeCompare(String(b.eventDate ?? "")),
    );

  return (
    <section className="panel crew-plan-picker">
      <header>
        <Users aria-hidden="true" />
        <div>
          <strong>Staff a job</strong>
          <p>
            Crew are offered work per job, not per person. Pick the one you are
            staffing and StudioCue will rank who to ask.
          </p>
        </div>
      </header>
      {loading ? (
        <p className="crew-plan-picker-empty">Loading your jobs…</p>
      ) : staffable.length ? (
        <ul className="crew-plan-picker-list">
          {staffable.map((project) => {
            const proximity = describeEventProximity(project.eventDate);
            return (
              <li key={project.id}>
                <Link href={`/studio/crew?project=${project.id}`}>
                  <span>
                    <strong>{String(project.name ?? "Untitled job")}</strong>
                    {project.eventDate ? (
                      <small>
                        <CalendarDays aria-hidden="true" size={12} />
                        {formatEventDate(project.eventDate)}
                        {proximity ? ` · ${proximity}` : ""}
                      </small>
                    ) : (
                      <small>No date set</small>
                    )}
                  </span>
                  <ArrowRight aria-hidden="true" size={15} />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="crew-plan-picker-empty">
          No upcoming jobs to staff. Book a job first and its crew plan will
          appear here.
        </p>
      )}
    </section>
  );
}
