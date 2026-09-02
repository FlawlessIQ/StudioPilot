import type { ProjectState } from "@/features/projects/schema";
import { preparationIsMoot } from "@/features/projects/job-moment";
import {
  checkpointSatisfiedByEvidence,
  noReadinessEvidence,
  type ReadinessEvidence,
} from "@/features/readiness/checkpoint-evidence";
import { checkpointWaitingReason } from "@/features/readiness/checkpoint-resolution";

export type LifecycleRecord = Record<string, unknown> & { id: string };

export type LifecycleLaneKey =
  | "studiocue"
  | "studio"
  | "client"
  | "crew";

export type LifecycleWorkItem = {
  id: string;
  label: string;
  detail: string;
  status: "working" | "waiting" | "blocked" | "ready" | "complete";
  owner: "StudioCue" | "Studio" | "Client" | "Crew";
  dueAt: string | null;
  href: string;
  evidence: string | null;
};

export type ProjectLifecycleProjection = {
  currentStage: "Inquiry" | "Booking" | "Planning" | "Event" | "Delivery";
  readiness: number;
  nextAction: {
    label: string;
    owner: LifecycleWorkItem["owner"];
    dueAt: string | null;
    href: string;
  };
  primaryBlocker: string | null;
  waitingOn: LifecycleWorkItem["owner"] | null;
  lanes: Record<LifecycleLaneKey, LifecycleWorkItem[]>;
};

