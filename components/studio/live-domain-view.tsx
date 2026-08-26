"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  DatabaseZap,
  Inbox,
  LoaderCircle,
  Plus,
  RotateCw,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { stateTone } from "@/lib/status-tone";
import { KindGlyph } from "@/components/library/kind-glyph";
import { kindFromValue } from "@/features/library/kinds";
import { projectStateLabel } from "@/features/projects/state-label";
import { formatDueDate } from "@/lib/format/event-date";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";
import { getStudioRecords } from "@/lib/studio/records-client";
import { ProjectWorkspaceNav } from "@/components/projects/project-workspace-nav";
import { ReadinessRing } from "@/components/ds/readiness-ring";
import {
  describeEventProximity,
  eventDateHasPassed,
  formatEventDate,
} from "@/lib/format/event-date";
import {
  demoTenantDocuments,
  useTenantDocuments,
} from "@/components/live/tenant-records";

type Value = Record<string, unknown> & { id: string };
type Domain =
  | "packages"
  | "proposals"
  | "contracts"
  | "invoices"
  | "questionnaires"
  | "vendors"
  | "insurance"
  | "schedules"
  | "crew_profiles"
  | "crew_assignments"
  | "tasks"
  | "readiness"
  | "post_production"
  | "delivery"
  | "reviews"
  | "workflows"
  | "audit"
  | "consultations"
  | "booking_gates"
  | "automations"
  | "documents"
  | "messages";

const emptyCopy: Partial<Record<Domain, { title: string; detail: string }>> = {
  packages: { title: "No packages yet", detail: "Create the first offer you want clients to select." },
  proposals: { title: "No proposals yet", detail: "Create a proposal when a client is ready to review an offer." },
  contracts: { title: "No contracts yet", detail: "Contracts will appear here after an agreement is prepared for signature." },
  invoices: { title: "No invoice references yet", detail: "QuickBooks invoice links and payment status will appear here after they are created." },
  tasks: { title: "No tasks yet", detail: "Create a task when a project needs a clear owner and due date." },
  workflows: { title: "No workflows yet", detail: "Create a reusable workflow for your most common project type." },
  consultations: { title: "No consultations scheduled", detail: "Choose a project below to schedule the first consultation." },
  readiness: { title: "No readiness results yet", detail: "Readiness appears after a project has required checkpoints." },
  booking_gates: { title: "No booking reviews yet", detail: "Booking requirements are evaluated after a contract and retainer are created." },
  schedules: { title: "No schedules yet", detail: "Generate a run of show from an active project." },
  vendors: { title: "No vendors yet", detail: "Add a venue, planner, or project vendor when details are available." },
  questionnaires: { title: "No questionnaires assigned", detail: "Assign a template below to send the client their details form." },
  insurance: { title: "No certificate requests yet", detail: "Start a request when a venue requires proof of insurance." },
  crew_profiles: { title: "No crew profiles yet", detail: "Add a photographer or subcontractor before assigning project work." },
  crew_assignments: { title: "No crew assignments yet", detail: "Invite crew after the project role, timing, and responsibilities are clear." },
  post_production: { title: "No post-production work yet", detail: "Post-event milestones appear after event coverage is complete." },
  delivery: { title: "No deliveries recorded", detail: "Add the approved gallery or delivery link when it is ready for the client." },
  reviews: { title: "No review requests yet", detail: "Requests can be scheduled after the client receives their delivery." },
  audit: { title: "No audit events in this view", detail: "Meaningful user, workflow, and provider actions will appear here." },
  automations: { title: "No automation runs yet", detail: "Workflow executions will appear after a supported trigger occurs." },
  documents: { title: "No documents yet", detail: "Uploaded and provider-generated project files will appear here." },
  messages: { title: "No messages yet", detail: "Client, crew, and vendor communication history will appear here." },
};

type DomainConfig = {
  collection: string;
  projectScoped?: boolean;
  vendorScoped?: boolean;
  primary: string[];
  secondary: string[];
  status: string[];
  facts: Array<{ label: string; fields: string[]; kind?: "money" | "date" | "count" | "percent" | "retainer" }>;
  href?: (record: Value) => string;
};

