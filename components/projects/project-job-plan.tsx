"use client";

import { Check, ChevronRight, UserRound } from "lucide-react";
import Link from "next/link";
import { groupJourneyByPhase } from "@/features/journey/phases";
import type { JourneyStep } from "@/features/journey/steps";
import { ProjectPreparedTray } from "@/components/projects/project-prepared-tray";

// One list for "what's next on this job". The journey is the spine — every
// checkpoint already carries a status, an owner, and (when actionable) a link.
// The old page showed the same information three times: the prepared AI queue,
// "everything outstanding, by who owes it", and this journey map. This folds
// them into a single prioritized list: prepared decisions first, then the
// journey with open steps made tappable and tagged by who owes them.

const OPEN: JourneyStep["status"][] = [
  "current",
  "waiting_client",
  "waiting_other",
  "upcoming",
];

function stepHref(step: JourneyStep): string | null {
  if (step.action?.kind === "link") return step.action.href;
  // Draft actions are handled by the job thread's composer, not a navigation;
  // fall back to the record so the row still opens something useful.
  return step.record?.href ?? null;
}

// Who the row is waiting on — the "by who owes it" dimension the outstanding
// lanes used to carry, now inline on each open step.
function ownerChip(step: JourneyStep): string | null {
  if (!OPEN.includes(step.status)) return null;
  if (step.status === "waiting_client") return "Client";
  if (step.status === "waiting_other")
    return step.owner === "provider" ? "Crew" : "Waiting";
  switch (step.owner) {
    case "client":
      return "Client";
    case "provider":
      return "Crew";
    case "studio":
      return "You";
    default:
      return null;
  }
}

function StepRow({ step }: { step: JourneyStep }) {
  const open = OPEN.includes(step.status);
  const href = open ? stepHref(step) : step.record?.href ?? null;
  const chip = ownerChip(step);
  const showDetail = step.status === "current" || step.explain;
  // The chevron marks the rows that are work to do; completed steps still link
  // to their evidence but stay quiet — the original journey the studio liked
  // had no chevrons at all.
  const showChevron = open && href != null;
  const inner = (
    <>
      <span className="job-plan-mark" aria-hidden="true">
        {step.status === "complete" ? (
          <Check size={12} />
        ) : step.status === "waiting_client" ? (
          <UserRound size={11} />
        ) : null}
      </span>
      <span className="job-plan-step-body">
        <span className="job-plan-step-title">{step.title}</span>
        {showDetail ? <small>{step.detail}</small> : null}
      </span>
      {chip ? <span className="job-plan-owner">{chip}</span> : null}
      {showChevron ? (
        <ChevronRight size={16} className="job-plan-step-chevron" />
      ) : null}
    </>
  );
  if (href) {
    return (
      <li className={`job-plan-step is-${step.status} is-link`}>
        <Link href={href}>{inner}</Link>
      </li>
    );
  }
  return <li className={`job-plan-step is-${step.status}`}>{inner}</li>;
}

export function ProjectJobPlan({
  steps,
  projectId,
}: {
  steps: JourneyStep[];
  projectId: string;
}) {
  const complete = steps.filter((step) => step.status === "complete").length;
  const missed = steps.filter((step) => step.status === "passed").length;
  const groups = groupJourneyByPhase(steps);

  return (
    <section className="project-job-plan" id="project-checkpoints">
      {/* Prepared decisions lead — they are the "do these now" items. Compact
          on phones, each opening its full card in a bottom sheet. */}
      <ProjectPreparedTray projectId={projectId} />

      <div className="job-plan-journey">
        <div className="job-plan-head">
          <p className="eyebrow">The plan</p>
          <span>
            {complete}/{steps.length}
            {missed ? <em> · {missed} missed</em> : null}
          </span>
        </div>
        {groups.map((group) => (
          <section
            className={`job-plan-phase${group.active ? " is-active" : ""}`}
            key={group.phase}
          >
            <p className="job-plan-phase-label">
              {group.label}
              <em>
                {group.complete}/{group.steps.length}
                {group.missed ? (
                  <span className="job-plan-missed"> · {group.missed} missed</span>
                ) : null}
              </em>
            </p>
            <ol>
              {group.steps.map((step) => (
                <StepRow key={step.key} step={step} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
