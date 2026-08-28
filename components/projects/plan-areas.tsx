"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  Clock3,
  FileStack,
  Radio,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useProjectJourney } from "@/components/projects/use-project-journey";
import { useTenantDocuments } from "@/components/live/tenant-records";
import type { JourneyStepKey } from "@/features/journey/steps";

/**
 * The planning areas, with what each one currently needs.
 *
 * This page used to be six link cards of identical weight: a menu of menus
 * that knew nothing about the job it belonged to. A photographer twenty-three
 * days from a wedding had no way to tell from it that crew was the thing
 * waiting on them. The journey engine already knows — the cards just never
 * asked it.
 */

const AREAS: Array<{
  label: string;
  detail: string;
  route: string;
  icon: typeof ClipboardList;
  /** Journey steps this area is responsible for. */
  steps: JourneyStepKey[];
}> = [
  {
    label: "Client details",
    detail: "What the couple told you, and what is still missing.",
    route: "questionnaires",
    icon: ClipboardList,
    steps: ["schedule_form"],
  },
  {
    label: "Timeline",
    detail: "Draft, review and publish the run of show.",
    route: "schedules",
    icon: CalendarClock,
    steps: ["run_of_show"],
  },
  {
    label: "Crew",
    detail: "Offer roles and track who has said yes.",
    route: "crew",
    icon: UsersRound,
    steps: ["crew"],
  },
  {
    label: "Venue & insurance",
    detail: "The certificate the venue asks for, and its evidence.",
    route: "insurance",
    icon: ShieldCheck,
    steps: ["coi"],
  },
  {
    label: "Project files",
    detail: "Schedules, documents and deliverables in one place.",
    route: "documents",
    icon: FileStack,
    steps: [],
  },
  {
    label: "Event day",
    detail: "The live brief, for the morning of.",
    route: "event-day",
    icon: Radio,
    steps: ["day_before", "event_day"],
  },
];

export function PlanAreas({ projectId }: { projectId: string }) {
  const projects = useTenantDocuments("projects");
  const project = (projects.records ?? []).find((row) => row.id === projectId);
  const { steps, current } = useProjectJourney({
    projectId,
    projectState: String(project?.state ?? ""),
    eventDate:
      typeof project?.eventDate === "string" ? project.eventDate : null,
    leadId: typeof project?.leadId === "string" ? project.leadId : null,
  });

  const statusOf = (keys: JourneyStepKey[]) => {
    if (!keys.length) return null;
    const mine = steps.filter((step) => keys.includes(step.key));
    if (!mine.length) return null;
    if (mine.some((step) => step.key === current?.key)) return "now" as const;
    if (mine.every((step) => step.status === "complete")) return "done" as const;
    if (mine.some((step) => step.status === "waiting_client"))
      return "waiting" as const;
    // An offer out with a crew member is "with them", not silence. This card
    // marked Crew as Done off one acceptance while the job's own reference
    // panel listed an unanswered offer on the same page.
    if (mine.some((step) => step.status === "waiting_other"))
      return "out" as const;
    // The event overtook these. Saying nothing left the card looking untouched.
    if (mine.every((step) => step.status === "passed")) return "past" as const;
    return null;
  };
  // Once the day is behind them, "for the morning of" is the wrong tense.
  const eventBehindThem = steps.some(
    (step) => step.key === "event_day" && step.status !== "upcoming",
  );

  return (
    <section className="project-plan-grid" aria-label="Planning areas">
      {AREAS.map((area) => {
        const Icon = area.icon;
        const status = statusOf(area.steps);
        return (
          <Link
            className={status ? `is-${status}` : undefined}
            href={`/studio/${area.route}?project=${projectId}`}
            key={area.label}
          >
            <span>
              <Icon size={19} />
            </span>
            <div>
              <strong>{area.label}</strong>
              <small>
                {area.label === "Event day" && eventBehindThem
                  ? "The brief as it stood on the day."
                  : area.detail}
              </small>
            </div>
            {status === "now" ? (
              <em className="plan-area-flag is-now">Needs you</em>
            ) : status === "waiting" ? (
              <em className="plan-area-flag is-waiting">
                <Clock3 size={11} /> With the client
              </em>
            ) : status === "out" ? (
              <em className="plan-area-flag is-waiting">
                <Clock3 size={11} /> Waiting on them
              </em>
            ) : status === "done" ? (
              <em className="plan-area-flag is-done">
                <Check size={12} /> Done
              </em>
            ) : status === "past" ? (
              <em className="plan-area-flag is-past">The day has passed</em>
            ) : (
              <ArrowRight size={15} />
            )}
          </Link>
        );
      })}
    </section>
  );
}
