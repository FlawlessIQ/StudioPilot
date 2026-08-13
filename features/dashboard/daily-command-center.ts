export type DailyRecord = Record<string, unknown> & { id: string };

export type DailyCommandItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  updatedAt: string;
};

export type DailyCommandProjection = {
  approvals: DailyCommandItem[];
  exceptions: DailyCommandItem[];
  working: DailyCommandItem[];
};

type DailyCommandInput = {
  now: string;
  projects?: DailyRecord[] | null;
  tasks?: DailyRecord[] | null;
  aiActions?: DailyRecord[] | null;
  automationApprovals?: DailyRecord[] | null;
  communicationDrafts?: DailyRecord[] | null;
  deliveryDrafts?: DailyRecord[] | null;
  proposals?: DailyRecord[] | null;
  automationRuns?: DailyRecord[] | null;
  providerJobs?: DailyRecord[] | null;
  emailJobs?: DailyRecord[] | null;
  integrationConnections?: DailyRecord[] | null;
  bookingOrchestrations?: DailyRecord[] | null;
  crewCascades?: DailyRecord[] | null;
  invoiceReferences?: DailyRecord[] | null;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const values = (records?: DailyRecord[] | null) => records ?? [];

function readable(value: unknown) {
  return text(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function updatedAt(record: DailyRecord) {
  return text(
    record.updatedAt ??
      record.requestedAt ??
      record.receivedAt ??
      record.createdAt,
  );
}

function projectName(
  record: DailyRecord,
  projects: Map<string, DailyRecord>,
) {
  const project = projects.get(text(record.projectId));
  return text(record.projectName) || text(project?.name) || "Studio workflow";
}

function recent(items: DailyCommandItem[]) {
  return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function dailyCommandProjection(
  input: DailyCommandInput,
): DailyCommandProjection {
  const projects = new Map(
    values(input.projects).map((project) => [project.id, project]),
  );
  const today = input.now.slice(0, 10);

  const approvals: DailyCommandItem[] = [
    ...values(input.aiActions)
      .filter(
        (record) =>
          record.status === "review_required" &&
          (!text(record.snoozedUntil) || text(record.snoozedUntil) <= input.now),
      )
      .map((record) => ({
        id: `ai-${record.id}`,
        title: text(record.title) || "Review AI-prepared work",
        detail: `${projectName(record, projects)} · AI prepared`,
        href: "/studio/ai-queue",
        updatedAt: updatedAt(record),
      })),
    ...values(input.automationApprovals)
      .filter((record) => record.status === "pending")
      .map((record) => ({
        id: `automation-approval-${record.id}`,
        title: `Approve ${readable(record.actionType) || "workflow action"}`,
        detail: `${projectName(record, projects)} · Rules verified`,
        href: "/studio/ai-queue",
        updatedAt: updatedAt(record),
      })),
    ...values(input.communicationDrafts)
      .filter((record) =>
        ["needs_approval", "approved_unsent"].includes(text(record.status)),
      )
      .map((record) => ({
        id: `message-${record.id}`,
        title:
          record.status === "approved_unsent"
            ? `Send ${text(record.subject) || "approved email"}`
            : `Approve ${text(record.subject) || "prepared email"}`,
        detail: `${projectName(record, projects)} · Email prepared`,
        href: "/studio/messages",
        updatedAt: updatedAt(record),
      })),
    ...values(input.deliveryDrafts)
      .filter((record) => record.status === "review_required")
      .map((record) => ({
        id: `delivery-${record.id}`,
        title: "Approve gallery delivery",
        detail: `${projectName(record, projects)} · Link and access details captured`,
        href: `/studio/delivery?project=${encodeURIComponent(text(record.projectId))}`,
        updatedAt: updatedAt(record),
      })),
    ...values(input.proposals)
      .filter((record) => record.status === "internal_review")
      .map((record) => ({
        id: `proposal-${record.id}`,
        title: "Approve prepared proposal",
        detail: `${projectName(record, projects)} · Client-facing offer`,
        href: `/studio/proposals?project=${encodeURIComponent(text(record.projectId))}`,
        updatedAt: updatedAt(record),
      })),
  ];

  const exceptionJob = (record: DailyRecord, label: string, href: string) => ({
    id: `${label.toLowerCase().replaceAll(" ", "-")}-${record.id}`,
    title: `${label} needs attention`,
    detail: `${projectName(record, projects)} · ${readable(record.status)}`,
    href,
    updatedAt: updatedAt(record),
  });
  const exceptions: DailyCommandItem[] = [
    ...values(input.tasks)
      .filter((record) => {
        const due = text(record.dueAt ?? record.dueDate).slice(0, 10);
        return (
          due &&
          due < today &&
          !["complete", "completed", "cancelled"].includes(text(record.status))
        );
      })
      .map((record) => ({
        id: `task-${record.id}`,
        title: text(record.title) || "Overdue studio task",
        detail: `${projectName(record, projects)} · Overdue`,
        href: record.projectId
          ? `/studio/projects/${encodeURIComponent(text(record.projectId))}`
          : "/studio/tasks",
        updatedAt: updatedAt(record),
      })),
    ...values(input.automationRuns)
      .filter((record) => ["failed", "dead_letter"].includes(text(record.status)))
      .map((record) => exceptionJob(record, "Automation", "/studio/automations")),
    ...values(input.providerJobs)
      .filter((record) => ["failed", "dead_letter"].includes(text(record.status)))
      .map((record) => exceptionJob(record, "Provider job", "/studio/integrations")),
    ...values(input.emailJobs)
      .filter((record) => ["failed", "dead_letter"].includes(text(record.status)))
      .map((record) => exceptionJob(record, "Email delivery", "/studio/messages")),
    ...values(input.integrationConnections)
      .filter((record) => record.status === "error" || Boolean(record.lastError))
      .map((record) => ({
        id: `integration-${record.id}`,
        title: `Reconnect ${readable(record.provider) || "integration"}`,
        detail: "Studio connection · Automation paused safely",
        href: "/studio/integrations",
        updatedAt: updatedAt(record),
      })),
    ...values(input.bookingOrchestrations)
      .filter((record) => record.status === "needs_attention")
      .map((record) => exceptionJob(record, "Booking", `/studio/booking?project=${encodeURIComponent(text(record.projectId))}`)),
    ...values(input.crewCascades)
      .filter((record) => record.status === "exhausted")
      .map((record) => exceptionJob(record, "Crew search", "/studio/crew")),
    ...values(input.invoiceReferences)
      .filter(
        (record) =>
          Number(record.balanceCents ?? 0) > 0 &&
          text(record.dueDate) < today &&
          !["voided", "refunded", "paid"].includes(text(record.status)),
      )
      .map((record) => exceptionJob(record, "Overdue balance", "/studio/invoices")),
  ];

  const working: DailyCommandItem[] = [
    ...values(input.automationRuns)
      .filter((record) => ["queued", "running", "retry_scheduled"].includes(text(record.status)))
      .map((record) => ({
        id: `automation-run-${record.id}`,
        title: readable(record.automationRuleKey) || "Running studio workflow",
        detail: `${projectName(record, projects)} · ${readable(record.status)}`,
        href: "/studio/automations",
        updatedAt: updatedAt(record),
      })),
    ...values(input.providerJobs)
      .filter((record) => ["queued", "running", "retry_scheduled"].includes(text(record.status)))
      .map((record) => ({
        id: `provider-job-${record.id}`,
        title: readable(record.type) || "Completing provider work",
        detail: `${projectName(record, projects)} · ${readable(record.status)}`,
        href: "/studio/integrations",
        updatedAt: updatedAt(record),
      })),
    ...values(input.emailJobs)
      .filter((record) => ["queued", "running", "scheduled", "provider_accepted"].includes(text(record.status)))
      .map((record) => ({
        id: `email-job-${record.id}`,
        title: text(record.customSubject) || readable(record.type) || "Sending client email",
        detail: `${projectName(record, projects)} · ${readable(record.status)}`,
        href: "/studio/messages",
        updatedAt: updatedAt(record),
      })),
    ...values(input.bookingOrchestrations)
      .filter((record) => record.status === "active")
      .map((record) => ({
        id: `booking-${record.id}`,
        title: readable(record.currentStep) || "Completing booking sequence",
        detail: `${projectName(record, projects)} · StudioCue is monitoring evidence`,
        href: `/studio/booking?project=${encodeURIComponent(text(record.projectId))}`,
        updatedAt: updatedAt(record),
      })),
    ...values(input.crewCascades)
      .filter((record) => record.status === "active")
      .map((record) => ({
        id: `crew-${record.id}`,
        title: `Filling ${text(record.role) || "crew role"}`,
        detail: `${projectName(record, projects)} · Waiting on candidate`,
        href: "/studio/crew",
        updatedAt: updatedAt(record),
      })),
  ];

  return {
    approvals: recent(approvals),
    exceptions: recent(exceptions),
    working: recent(working),
  };
}