const configurations: Record<Domain, DomainConfig> = {
  packages: {
    collection: "packages",
    primary: ["name"],
    secondary: ["description", "eventTypeId"],
    status: ["active"],
    facts: [
      { label: "Base price", fields: ["basePriceCents"], kind: "money" },
      // The deposit is the number a photographer checks; the row version is
      // bookkeeping. An imported package arrives with no retainer at all, so
      // showing it here is how you notice.
      { label: "Deposit", fields: ["retainerRule"], kind: "retainer" },
      { label: "Coverage", fields: ["includedCoverageMinutes"] },
    ],
    href: (record) => `/studio/packages/${record.id}`,
  },
  proposals: {
    collection: "proposals",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["pricingSnapshot.packageName", "id"],
    status: ["status"],
    facts: [
      { label: "Version", fields: ["version"] },
      { label: "Total", fields: ["pricingSnapshot.totalCents"], kind: "money" },
      { label: "Expires", fields: ["expiresAt"], kind: "date" },
    ],
    href: (record) => `/studio/proposals/${record.id}`,
  },
  contracts: {
    collection: "contracts",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["providerEnvelopeId", "id"],
    status: ["status"],
    facts: [
      { label: "Signers", fields: ["signers"], kind: "count" },
      { label: "Sent", fields: ["sentAt"], kind: "date" },
      { label: "Completed", fields: ["completedAt"], kind: "date" },
    ],
  },
  invoices: {
    collection: "invoiceReferences",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["providerInvoiceId", "kind"],
    status: ["status"],
    facts: [
      { label: "Amount", fields: ["amountCents"], kind: "money" },
      { label: "Balance", fields: ["balanceCents"], kind: "money" },
      { label: "Due", fields: ["dueDate"], kind: "date" },
    ],
  },
  questionnaires: {
    collection: "questionnaireResponses",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["templateName", "templateId", "id"],
    status: ["status"],
    facts: [
      { label: "Progress", fields: ["completionPercent"], kind: "percent" },
      { label: "Due", fields: ["dueDate"], kind: "date" },
      { label: "Updated", fields: ["updatedAt"], kind: "date" },
    ],
  },
  vendors: {
    collection: "vendors",
    vendorScoped: true,
    primary: ["company"],
    secondary: ["contactName", "email"],
    status: ["type"],
    facts: [
      { label: "Projects", fields: ["projectIds"], kind: "count" },
      { label: "Phone", fields: ["phone"] },
      { label: "Updated", fields: ["updatedAt"], kind: "date" },
    ],
  },
  insurance: {
    collection: "insuranceRequests",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["venueName", "requestEmail", "id"],
    status: ["status"],
    facts: [
      { label: "Due", fields: ["dueDate"], kind: "date" },
      { label: "Scan", fields: ["scanStatus"] },
      { label: "Decision", fields: ["humanDecision"] },
    ],
  },
  schedules: {
    collection: "schedules",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["timezone", "id"],
    status: ["status"],
    facts: [
      { label: "Version", fields: ["version"] },
      { label: "Items", fields: ["items"], kind: "count" },
      // Labelled "Published" while the status beside it read "client review"
      // or "approved", and the crew surface reported "Not published". The field
      // records when this version was written, which is what it should say.
      { label: "Version dated", fields: ["publishedAt"], kind: "date" },
    ],
    href: (record) => `/studio/schedules/${record.id}`,
  },
  crew_profiles: {
    collection: "crewProfiles",
    primary: ["name"],
    secondary: ["email", "serviceAreas"],
    status: ["active"],
    facts: [
      { label: "Specialties", fields: ["specialties"], kind: "count" },
      { label: "W-9", fields: ["w9Status"] },
      { label: "Insurance", fields: ["insuranceStatus"] },
    ],
    href: (record) => `/studio/crew/${record.id}`,
  },
  crew_assignments: {
    collection: "crewAssignments",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["role", "crewProfileId"],
    status: ["status"],
    facts: [
      { label: "Arrival", fields: ["arrivalAt"], kind: "date" },
      { label: "Schedule", fields: ["currentScheduleVersion"] },
      { label: "Requirements", fields: ["requirements"], kind: "count" },
    ],
    href: (record) => `/studio/crew/${record.id}`,
  },
  tasks: {
    collection: "tasks",
    projectScoped: true,
    primary: ["title", "name"],
    secondary: ["projectName", "description"],
    status: ["status"],
    facts: [
      { label: "Due", fields: ["dueDate"], kind: "date" },
      { label: "Priority", fields: ["priority"] },
      { label: "Blocking", fields: ["blocking"] },
    ],
    href: (record) => `/studio/projects/${String(record.projectId)}`,
  },
  readiness: {
    collection: "readinessAssessments",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["recommendedNextAction", "id"],
    status: ["ready"],
    facts: [
      { label: "Score", fields: ["score"], kind: "percent" },
      { label: "Blocking", fields: ["blockingItems"], kind: "count" },
      { label: "Overdue", fields: ["overdueItems"], kind: "count" },
    ],
    href: (record) => `/studio/projects/${String(record.projectId)}`,
  },
  post_production: {
    collection: "postProductionRecords",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["currentStep", "id"],
    status: ["currentStep"],
    facts: [
      { label: "Target", fields: ["targetDeliveryDate"], kind: "date" },
      { label: "Updated", fields: ["updatedAt"], kind: "date" },
      { label: "Project", fields: ["projectId"] },
    ],
    href: (record) => `/studio/post-production/${record.id}`,
  },
  delivery: {
    collection: "deliveryRecords",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["provider", "galleryUrl"],
    status: ["status"],
    facts: [
      { label: "Delivered", fields: ["deliveryDate"], kind: "date" },
      { label: "Expires", fields: ["expirationDate"], kind: "date" },
      { label: "Downloaded", fields: ["downloadedAt"], kind: "date" },
    ],
  },
  reviews: {
    collection: "reviewRequests",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["destinationLabel", "channel"],
    status: ["status"],
    facts: [
      { label: "Sequence", fields: ["sequence"] },
      { label: "Scheduled", fields: ["scheduledAt"], kind: "date" },
      { label: "Confirmed", fields: ["confirmedAt"], kind: "date" },
    ],
  },
  workflows: {
    collection: "workflowTemplates",
    primary: ["name"],
    secondary: ["eventTypeId", "description"],
    status: ["status"],
    facts: [
      { label: "Version", fields: ["version"] },
      // The records store checkpointTemplates and automationRules; these
      // read "checkpoints" and "automations", so every row showed an em
      // dash where its size should be — on the one list whose whole job is
      // telling you what a template contains.
      { label: "Checkpoints", fields: ["checkpointTemplates"], kind: "count" },
      { label: "Automations", fields: ["automationRules"], kind: "count" },
    ],
    href: (record) => `/studio/workflows/${record.id}`,
  },
  consultations: {
    collection: "consultations",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["mode", "location", "id"],
    status: ["status"],
    facts: [
      { label: "Starts", fields: ["startsAt"], kind: "date" },
      { label: "Timezone", fields: ["timezone"] },
      { label: "Provider", fields: ["providerState"] },
    ],
  },
  booking_gates: {
    collection: "bookingGateRuns",
    projectScoped: true,
    primary: ["projectName"],
    secondary: ["idempotencyKey", "id"],
    status: ["status"],
    facts: [
      { label: "Checks", fields: ["checks"], kind: "count" },
      { label: "Blockers", fields: ["blockers"], kind: "count" },
      { label: "Completed", fields: ["completedAt"], kind: "date" },
    ],
    href: (record) => `/studio/projects/${String(record.projectId)}`,
  },
  automations: {
    collection: "automationRuns",
    projectScoped: true,
    primary: ["trigger.type", "trigger", "workflowVersion"],
    secondary: ["idempotencyKey", "id"],
    status: ["status", "result.status"],
    facts: [
      { label: "Attempt", fields: ["attemptCount"] },
      { label: "Created", fields: ["createdAt"], kind: "date" },
      { label: "Completed", fields: ["completedAt"], kind: "date" },
    ],
  },
  documents: {
    collection: "documents",
    projectScoped: true,
    primary: ["name", "fileName", "kind", "id"],
    secondary: ["category", "provider", "storagePath"],
    status: ["status", "scanStatus"],
    facts: [
      { label: "Version", fields: ["version"] },
      { label: "Visibility", fields: ["visibility"] },
      { label: "Updated", fields: ["updatedAt"], kind: "date" },
    ],
  },
  messages: {
    collection: "messages",
    projectScoped: true,
    primary: ["subject", "templateKey", "id"],
    secondary: ["recipient", "channel"],
    status: ["deliveryStatus"],
    facts: [
      { label: "Direction", fields: ["direction"] },
      { label: "Sent", fields: ["sentAt"], kind: "date" },
      { label: "Mode", fields: ["deliveryMode"] },
    ],
  },
  audit: {
    collection: "auditEvents",
    primary: ["action"],
    secondary: ["entityType", "entityId"],
    status: ["actorType"],
    facts: [
      { label: "Actor", fields: ["actorId"] },
      { label: "Timestamp", fields: ["timestamp"], kind: "date" },
      { label: "Correlation", fields: ["correlationId"] },
    ],
  },
};

