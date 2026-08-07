"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  LoaderCircle,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  projectJourney,
  type JourneyAction,
  type JourneyStep,
} from "@/features/journey/steps";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The Journey — the project page as the photographer's own mental model.
 *
 * One vertical thread from inquiry to review. Every step reads its state from
 * real records; exactly one step carries the next action, inline. No tabs to
 * hunt through, no operations vocabulary.
 */
export function ProjectJourney({
  projectId,
  projectState,
  eventDate,
  leadId,
}: {
  projectId: string;
  projectState: string;
  eventDate: string | null;
  leadId: string | null;
}) {
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

  const forProject = (records: Array<Record<string, unknown> & { id: string }> | null) =>
    (records ?? []).filter((item) => item.projectId === projectId);

  const lead =
    (leads.records ?? []).find(
      (item) => item.id === leadId || item.projectId === projectId,
    ) ?? null;
  const latestSchedule = forProject(schedules.records).sort(
    (left, right) => Number(right.version ?? 0) - Number(left.version ?? 0),
  )[0];
  const projectInvoices = forProject(invoices.records);
  const retainerInvoice = projectInvoices.find(
    (invoice) => invoice.kind === "retainer",
  );
  const finalInvoice = projectInvoices.find(
    (invoice) => invoice.kind === "final",
  );
  const dayBeforeAction = forProject(aiActions.records).find(
    (action) =>
      text(record(action.structuredOutput).trigger) === "day_before_checklist",
  );
  const coi = forProject(insuranceRequests.records).sort((left, right) =>
    text(right.createdAt).localeCompare(text(left.createdAt)),
  )[0];

  const { steps, current } = projectJourney({
    projectId,
    state: projectState,
    eventDate,
    today: new Date().toISOString().slice(0, 10),
    lead: lead ? { id: lead.id, status: text(lead.status) || "new" } : null,
    hasConsultation: forProject(consultations.records).length > 0,
    proposalStatus:
      text(
        forProject(proposals.records).sort((left, right) =>
          text(right.createdAt).localeCompare(text(left.createdAt)),
        )[0]?.status,
      ) || null,
    contractStatus:
      text(
        forProject(contracts.records).sort((left, right) =>
          text(right.createdAt).localeCompare(text(left.createdAt)),
        )[0]?.status,
      ) || null,
    retainerInvoiceStatus: text(retainerInvoice?.status) || null,
    finalInvoiceStatus: text(finalInvoice?.status) || null,
    questionnaireStatus:
      text(forProject(questionnaires.records)[0]?.status) || null,
    scheduleStatus: text(latestSchedule?.status) || null,
    crewAccepted: forProject(crewAssignments.records).filter(
      (assignment) => assignment.status === "accepted",
    ).length,
    crewCascadeActive: forProject(crewCascades.records).some(
      (cascade) => cascade.status === "active",
    ),
    coiStatus: text(coi?.status) || null,
    dayBeforeDraftStatus: text(dayBeforeAction?.status) || null,
    hasDelivery: forProject(deliveries.records).length > 0,
    albumOrReviewDone: ["REVIEW_REQUESTED", "CLOSED"].includes(projectState),
  });

  const complete = steps.filter((step) => step.status === "complete").length;

  return (
    <section className="panel project-journey" aria-label="Project journey">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">The journey</p>
          <h2>
            {current ? current.title : "Everything is handled"}
          </h2>
          <p>
            {current
              ? "Your one next step — everything else is done, waiting, or not due yet."
              : "No studio action needed right now."}
          </p>
        </div>
        <span className="project-journey-progress">
          {complete}/{steps.length}
        </span>
      </div>
      <ol className="project-journey-steps">
        {steps.map((step) => (
          <JourneyStepRow key={step.key} projectId={projectId} step={step} />
        ))}
      </ol>
    </section>
  );
}

function JourneyStepRow({
  projectId,
  step,
}: {
  projectId: string;
  step: JourneyStep;
}) {
  return (
    <li className={`journey-step is-${step.status}`}>
      <span className="journey-step-marker" aria-hidden="true">
        {step.status === "complete" ? (
          <CheckCircle2 size={17} />
        ) : step.status === "waiting_client" ? (
          <UserRound size={15} />
        ) : (
          <Circle size={15} />
        )}
      </span>
      <span className="journey-step-copy">
        <strong>{step.title}</strong>
        <small>
          {step.status === "waiting_client"
            ? `Waiting on the client · ${step.detail}`
            : step.status === "waiting_other"
              ? `In motion · ${step.detail}`
              : step.detail}
        </small>
      </span>
      {step.status === "current" && step.action ? (
        <JourneyActionButton action={step.action} projectId={projectId} />
      ) : null}
    </li>
  );
}

function JourneyActionButton({
  action,
  projectId,
}: {
  action: JourneyAction;
  projectId: string;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (action.kind === "link") {
    return (
      <Link className="journey-step-action" href={action.href}>
        {action.label} <ArrowRight size={14} />
      </Link>
    );
  }

  async function draft() {
    if (action.kind !== "draft" || !workspace.tenantId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await requestMessageDraft({
        tenantId: workspace.tenantId,
        trigger: action.trigger,
        projectId,
      });
      setDone(true);
      setNotice(
        result.mode === "preview"
          ? "Preview: the draft would wait in your review queue."
          : "Drafted — approve it in your review queue.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "We couldn't prepare this draft. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="journey-step-draft">
      {done ? (
        <Link className="journey-step-action" href="/studio/ai-queue">
          Open review queue <ArrowRight size={14} />
        </Link>
      ) : (
        <button
          className="journey-step-action"
          disabled={busy}
          onClick={() => void draft()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
          {action.label}
        </button>
      )}
      {notice ? <small role="status">{notice}</small> : null}
    </span>
  );
}
