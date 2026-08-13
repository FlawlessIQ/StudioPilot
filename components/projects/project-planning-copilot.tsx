"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarClock,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type PlanningRecord = Record<string, unknown> & { id: string };

type PreparedStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
  state: "ready" | "watching" | "complete";
  icon: typeof CalendarClock;
};

const newest = (records: PlanningRecord[]) =>
  [...records].sort((left, right) =>
    String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
      String(left.updatedAt ?? left.createdAt ?? ""),
    ),
  )[0];

export function ProjectPlanningCopilot({
  projectId,
  questionnaires,
  schedules,
  insurance,
  invoices,
}: {
  projectId: string;
  questionnaires: PlanningRecord[];
  schedules: PlanningRecord[];
  insurance: PlanningRecord[];
  invoices: PlanningRecord[];
}) {
  const questionnaire = newest(
    questionnaires.filter((item) =>
      ["submitted", "locked"].includes(String(item.status)),
    ),
  );
  const schedule = newest(schedules);
  const coi = newest(insurance);
  const finalInvoice = newest(
    invoices.filter((item) => String(item.kind) === "final"),
  );
  const questionnaireChanged = Boolean(
    questionnaire &&
      schedule &&
      String(questionnaire.updatedAt ?? questionnaire.submittedAt ?? "") >
        String(schedule.updatedAt ?? schedule.createdAt ?? ""),
  );

  const steps: PreparedStep[] = [
    !questionnaire
      ? {
          id: "questionnaire",
          label: "Collect the planning details",
          detail:
            "StudioCue will use the submitted answers to prepare the run of show.",
          href: `/studio/questionnaires?project=${projectId}`,
          state: "watching",
          icon: CheckCircle2,
        }
      : !schedule || questionnaireChanged
        ? {
            id: "schedule",
            label: schedule
              ? "Prepare the schedule update"
              : "Prepare the first run of show",
            detail: questionnaireChanged
              ? "New questionnaire details arrived after the current schedule. Review an updated AI draft and its impact."
              : "Verified project, package, questionnaire, timing, and crew facts are ready for an AI draft.",
            href: `/studio/schedules/new?project=${projectId}`,
            state: "ready",
            icon: CalendarClock,
          }
        : {
            id: "schedule",
            label: "Run of show is being watched",
            detail:
              "StudioCue will flag new questionnaire facts and show the impact before another version is published.",
            href: `/studio/schedules/${schedule.id}`,
            state: "complete",
            icon: CalendarClock,
          },
    !coi
      ? {
          id: "coi",
          label: "Prepare venue insurance",
          detail:
            "Create the request once; StudioCue will chase receipt, extract the certificate, and pause for approval.",
          href: `/studio/insurance?project=${projectId}`,
          state: "ready",
          icon: ShieldCheck,
        }
      : {
          id: "coi",
          label:
            String(coi.status) === "approved"
              ? "COI ready for venue delivery"
              : String(coi.status) === "correction_required"
                ? "COI correction needs approval"
                : "COI follow-up is automated",
          detail:
            String(coi.status) === "approved"
              ? "One human approval remains before the authoritative PDF is sent."
              : "Receipt, extraction, discrepancies, and follow-up stay attached to this project.",
          href: `/studio/insurance?project=${projectId}`,
          state: String(coi.status) === "approved" ? "ready" : "watching",
          icon: ShieldCheck,
        },
    finalInvoice
      ? {
          id: "invoice",
          label:
            String(finalInvoice.status) === "review_required"
              ? "Review the prepared final balance"
              : "Final invoice is prepared",
          detail:
            "The calculation cites the package and retainer evidence; QuickBooks remains the source of truth.",
          href: `/studio/invoices?project=${projectId}`,
          state:
            String(finalInvoice.status) === "review_required"
              ? "ready"
              : "complete",
          icon: BadgeDollarSign,
        }
      : {
          id: "invoice",
          label: "Final invoice timing is monitored",
          detail:
            "StudioCue prepares the balance 28 days before the event and pauses for review before sending.",
          href: `/studio/invoices?project=${projectId}`,
          state: "watching",
          icon: BadgeDollarSign,
        },
  ];

  return (
    <section className="panel project-planning-copilot">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">Proactive planning</p>
          <h2>StudioCue is preparing what comes next</h2>
          <p>
            Automation keeps watch across planning; you approve the decisions
            that affect schedules, insurance, and money.
          </p>
        </div>
        <Sparkles aria-hidden="true" />
      </header>
      <div className="project-planning-copilot-list">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <Link className={`is-${step.state}`} href={step.href} key={step.id}>
              <span className="project-planning-copilot-icon">
                <Icon size={17} />
              </span>
              <span>
                <small>
                  {step.state === "ready"
                    ? "Ready for approval"
                    : step.state === "complete"
                      ? "Up to date"
                      : "Watching automatically"}
                </small>
                <strong>{step.label}</strong>
                <em>{step.detail}</em>
              </span>
              <ArrowRight size={16} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