const stateStage: Record<ProjectState, ProjectLifecycleProjection["currentStage"]> = {
  LEAD: "Inquiry",
  CONSULTATION: "Inquiry",
  PROPOSAL: "Booking",
  CONTRACT_PENDING: "Booking",
  RETAINER_PENDING: "Booking",
  BOOKED: "Planning",
  PLANNING: "Planning",
  READY: "Event",
  EVENT_COMPLETE: "Delivery",
  POST_PRODUCTION: "Delivery",
  DELIVERED: "Delivery",
  REVIEW_REQUESTED: "Delivery",
  CLOSED: "Delivery",
  CANCELLED: "Inquiry",
  POSTPONED: "Planning",
  ARCHIVED: "Delivery",
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const number = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** Money is stored in cents and must never be shown that way. */
const money = (cents: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

function due(record: LifecycleRecord): string | null {
  return (
    text(record.resolvedDueDate) ||
    text(record.dueDate) ||
    text(record.expiresAt) ||
    text(record.scheduledFor) ||
    text(record.startsAt) ||
    null
  );
}

function overdue(value: string | null, now: string): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed < Date.parse(now);
}

function route(projectId: string, domain: string): string {
  const direct: Record<string, string> = {
    projects: `/studio/projects/${projectId}`,
    consultations: `/studio/calendar?project=${projectId}`,
    proposals: `/studio/proposals?project=${projectId}`,
    contracts: `/studio/contracts?project=${projectId}`,
    invoices: `/studio/invoices?project=${projectId}`,
    questionnaires: `/studio/questionnaires?project=${projectId}`,
    insurance: `/studio/insurance?project=${projectId}`,
    schedules: `/studio/schedules?project=${projectId}`,
    crew: `/studio/crew?project=${projectId}`,
    delivery: `/studio/delivery?project=${projectId}`,
    reviews: `/studio/reviews?project=${projectId}`,
    tasks: `/studio/tasks?project=${projectId}`,
    automations: "/studio/ai-queue",
  };
  return direct[domain] ?? `/studio/projects/${projectId}`;
}

function item(input: Omit<LifecycleWorkItem, "evidence"> & {
  evidence?: string | null;
}): LifecycleWorkItem {
  return { evidence: null, ...input };
}

export function projectLifecycleProjection(input: {
  project: LifecycleRecord;
  checkpoints?: LifecycleRecord[];
  tasks?: LifecycleRecord[];
  contracts?: LifecycleRecord[];
  invoices?: LifecycleRecord[];
  questionnaires?: LifecycleRecord[];
  insurance?: LifecycleRecord[];
  schedules?: LifecycleRecord[];
  crewAssignments?: LifecycleRecord[];
  automationRuns?: LifecycleRecord[];
  aiActions?: LifecycleRecord[];
  deliveries?: LifecycleRecord[];
  reviewRequests?: LifecycleRecord[];
  /**
   * What the project's own records already prove.
   *
   * Without this the panel read `checkpoint.status` alone, and checkpoints are
   * only ever written by workflow automation — so a job whose contract was
   * completed and whose retainer was paid minutes earlier listed both as
   * outstanding, owed by the client, directly beneath a journey rail reading
   * "BOOKING 3/3". Marking a certificate not required left "COI approved and
   * sent" on the list for ever.
   *
   * The header on the same screen was already evidence-aware, so the two
   * disagreed by four items: 8 blockers counted, 12 listed. See
   * features/readiness/checkpoint-evidence.ts — the rules this defers to.
   *
   * Defaults to "nothing proven", which is the old behaviour, so a caller that
   * has not loaded evidence is no worse off than before.
   */
  evidence?: ReadinessEvidence;
  now?: string;
}): ProjectLifecycleProjection {
  const now = input.now ?? new Date().toISOString();
  const projectId = input.project.id;
  const state = text(input.project.state) as ProjectState;
  const lanes: ProjectLifecycleProjection["lanes"] = {
    studiocue: [],
    studio: [],
    client: [],
    crew: [],
  };

  for (const run of input.automationRuns ?? []) {
    if (
      ["queued", "running", "retry_scheduled"].includes(text(run.status))
    ) {
      lanes.studiocue.push(
        item({
          id: `automation-${run.id}`,
          label: text(run.name) || text(run.triggerType) || "Workflow run",
          detail:
            text(run.status) === "retry_scheduled"
              ? "Retry is scheduled with the recorded backoff."
              : "StudioCue is processing the next deterministic step.",
          status: "working",
          owner: "StudioCue",
          dueAt: due(run),
          href: route(projectId, "automations"),
          evidence: run.id,
        }),
      );
    }
  }
  for (const action of input.aiActions ?? []) {
    if (["queued", "running"].includes(text(action.status))) {
      lanes.studiocue.push(
        item({
          id: `ai-${action.id}`,
          label: text(action.title) || "AI is preparing a draft",
          detail: text(action.capability).replaceAll("_", " "),
          status: "working",
          owner: "StudioCue",
          dueAt: due(action),
          href: route(projectId, "automations"),
          evidence: action.id,
        }),
      );
    } else if (text(action.status) === "review_required") {
      lanes.studio.push(
        item({
          id: `ai-review-${action.id}`,
          label: text(action.title) || "Review AI-prepared work",
          detail: "Drafted and waiting on your yes.",
          status: "ready",
          owner: "Studio",
          dueAt: due(action),
          href: route(projectId, "automations"),
          evidence: action.id,
        }),
      );
    }
  }

  const evidence = input.evidence ?? noReadinessEvidence;
  for (const checkpoint of input.checkpoints ?? []) {
    if (["complete", "waived"].includes(text(checkpoint.status))) continue;
    // Settled by the records, even though nothing wrote it to the document.
    if (
      checkpointSatisfiedByEvidence(
        {
          completionMethod: text(checkpoint.completionMethod),
          templateKey: text(checkpoint.templateKey),
        },
        evidence,
      )
    )
      continue;
    const ownerType = text(checkpoint.ownerType);
    const owner =
      ownerType === "client"
        ? "Client"
        : ["crew", "subcontractor", "photographer"].includes(ownerType)
          ? "Crew"
          : "Studio";
    const lane =
      owner === "Client" ? lanes.client : owner === "Crew" ? lanes.crew : lanes.studio;
    const dueAt = due(checkpoint);
    lane.push(
      item({
        id: `checkpoint-${checkpoint.id}`,
        label: text(checkpoint.name) || "Readiness requirement",
        /**
         * What this one is actually waiting for.
         *
         * Every blocking checkpoint said "Blocks event readiness until
         * resolved." — twelve identical sentences on one panel, carrying no
         * information after the first and crowding out the part that differs.
         * `status` already marks the blocking ones, so the words can do the
         * other job.
         */
        detail:
          checkpointWaitingReason({
            status: text(checkpoint.status),
            completionMethod: text(checkpoint.completionMethod),
          }) ??
          (checkpoint.blocking === true
            ? "Your judgement — mark it done once you have."
            : "Required project follow-up."),
        status: overdue(dueAt, now)
          ? "blocked"
          : checkpoint.blocking === true
            ? "waiting"
            : "ready",
        owner,
        dueAt,
        href: route(projectId, "projects"),
        evidence: checkpoint.id,
      }),
    );
  }

  for (const task of input.tasks ?? []) {
    if (["complete", "completed", "cancelled"].includes(text(task.status)))
      continue;
    const dueAt = due(task);
    lanes.studio.push(
      item({
        id: `task-${task.id}`,
        label: text(task.title) || text(task.name) || "Studio task",
        detail: text(task.description) || "Studio-owned project work.",
        status: overdue(dueAt, now) ? "blocked" : "ready",
        owner: "Studio",
        dueAt,
        href: route(projectId, "tasks"),
        evidence: task.id,
      }),
    );
  }

  const activeContract = (input.contracts ?? []).find(
    (contract) =>
      !["completed", "voided", "declined"].includes(text(contract.status)),
  );
  if (activeContract) {
    lanes.client.push(
      item({
        id: `contract-${activeContract.id}`,
        label: "Complete contract signatures",
        detail: `${list(activeContract.signers).length || "Required"} signer records · provider evidence pending`,
        status: "waiting",
        owner: "Client",
        dueAt: due(activeContract),
        href: route(projectId, "contracts"),
        evidence: text(activeContract.providerEnvelopeId) || activeContract.id,
      }),
    );
  }
  const unpaid = (input.invoices ?? []).filter(
    (invoice) =>
      number(invoice.balanceCents) > 0 &&
      !["voided", "refunded"].includes(text(invoice.status)),
  );
  for (const invoice of unpaid) {
    const dueAt = due(invoice);
    lanes.client.push(
      item({
        id: `invoice-${invoice.id}`,
        label:
          text(invoice.kind) === "retainer"
            ? "Pay booking retainer"
            : "Pay outstanding invoice",
        detail: `${money(number(invoice.balanceCents))} still owed`,
        status: overdue(dueAt, now) ? "blocked" : "waiting",
        owner: "Client",
        dueAt,
        href: route(projectId, "invoices"),
        evidence: text(invoice.providerInvoiceId) || invoice.id,
      }),
    );
  }
  for (const response of input.questionnaires ?? []) {
    if (["submitted", "reviewed", "complete"].includes(text(response.status)))
      continue;
    lanes.client.push(
      item({
        id: `questionnaire-${response.id}`,
        label: "Finish planning questionnaire",
        detail: `${number(response.completionPercent)}% complete`,
        status: overdue(due(response), now) ? "blocked" : "waiting",
        owner: "Client",
        dueAt: due(response),
        href: route(projectId, "questionnaires"),
        evidence: response.id,
      }),
    );
  }

  /**
   * An offer for an event that has already been shot cannot be answered.
   *
   * A wedding six days past its date listed "Respond to lighting assistant
   * offer · waiting" as outstanding studio work, while the journey and the Plan
   * hub both — correctly — read the settled crew checkpoint and said crew was
   * done. Nobody is going to accept a role on a wedding that has happened.
   */
  // Records count here too, for the same reason they count in the loop above:
  // the crew checkpoints are `assignment_accepted`, which automation writes
  // and nothing else does, so reading the status alone missed a job whose
  // assignments were all accepted.
  const crewCheckpointSettled = (input.checkpoints ?? []).some(
    (checkpoint) =>
      text(checkpoint.templateKey).startsWith("crew") &&
      (["complete", "waived"].includes(text(checkpoint.status)) ||
        checkpointSatisfiedByEvidence(
          {
            completionMethod: text(checkpoint.completionMethod),
            templateKey: text(checkpoint.templateKey),
          },
          evidence,
        )),
  );
  /**
   * Whether an unanswered crew offer is still the studio's problem.
   *
   * Two ways it stops being. The event has been shot — nobody is going to
   * accept a role on a wedding that has happened. Or the studio settled the
   * crew readiness checkpoint, which is the attestation that crew is handled;
   * the journey and the Plan hub both read that and said Crew was done, while
   * this panel went on listing the offer as outstanding on the same page.
   */
  const crewOffersStillOpen =
    !preparationIsMoot(state) && !crewCheckpointSettled;

  for (const assignment of input.crewAssignments ?? []) {
    if (["accepted", "complete", "declined", "cancelled"].includes(
      text(assignment.status),
    )) {
      if (
        text(assignment.status) === "accepted" &&
        number(assignment.acknowledgedScheduleVersion) <
          number(assignment.currentScheduleVersion)
      ) {
        lanes.crew.push(
          item({
            id: `crew-ack-${assignment.id}`,
            label: "Acknowledge the current schedule",
            detail: `${text(assignment.role) || "Crew role"} has a newer published version.`,
            status: "waiting",
            owner: "Crew",
            dueAt: due(assignment),
            href: route(projectId, "crew"),
            evidence: assignment.id,
          }),
        );
      }
      continue;
    }
    if (!crewOffersStillOpen) continue;
    lanes.crew.push(
      item({
        id: `crew-${assignment.id}`,
        // Phrased as the studio's imperative — "Respond to lighting assistant
        // offer" — on a panel headed "everything outstanding, by who owes it".
        // The studio cannot answer its own offer; the person it went to can.
        label: `${text(assignment.role) || "Crew"} has not answered the offer`,
        detail: "Waiting on them to accept, decline, or let it expire.",
        status: "waiting",
        owner: "Crew",
        dueAt: due(assignment),
        href: route(projectId, "crew"),
        evidence: assignment.id,
      }),
    );
  }

  const currentStage = stateStage[state] ?? "Inquiry";
  const all = [
    ...lanes.studio,
    ...lanes.client,
    ...lanes.crew,
    ...lanes.studiocue,
  ];
  const order = { blocked: 0, ready: 1, waiting: 2, working: 3, complete: 4 };
  const prioritized = [...all].sort((left, right) => {
    const status = order[left.status] - order[right.status];
    if (status !== 0) return status;
    return (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999");
  });
  const next = prioritized[0];
  return {
    currentStage,
    readiness: Math.max(
      0,
      Math.min(100, number(input.project.readinessScore)),
    ),
    nextAction: next
      ? {
          label: next.label,
          owner: next.owner,
          dueAt: next.dueAt,
          href: next.href,
        }
      : {
          label: text(input.project.nextAction) || "Review the project",
          owner: "Studio",
          dueAt: null,
          href: route(projectId, "projects"),
        },
    primaryBlocker:
      prioritized.find((work) => work.status === "blocked")?.label ?? null,
    waitingOn:
      prioritized.find((work) =>
        ["waiting", "blocked"].includes(work.status),
      )?.owner ?? null,
    lanes,
  };
}