function nested(record: Value, paths: string[]) {
  for (const path of paths) {
    let current: unknown = record;
    for (const segment of path.split(".")) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (
      current !== undefined &&
      current !== null &&
      current !== "" &&
      (!Array.isArray(current) || current.length > 0)
    )
      return current;
  }
  return null;
}

function display(
  value: unknown,
  kind: "money" | "date" | "count" | "percent" | "retainer" | undefined,
  currency: unknown,
) {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: typeof currency === "string" ? currency : "USD",
    }).format(Number(value) / 100);
  if (kind === "retainer") {
    const rule =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
    const type = String(rule.type ?? "");
    if (type === "percentage")
      return `${Number(rule.basisPoints ?? 0) / 100}% of total`;
    const money = (cents: unknown) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: typeof currency === "string" ? currency : "USD",
        maximumFractionDigits: 0,
      }).format(Number(cents ?? 0) / 100);
    if (type === "fixed") return money(rule.amountCents);
    if (type === "per_crew_member")
      return `${money(rule.amountPerCrewCents)} per crew`;
    return "Not set";
  }
  if (kind === "date") {
    // Bare toLocaleDateString() produced "9/13/2026" — a fourth date format
    // alongside the three the rest of the product uses. This renderer feeds
    // every domain list, so it was the widest single source of the drift.
    return formatDueDate(String(value));
  }
  if (kind === "count") return Array.isArray(value) ? value.length : Number(value);
  if (kind === "percent") return `${Number(value)}%`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value).replaceAll("_", " ");
}

