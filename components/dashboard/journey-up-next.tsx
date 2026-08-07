"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles, UserRound } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  projectJourney,
  type JourneyStep,
} from "@/features/journey/steps";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const EXCLUDED_STATES = new Set([
  "CLOSED",
  "CANCELLED",
  "ARCHIVED",
  "POSTPONED",
]);

/**
 * Up next — the whole studio as one short list of next actions.
 *
 * Each active project contributes its single current journey step. The
 * photographer works top to bottom; waiting-on-client projects say so instead
 * of asking for attention.
 */
export function JourneyUpNext() {
  const projects = useTenantDocuments("projects");
  const leads = useTenantDocuments("leads");
  const consultations = useTenantDocuments("consultations");
  const proposals = useTenantDocuments("proposals");
  const contracts = useTenantDocuments("contracts");
  const invoices = useTenantDocuments("invoiceReferences");
  const questionnaires = useTenantDocuments("questionnaireResponses");
  const schedules = useTenantDocuments("schedules");
  const crewAssignments = useTenantDocuments("crewAssignments");
  const crewCascades = useTenantDocuments("crewCascades");
  const insuranceRequests = useTenantDocuments("insuranceRequests");
  const deliveries = useTenantDocuments("deliveryRecords");
  const aiActions = useTenantDocuments("aiActions");

  const today = new Date().toISOString().slice(0, 10);
  const active = (projects.records ?? [])
    .filter((project) => !EXCLUDED_STATES.has(text(project.state)))
    .sort((left, right) =>
      text(left.eventDate).localeCompare(text(right.eventDate)),
    );

  const rows = active
    .map((project) => {
      const projectId = project.id;
      const forProject = <T extends Record<string, unknown> & { id: string }>(
        records: T[] | null,
      ) => (records ?? []).filter((item) => item.projectId === projectId);
      const lead =
        (leads.records ?? []).find(
          (item) => item.id === project.leadId || item.projectId === projectId,
        ) ?? null;
      const latestSchedule = forProject(schedules.records).sort(
        (left, right) => Number(right.version ?? 0) - Number(left.version ?? 0),
      )[0];
      const projectInvoices = forProject(invoices.records);
      const journey = projectJourney({
        projectId,
        state: text(project.state),
        eventDate: text(project.eventDate) || null,
        today,
        lead: lead
          ? { id: lead.id, status: text(lead.status) || "new" }
          : null,
        hasConsultation: forProject(consultations.records).length > 0,
        proposalStatus: text(forProject(proposals.records)[0]?.status) || null,
        contractStatus: text(forProject(contracts.records)[0]?.status) || null,
        retainerInvoiceStatus:
          text(
            projectInvoices.find((invoice) => invoice.kind === "retainer")
              ?.status,
          ) || null,
        finalInvoiceStatus:
          text(
            projectInvoices.find((invoice) => invoice.kind === "final")?.status,
          ) || null,
        questionnaireStatus:
          text(forProject(questionnaires.records)[0]?.status) || null,
        scheduleStatus: text(latestSchedule?.status) || null,
        crewAccepted: forProject(crewAssignments.records).filter(
          (assignment) => assignment.status === "accepted",
        ).length,
        crewCascadeActive: forProject(crewCascades.records).some(
          (cascade) => cascade.status === "active",
        ),
        coiStatus: text(forProject(insuranceRequests.records)[0]?.status) || null,
        dayBeforeDraftStatus:
          text(
            forProject(aiActions.records).find(
              (action) =>
                text(record(action.structuredOutput).trigger) ===
                "day_before_checklist",
            )?.status,
          ) || null,
        hasDelivery: forProject(deliveries.records).length > 0,
        albumOrReviewDone: ["REVIEW_REQUESTED", "CLOSED"].includes(
          text(project.state),
        ),
      });
      const waiting = journey.steps.find(
        (step) => step.status === "waiting_client",
      );
      return {
        projectId,
        name: text(project.name) || "Project",
        eventDate: text(project.eventDate),
        current: journey.current,
        waiting,
      };
    })
    .filter((row) => row.current || row.waiting)
    .slice(0, 6);

  if (projects.loading) {
    return (
      <div className="live-record-state">
        <Sparkles size={18} />
        <span>
          <strong>Lining up your next steps…</strong>
        </span>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="live-record-state">
        <CheckCircle2 size={18} />
        <span>
          <strong>Nothing needs you right now</strong>
          <small>New steps appear here the moment they&apos;re ready.</small>
        </span>
      </div>
    );
  }

  return (
    <div className="journey-up-next">
      {rows.map((row) => (
        <UpNextRow key={row.projectId} row={row} />
      ))}
    </div>
  );
}

function UpNextRow({
  row,
}: {
  row: {
    projectId: string;
    name: string;
    eventDate: string;
    current: JourneyStep | null;
    waiting: JourneyStep | undefined;
  };
}) {
  const step = row.current ?? row.waiting;
  if (!step) return null;
  const isWaiting = !row.current;
  const href =
    !isWaiting && step.action?.kind === "link"
      ? step.action.href
      : `/studio/projects/${row.projectId}`;
  return (
    <Link className="journey-up-next-row" href={href}>
      <span
        className={
          isWaiting ? "journey-up-next-icon is-waiting" : "journey-up-next-icon"
        }
      >
        {isWaiting ? <UserRound size={16} /> : <Sparkles size={16} />}
      </span>
      <span className="journey-up-next-copy">
        <small>
          {row.name}
          {row.eventDate ? ` · ${row.eventDate}` : ""}
        </small>
        <strong>
          {isWaiting
            ? `Waiting on the client — ${step.title.toLowerCase()}`
            : (step.action?.label ?? step.title)}
        </strong>
      </span>
      <ArrowRight size={15} />
    </Link>
  );
}
