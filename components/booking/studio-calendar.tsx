"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";

type CalendarItem = {
  id: string;
  date: Date;
  label: string;
  kind: "project" | "consultation";
};

function safeDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = value.includes("T") ? new Date(value) : parseISO(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  } catch {
    return null;
  }
}

export function StudioCalendar() {
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const { records: projects, loading: projectsLoading } =
    useTenantDocuments("projects");
  const { records: consultations, loading: consultationsLoading } =
    useTenantDocuments("consultations");
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  );
  const items = useMemo<CalendarItem[]>(() => {
    const projectItems = (projects ?? []).flatMap((project) => {
      const date = safeDate(project.eventDate);
      return date
        ? [{
            id: `project-${project.id}`,
            date,
            label: String(project.name ?? "Project"),
            kind: "project" as const,
          }]
        : [];
    });
    const consultationItems = (consultations ?? []).flatMap((consultation) => {
      const date = safeDate(consultation.startsAt);
      return date
        ? [{
            id: `consultation-${consultation.id}`,
            date,
            label: String(consultation.projectName ?? "Consultation"),
            kind: "consultation" as const,
          }]
        : [];
    });
    return [...projectItems, ...consultationItems];
  }, [consultations, projects]);

  return (
    <section className="studio-calendar panel" aria-label="Studio calendar">
      <header>
        <div>
          <p className="eyebrow">Studio calendar</p>
          <h2>{format(month, "MMMM yyyy")}</h2>
        </div>
        <div>
          <button aria-label="Previous month" onClick={() => setMonth((value) => subMonths(value, 1))} type="button"><ChevronLeft size={17} /></button>
          <button onClick={() => setMonth(startOfMonth(new Date()))} type="button">Today</button>
          <button aria-label="Next month" onClick={() => setMonth((value) => addMonths(value, 1))} type="button"><ChevronRight size={17} /></button>
        </div>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid">
        {days.map((day) => {
          const dayItems = items.filter((item) => isSameDay(item.date, day));
          return (
            <article className={!isSameMonth(day, month) ? "outside-month" : ""} key={day.toISOString()}>
              <time dateTime={format(day, "yyyy-MM-dd")}>{format(day, "d")}</time>
              {dayItems.slice(0, 3).map((item) => (
                <span className={item.kind} key={item.id}>{item.label}</span>
              ))}
              {dayItems.length > 3 ? <small>+{dayItems.length - 3} more</small> : null}
            </article>
          );
        })}
      </div>
      {projectsLoading || consultationsLoading ? <p className="calendar-loading">Loading studio dates…</p> : null}
    </section>
  );
}