function tone(value: unknown) {
  const status = String(value).toLowerCase();
  if (status === "true") return "brand" as const;
  if (status === "false" || status === "revoked") return "danger" as const;
  return stateTone(status);
}

export function LiveDomainView({
  domain,
  emptyAction,
  projectId,
}: {
  domain: Domain;
  emptyAction?: { href: string; label: string };
  projectId?: string;
}) {
  const workspace = useWorkspace();
  const config = configurations[domain];
  const demoRecords = useMemo(
    () => demoTenantDocuments(config.collection).filter((record) => {
      if (projectId && config.projectScoped) {
        return record.projectId === projectId;
      }
      if (projectId && config.vendorScoped) {
        return Array.isArray(record.projectIds) && record.projectIds.includes(projectId);
      }
      return true;
    }),
    [config.collection, config.projectScoped, config.vendorScoped, projectId],
  );
  const [records, setRecords] = useState<Value[] | null>(() =>
    dataIsLive ? null : demoRecords,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!dataIsLive) {
      queueMicrotask(() => {
        setRecords(demoRecords);
        setError(null);
      });
      return;
    }
    if (workspace.loading) return;
    if (!workspace.tenantId) {
      queueMicrotask(() => {
        setRecords([]);
        setError("No active tenant was found.");
      });
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setRecords(null);
        setError(null);
      }
    });
    const { firestore } = getFirebaseClient();
    const constraints: QueryConstraint[] = [
      where("tenantId", "==", workspace.tenantId),
    ];
    if (projectId && config.projectScoped) {
      constraints.push(where("projectId", "==", projectId));
    }
    if (projectId && config.vendorScoped) {
      constraints.push(where("projectIds", "array-contains", projectId));
    }
    if (
      config.projectScoped &&
      !projectId &&
      !["studio_owner", "studio_admin"].includes(String(workspace.role))
    ) {
      if (workspace.projectIds.length === 0) {
        queueMicrotask(() => {
          if (active) setRecords([]);
        });
        return () => {
          active = false;
        };
      }
      constraints.push(
        where("projectId", "in", workspace.projectIds.slice(0, 30)),
      );
    }
    if (
      config.vendorScoped &&
      !projectId &&
      !["studio_owner", "studio_admin"].includes(String(workspace.role))
    ) {
      if (workspace.projectIds.length === 0) {
        queueMicrotask(() => {
          if (active) setRecords([]);
        });
        return () => {
          active = false;
        };
      }
      constraints.push(
        where("projectIds", "array-contains-any", workspace.projectIds.slice(0, 30)),
      );
    }
    constraints.push(limit(100));
    void withTimeout(
      getDocs(query(collection(firestore, config.collection), ...constraints)),
      15_000,
      `${config.collection} took too long to load.`,
    )
      .then(async (snapshot) => {
        const values = snapshot.docs.map(
          (document) => ({ id: document.id, ...document.data() }) as Value,
        );
        const projectIds = Array.from(
          new Set(
            values
              .map((value) => value.projectId)
              .filter((value): value is string => typeof value === "string"),
          ),
        );
        const projects = await withTimeout(
          Promise.all(
            projectIds.map((projectId) =>
              getDoc(doc(firestore, "projects", projectId)),
            ),
          ),
          10_000,
          "Project names took too long to load.",
        );
        const names = Object.fromEntries(
          projects
            .filter((project) => project.exists())
            .map((project) => [project.id, String(project.get("name"))]),
        );
        if (active)
          setRecords(
            values.map((value) => ({
              ...value,
              projectName:
                typeof value.projectId === "string"
                  ? names[value.projectId] ?? value.projectId
                  : value.projectName,
            })),
          );
      })
      .catch(async (caught: unknown) => {
        try {
          const recovered = await getStudioRecords({
            collection: config.collection,
            tenantId: workspace.tenantId!,
            projectId,
            projectScoped: config.projectScoped,
            vendorScoped: config.vendorScoped,
          });
          if (active) {
            setRecords(recovered as Value[]);
            setError(null);
          }
        } catch (recoveryError: unknown) {
          if (!active) return;
          setRecords([]);
          const primary = caught instanceof Error ? caught.message : null;
          const recovery = recoveryError instanceof Error ? recoveryError.message : null;
          setError(recovery ?? primary ?? `${config.collection} could not be loaded.`);
        }
      });
    return () => {
      active = false;
    };
  }, [
    config,
    attempt,
    demoRecords,
    projectId,
    workspace.loading,
    workspace.projectIds,
    workspace.role,
    workspace.tenantId,
  ]);

  if (dataIsLive && records === null)
    return (
      <section className="panel live-domain-state">
        <LoaderCircle className="spin" />
        <span>
          <strong>Loading records…</strong>
          <small>Loading your studio records.</small>
        </span>
      </section>
    );
  if (error)
    return (
      <section className="panel live-domain-state live-domain-error">
        <DatabaseZap />
        <span>
          <strong>Records could not be loaded</strong>
          <small>{error}</small>
        </span>
        <button
          className="button button-light button-sm"
          onClick={() => setAttempt((current) => current + 1)}
          type="button"
        >
          <RotateCw size={14} /> Retry
        </button>
      </section>
    );
  if (!records?.length) {
    const copy = emptyCopy[domain] ?? {
      title: "Nothing here yet",
      detail: "Records will appear here after you create or receive them.",
    };
    // An empty list is the first thing a new studio sees on most of these
    // pages, and a grey inbox icon says only "nothing". The kind's own
    // glyph says what belongs here — a violet contract, a gold
    // questionnaire — which is the one useful thing an empty page can do.
    const kind = kindFromValue(domain);
    return (
      <section className="panel live-domain-state is-empty">
        {kind ? <KindGlyph kind={kind} size={54} /> : <Inbox />}
        <span>
          <strong>{copy.title}</strong>
          <small>{copy.detail}</small>
        </span>
        {emptyAction ? (
          <Link className="button button-light button-sm" href={emptyAction.href}>
            {emptyAction.label}
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <section className="panel live-domain-table">
      {records.map((record) => {
        const primary = display(
          nested(record, config.primary),
          undefined,
          record.currency,
        );
        const secondary = display(
          nested(record, config.secondary),
          undefined,
          record.currency,
        );
        const status = nested(record, config.status);
        const content = (
          <>
            <span className="live-domain-primary">
              <strong>{primary}</strong>
              <small>{secondary}</small>
            </span>
            {config.facts.map((fact) => (
              <span key={fact.label}>
                <small>{fact.label}</small>
                <strong>
                  {display(
                    nested(record, fact.fields),
                    fact.kind,
                    record.currency,
                  )}
                </strong>
              </span>
            ))}
            <StatusBadge tone={tone(status)}>
              {display(status, undefined, record.currency)}
            </StatusBadge>
            {config.href ? <ArrowRight /> : null}
          </>
        );
        return config.href ? (
          <Link href={config.href(record)} key={record.id}>
            {content}
          </Link>
        ) : (
          <article key={record.id}>{content}</article>
        );
      })}
    </section>
  );
}

export function StudioDomainPage({
  domain,
  eyebrow,
  title,
  description,
  action,
  projectId,
  beforeContent,
}: {
  domain: Domain;
  eyebrow: string;
  title: string;
  description: string;
  action?: { href: string; label: string };
  projectId?: string;
  beforeContent?: ReactNode;
}) {
  return (
    <div className="live-domain-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action ? (
          <Link className="button button-dark" href={action.href}>
            <Plus /> {action.label}
          </Link>
        ) : null}
      </header>
      {beforeContent}
      {projectId ? <ProjectContextBar projectId={projectId} /> : null}
      <LiveDomainView domain={domain} emptyAction={action} projectId={projectId} />
    </div>
  );
}

/**
 * The project header, kept on screen across every project view.
 *
 * Overview / Client & booking / Plan / Delivery are separate top-level routes
 * wearing tab clothing, so switching one used to replace the project header
 * with a thin "Back to project" strip — the event date, stage and readiness
 * all vanished exactly when the reader needed them to make a decision here.
 */
export function ProjectContextBar({ projectId }: { projectId: string }) {
  const { records, loading } = useTenantDocuments("projects");
  const project = records?.find((entry) => entry.id === projectId);
  const name = loading
    ? "Loading project…"
    : String(project?.name ?? "Selected project");
  const state = String(project?.state ?? "");
  const readiness = Number(project?.readinessScore ?? 0);
  const eventDate = project?.eventDate;
  const proximity = describeEventProximity(eventDate);
  const passed = eventDateHasPassed(eventDate);
  const facts = [
    project?.eventType ? String(project.eventType) : "",
    project?.venueName ? String(project.venueName) : "",
    project?.leadPhotographerName ? `Lead: ${String(project.leadPhotographerName)}` : "",
  ].filter(Boolean);

  return (
    <aside className="project-context-stack">
      <div className="project-context-bar is-detailed">
        <Link className="project-context-identity" href={`/studio/projects/${projectId}`}>
          <ArrowLeft aria-hidden="true" />
          <span>
            <small>Project</small>
            <strong>{name}</strong>
          </span>
        </Link>
        {project ? (
          <>
            <span className="project-context-facts">
              {eventDate ? (
                <span className={passed ? "project-context-when is-passed" : "project-context-when"}>
                  <CalendarDays aria-hidden="true" size={13} />
                  {formatEventDate(eventDate)}
                  {proximity ? <em> · {proximity}</em> : null}
                </span>
              ) : null}
              {facts.length ? <small>{facts.join(" · ")}</small> : null}
            </span>
            <span className="project-context-status">
              {state ? (
                <StatusBadge dot tone={stateTone(state)}>
                  {projectStateLabel(state)}
                </StatusBadge>
              ) : null}
              {/* The ring carries the number, so no separate label: printing
                  readiness twice was a habit worth breaking. */}
              <span
                className="project-context-readiness"
                title={`${readiness}% ready`}
              >
                <ReadinessRing size={42} stroke={3} value={readiness} />
                <span className="ds-sr-only">{readiness}% ready</span>
              </span>
            </span>
          </>
        ) : null}
      </div>
      <ProjectWorkspaceNav compact projectId={projectId} />
    </aside>
  );
}
