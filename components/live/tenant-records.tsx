"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock3,
  DatabaseZap,
  Inbox,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { crmLeads, crmProjects } from "@/config/crm-demo-data";
import { demoProjects } from "@/config/demo-data";
import type { Role } from "@/features/auth/roles";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";
import { getStudioRecords } from "@/lib/studio/records-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { stateTone } from "@/lib/status-tone";
import { projectStateLabel } from "@/features/projects/state-label";
import { PhaseTrack } from "@/components/projects/phase-track";
import { compareJobsForList } from "@/features/projects/job-order";
import { formatCents } from "@/lib/format/money";
import { useTodayInbox } from "@/components/today/use-today-inbox";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ClientPortalInvite,
  type ClientInvitationStatus,
  type ClientInviteProjectOption,
} from "@/components/clients/client-portal-invite";
import { runClientInvitation } from "@/lib/client/invitation-client";
export type TenantDocument = Record<string, unknown> & { id: string };

import { demoTenantDocuments } from "@/features/live/demo-records";
import {
  describeEventProximity,
  formatEventDate,
} from "@/lib/format/event-date";
import { formatDueDate } from "@/lib/format/event-date";
import {
  byLongestWaiting,
  waitingLabel,
} from "@/features/ordering/attention";
import { statusLabel } from "@/features/format/status-label";

// Re-exported so existing importers of this module keep working.
export { demoTenantDocuments };

const tenantRecordsCacheTtlMs = 15_000;
const tenantRecordsRequestTimeoutMs = 12_000;
const tenantRecordsCache = new Map<
  string,
  { records: TenantDocument[]; expiresAt: number }
>();
const tenantRecordsRequests = new Map<string, Promise<TenantDocument[]>>();
const projectScopedCollections = new Set([
  "tasks",
  "checkpoints",
  "proposals",
  "contracts",
  "invoiceReferences",
  "packageSnapshots",
  "documents",
  "questionnaireResponses",
  "insuranceRequests",
  "schedules",
  "crewAssignments",
  "crewCascades",
  "albumWorkflows",
  "projectCloseouts",
  "messages",
  "communicationDrafts",
  "aiActions",
  "actionReceipts",
  "productEvents",
  "providerJobs",
  "emailJobs",
  "bookingOrchestrations",
  "galleryInboxes",
  "deliveryDrafts",
]);

function tenantRecordsKey(
  collectionName: string,
  tenantId: string,
  role: Role | null,
  projectIds: string[],
): string {
  return [
    tenantId,
    collectionName,
    role ?? "unknown",
    [...projectIds].sort().join(","),
  ].join(":");
}

async function tenantDocuments(
  collectionName: string,
  tenantId: string,
  role: Role | null,
  projectIds: string[],
): Promise<TenantDocument[]> {
  const { firestore } = getFirebaseClient();
  const restrictedToAssignments =
    role !== "studio_owner" && role !== "studio_admin";
  if (
    collectionName === "projects" &&
    restrictedToAssignments
  ) {
    const documents = await Promise.all(
      projectIds.slice(0, 100).map((projectId) =>
        getDoc(doc(firestore, "projects", projectId)),
      ),
    );
    return documents
      .filter((document) => document.exists())
      .map(
        (document) =>
          ({ id: document.id, ...document.data() }) as TenantDocument,
      )
      .filter((document) => document.tenantId === tenantId);
  }
  if (
    restrictedToAssignments &&
    projectScopedCollections.has(collectionName)
  ) {
    if (!projectIds.length) return [];
    const snapshots = await Promise.all([
      ...projectIds.slice(0, 100).map((projectId) =>
        getDocs(
          query(
            collection(firestore, collectionName),
            where("tenantId", "==", tenantId),
            where("projectId", "==", projectId),
            limit(100),
          ),
        ),
      ),
      ...(["aiActions", "actionReceipts", "communicationDrafts", "productEvents"].includes(collectionName)
        ? [
            getDocs(
              query(
                collection(firestore, collectionName),
                where("tenantId", "==", tenantId),
                where("projectId", "==", null),
                limit(100),
              ),
            ),
          ]
        : []),
    ]);
    const documents = snapshots.flatMap((snapshot) =>
      snapshot.docs.map(
        (document) =>
          ({ id: document.id, ...document.data() }) as TenantDocument,
      ),
    );
    return [
      ...new Map(documents.map((document) => [document.id, document])).values(),
    ];
  }
  const snapshot = await getDocs(
    query(
      collection(firestore, collectionName),
      where("tenantId", "==", tenantId),
      limit(100),
    ),
  );
  return snapshot.docs.map(
    (document) => ({ id: document.id, ...document.data() }) as TenantDocument,
  );
}

async function cachedTenantDocuments(
  collectionName: string,
  tenantId: string,
  role: Role | null,
  projectIds: string[],
): Promise<TenantDocument[]> {
  const key = tenantRecordsKey(collectionName, tenantId, role, projectIds);
  const cached = tenantRecordsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.records;
  const pending = tenantRecordsRequests.get(key);
  if (pending) return pending;

  const request = withTimeout(
    tenantDocuments(collectionName, tenantId, role, projectIds),
    tenantRecordsRequestTimeoutMs,
    `The ${collectionName} request took too long. Check your connection and try again.`,
  )
    .catch(async (caught: unknown) => {
      if (!["studio_owner", "studio_admin"].includes(String(role))) throw caught;
      return getStudioRecords({
        collection: collectionName,
        tenantId,
        projectScoped: projectScopedCollections.has(collectionName),
      }) as Promise<TenantDocument[]>;
    })
    .then((records) => {
      tenantRecordsCache.set(key, {
        records,
        expiresAt: Date.now() + tenantRecordsCacheTtlMs,
      });
      return records;
    })
    .finally(() => {
      tenantRecordsRequests.delete(key);
    });
  tenantRecordsRequests.set(key, request);
  return request;
}

/**
 * Cache invalidation for writes made elsewhere in the UI.
 *
 * The tenant-record cache exists so a page can read a dozen collections for
 * one request each. That same cache means a command's effect (a logged
 * consultation, a new task) would not appear for up to its TTL. Calling
 * this after a successful write clears the cached entries and re-runs every
 * mounted reader, so the surface that triggered the change shows it.
 */
let tenantRecordsGeneration = 0;
const tenantRecordsListeners = new Set<() => void>();

export function refreshTenantRecords(...collectionNames: string[]): void {
  if (collectionNames.length === 0) tenantRecordsCache.clear();
  else
    for (const key of [...tenantRecordsCache.keys()])
      if (collectionNames.some((name) => key.startsWith(`${name}:`)))
        tenantRecordsCache.delete(key);
  tenantRecordsGeneration += 1;
  for (const listener of tenantRecordsListeners) listener();
}

export function useTenantDocuments(
  collectionName: string,
  options: { enabled?: boolean } = {},
) {
  const workspace = useWorkspace();
  const enabled = options.enabled ?? true;
  const [records, setRecords] = useState<TenantDocument[] | null>(() =>
    dataIsLive ? null : enabled ? demoTenantDocuments(collectionName) : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(tenantRecordsGeneration);
  useEffect(() => {
    const listener = () => setGeneration(tenantRecordsGeneration);
    tenantRecordsListeners.add(listener);
    return () => {
      tenantRecordsListeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!enabled) {
      queueMicrotask(() => {
        setRecords([]);
        setError(null);
      });
      return;
    }
    if (!dataIsLive) {
      queueMicrotask(() => {
        setRecords(demoTenantDocuments(collectionName));
        setError(null);
      });
      return;
    }
    if (workspace.loading) return;
    if (!workspace.tenantId) return;
    let active = true;
    const key = tenantRecordsKey(
      collectionName,
      workspace.tenantId,
      workspace.role,
      workspace.projectIds,
    );
    const cached = tenantRecordsCache.get(key);
    void Promise.resolve().then(() => {
      if (!active) return;
      setRecords(
        cached && cached.expiresAt > Date.now() ? cached.records : null,
      );
      setError(null);
    });
    void cachedTenantDocuments(
      collectionName,
      workspace.tenantId,
      workspace.role,
      workspace.projectIds,
    )
      .then((value) => {
        if (active) setRecords(value);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setRecords([]);
        setError(
          caught instanceof Error
            ? caught.message
            : `The ${collectionName} could not be loaded.`,
        );
      });
    return () => {
      active = false;
    };
  }, [
    collectionName,
    enabled,
    generation,
    workspace.error,
    workspace.loading,
    workspace.projectIds,
    workspace.role,
    workspace.tenantId,
  ]);
  return {
    records,
    error:
      error ??
      (dataIsLive && !workspace.loading && !workspace.tenantId
        ? workspace.error ?? "No active studio was found."
        : null),
    loading:
      enabled &&
      dataIsLive &&
      (workspace.loading || (workspace.tenantId !== null && records === null)),
  };
}

export function LiveClientCards({
  q,
  view,
}: {
  q: string;
  view: string;
}) {
  const workspace = useWorkspace();
  const { records, error, loading } = useTenantDocuments("contacts");
  const {
    records: projectRecords,
    error: projectError,
    loading: loadingProjects,
  } = useTenantDocuments("projects");
  const [invitationsByContact, setInvitationsByContact] = useState<
    Record<string, ClientInvitationStatus[]>
  >({});
  const [invitationStatusErrorKey, setInvitationStatusErrorKey] = useState<
    string | null
  >(null);
  const values = (records ?? []).filter((contact) => {
    const contactTypes = Array.isArray(contact.contactTypes)
      ? contact.contactTypes.map(String)
      : [];
    const archived = Boolean(contact.archivedAt);
    const matchesView =
      view === "archived"
        ? archived
        : view === "prospects"
          ? !archived && contactTypes.includes("prospect")
          : !archived && contactTypes.includes("client");
    return (
      matchesView &&
      String(contact.displayName ?? "")
        .toLowerCase()
        .includes(q.toLowerCase())
    );
  })
    // Firestore document order is not an order a person recognises. It only
    // looks alphabetical here because the demo's ids happen to be built from
    // surnames; with real generated ids this list arrives shuffled. Same
    // failure the job list had, one collection over.
    .sort((left, right) =>
      String(left.displayName ?? "").localeCompare(
        String(right.displayName ?? ""),
        undefined,
        { sensitivity: "base" },
      ),
    );
  const projects = useMemo<ClientInviteProjectOption[]>(
    () =>
      (projectRecords ?? [])
        .map((project) => ({
          id: project.id,
          name: String(project.name ?? "Untitled project"),
          eventDate:
            typeof project.eventDate === "string" ? project.eventDate : null,
          state: String(project.state ?? ""),
        }))
        .filter((project) => project.state !== "ARCHIVED")
        .sort((left, right) =>
          String(left.eventDate ?? "").localeCompare(
            String(right.eventDate ?? ""),
          ),
        ),
    [projectRecords],
  );
  const inviteContactIds = values
    .filter(
      (contact) =>
        !contact.portalUserId && typeof contact.email === "string",
    )
    .map((contact) => contact.id)
    .slice(0, 100);
  const inviteContactIdsKey = inviteContactIds.join("|");

  useEffect(() => {
    if (
      !dataIsLive ||
      workspace.loading ||
      !workspace.tenantId ||
      !inviteContactIdsKey
    ) {
      return;
    }
    let active = true;
    void runClientInvitation({
      type: "status_batch",
      tenantId: workspace.tenantId,
      idempotencyKey: crypto.randomUUID(),
      input: { contactIds: inviteContactIdsKey.split("|") },
    })
      .then((result) => {
        if (!active) return;
        const raw =
          typeof result.invitationsByContact === "object" &&
          result.invitationsByContact !== null
            ? (result.invitationsByContact as Record<string, unknown>)
            : {};
        const parsed = Object.fromEntries(
          inviteContactIdsKey.split("|").map((contactId) => [
            contactId,
            (Array.isArray(raw[contactId]) ? raw[contactId] : [])
              .filter(
                (value): value is Record<string, unknown> =>
                  typeof value === "object" && value !== null,
              )
              .map((value) => ({
                invitationId: String(value.invitationId ?? ""),
                projectId: String(value.projectId ?? ""),
                status: String(value.status ?? ""),
                expiresAt: String(value.expiresAt ?? ""),
                lastSentAt:
                  typeof value.lastSentAt === "string"
                    ? value.lastSentAt
                    : null,
                sendCount: Number(value.sendCount ?? 0),
                deliveryStatus:
                  typeof value.deliveryStatus === "string"
                    ? value.deliveryStatus
                    : null,
                emailJobStatus:
                  typeof value.emailJobStatus === "string"
                    ? value.emailJobStatus
                    : null,
              })),
          ]),
        );
        setInvitationsByContact(parsed);
        setInvitationStatusErrorKey(null);
      })
      .catch(() => {
        if (active) setInvitationStatusErrorKey(inviteContactIdsKey);
      });
    return () => {
      active = false;
    };
  }, [inviteContactIdsKey, workspace.loading, workspace.tenantId]);
  if (loading)
    return (
      <LiveRecordsState
        kind="loading"
        state="Loading clients…"
        detail="Loading your client list."
      />
    );
  if (error)
    return (
      <LiveRecordsState
        kind="error"
        state="Clients could not be loaded"
        detail={error}
      />
    );
  if (!values.length)
    return (
      // "No matching" implies a filter was applied. Distinguish an empty search
      // from an empty list, and from an empty tab.
      <LiveRecordsState
        kind="empty"
        state={
          q
            ? `No clients match “${q}”`
            : view === "archived"
              ? "No archived clients"
              : view === "prospects"
                ? "No prospects yet"
                : "No clients yet"
        }
        detail={
          q
            ? "Try a different name or email, or clear the search."
            : "Add a client directly or convert an inquiry when you are ready to book."
        }
        action={
          q ? undefined : { href: "/studio/clients/new", label: "Add client" }
        }
      />
    );
  return (
    <>
      {values.map((client) => {
        const name = String(client.displayName ?? "Client");
        const email =
          typeof client.email === "string" ? client.email : null;
        const projectCount = Array.isArray(client.projectIds)
          ? client.projectIds.length
          : 0;
        const projectIds = Array.isArray(client.projectIds)
          ? client.projectIds.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        return (
          <article className="ds-people-row" key={client.id}>
            <span className="ds-people-avatar">
              {name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part.charAt(0))
                .join("")}
            </span>
            <span className="ds-people-copy">
              <strong>{name}</strong>
              <small>{email ?? "No email recorded"}</small>
            </span>
            <StatusBadge tone={client.portalUserId ? "success" : "neutral"}>
              {client.portalUserId ? "Portal active" : "Portal inactive"}
            </StatusBadge>
            <span className="ds-people-stat">
              <small>Projects</small>
              <strong>{projectCount}</strong>
            </span>
            <span className="ds-people-stat">
              <small>Company</small>
              <strong>{String(client.company ?? "—")}</strong>
            </span>
            {email ? (
              <a
                className="ds-people-message"
                href={`mailto:${email}`}
                aria-label={`Message ${name}`}
                title="Message client"
              >
                <Mail size={15} />
              </a>
            ) : (
              <span />
            )}
            {!client.portalUserId && email ? (
              <details className="ds-people-invite">
                <summary>Invite to client portal</summary>
                <div>
                  <ClientPortalInvite
                    contactId={client.id}
                    initialInvitations={invitationsByContact[client.id] ?? []}
                    invitationStatusError={invitationStatusErrorKey === inviteContactIdsKey}
                    loadingProjects={loadingProjects}
                    projectLoadError={Boolean(projectError)}
                    projectIds={projectIds}
                    projects={projects}
                  />
                </div>
              </details>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

function LiveRecordsState({
  kind,
  state,
  detail,
  action,
}: {
  kind: "loading" | "error" | "empty";
  state: string;
  detail: string;
  action?: { href: string; label: string };
}) {
  const Icon =
    kind === "loading" ? LoaderCircle : kind === "error" ? DatabaseZap : Inbox;
  return (
    <div className={`live-record-state live-record-${kind}`} role="row">
      <Icon aria-hidden="true" size={18} />
      <span>
        <strong>{state}</strong>
        <small>{detail}</small>
      </span>
      {action ? (
        <Link className="live-state-action" href={action.href}>
          {action.label} <ArrowRight size={14} />
        </Link>
      ) : null}
    </div>
  );
}

export function LiveProjectRows({
  type,
  view,
}: {
  type: string;
  view: string;
}) {
  const { records, error, loading } = useTenantDocuments("projects");
  // The same journey engine Today runs, so the two screens can never name
  // different next steps for the same job. The document cache is shared, so
  // this costs no extra reads.
  const { journeys } = useTodayInbox();
  const journeyById = new Map(
    journeys.map((position) => [position.projectId, position]),
  );
  // What a job is worth and what is still owed — the two questions this
  // table exists to answer and could not. Both collections are already in
  // the shared document cache, so reading them here costs nothing.
  const snapshots = useTenantDocuments("packageSnapshots");
  const invoices = useTenantDocuments("invoiceReferences");
  const snapshotTotals = new Map(
    (snapshots.records ?? []).map((row) => [
      row.id,
      Number(row.totalCents ?? 0),
    ]),
  );
  const today = new Date().toISOString().slice(0, 10);
  const owed = new Map<string, { cents: number; overdue: boolean }>();
  for (const invoice of invoices.records ?? []) {
    const balance = Number(invoice.balanceCents ?? 0);
    if (balance <= 0) continue;
    if (["voided", "refunded", "paid"].includes(String(invoice.status)))
      continue;
    const projectId = String(invoice.projectId ?? "");
    if (!projectId) continue;
    const due = String(invoice.dueDate ?? "").slice(0, 10);
    const prior = owed.get(projectId) ?? { cents: 0, overdue: false };
    owed.set(projectId, {
      cents: prior.cents + balance,
      overdue: prior.overdue || (Boolean(due) && due < today),
    });
  }
  const values = records
    ? records
        .filter((item) =>
          view === "archived"
            ? item.state === "ARCHIVED"
            : item.state !== "ARCHIVED",
        )
        .filter(
          (item) =>
            type === "all" || String(item.eventType).toLowerCase() === type,
        )
        // Nearest wedding first — never document order. See job-order.ts.
        .sort((left, right) => compareJobsForList(left, right))
        .map((item) => {
          const position = journeyById.get(item.id);
          const balance = owed.get(item.id) ?? null;
          return {
            id: item.id,
            name: String(item.name),
            event: String(item.eventType),
            date: String(item.eventDate ?? "")
              ? `${formatEventDate(item.eventDate)} · ${describeEventProximity(item.eventDate)}`
              : "Date to confirm",
            venue: String(item.venueName ?? item.city ?? "Location pending"),
            state: String(item.state),
            readiness: Number(item.readinessScore ?? 0),
            valueCents:
              snapshotTotals.get(String(item.packageSnapshotId ?? "")) ?? null,
            owedCents: balance?.cents ?? null,
            owedOverdue: balance?.overdue ?? false,
            // The real outstanding step, not a generic instruction repeated
            // down the column — including on jobs that are already finished.
            nextAction:
              position?.actionLabel ??
              position?.stepTitle ??
              String(item.nextAction ?? "Nothing outstanding"),
            owner: position
              ? position.owner === "studio"
                ? "You"
                : position.owner === "client"
                  ? "Waiting on the client"
                  : "In motion"
              : "Nothing due",
          };
        })
    : view === "archived"
      ? []
      : crmProjects.filter(
          (project) => type === "all" || project.event.toLowerCase() === type,
        );
  if (loading) {
    return (
      <LiveRecordsState
        kind="loading"
        state="Loading projects…"
        detail="Reading records from your active studio."
      />
    );
  }
  if (error) {
    return (
      <LiveRecordsState
        kind="error"
        state="Projects could not be loaded"
        detail={error}
      />
    );
  }
  if (values.length === 0) {
    return (
      <LiveRecordsState
        kind="empty"
        state="No projects in this view"
        detail="Create your first project or change the active filters."
        action={{ href: "/studio/projects/new", label: "Create project" }}
      />
    );
  }
  return (
    <>
      {values.map((project) => (
        <article key={project.id}>
          <span className="crm-primary">
            <strong>{project.name}</strong>
            <small>{project.event}</small>
          </span>
          <span>
            <strong>{project.date}</strong>
            <small>{project.venue}</small>
          </span>
          {/* The chip says how this one job is doing; the track says where
              it sits in the season. A column of chips that all read
              "advancing" was three different moments wearing one green. */}
          <span className="state-cell">
            <StatusBadge tone={stateTone(project.state)}>
              {projectStateLabel(project.state)}
            </StatusBadge>
            <PhaseTrack state={project.state} />
          </span>
          {/* What the job is worth, and what is still owed on it — the two
              questions a photographer scans this list for. Readiness moved
              to the job itself, where it has the checkpoints to explain it. */}
          <span className="value-cell">
            <strong>
              {"valueCents" in project && project.valueCents
                ? formatCents(project.valueCents)
                : "—"}
            </strong>
            {"owedCents" in project && project.owedCents ? (
              <small className={project.owedOverdue ? "is-overdue" : undefined}>
                {formatCents(project.owedCents)}{" "}
                {project.owedOverdue ? "overdue" : "outstanding"}
              </small>
            ) : "valueCents" in project && project.valueCents ? (
              <small>paid up</small>
            ) : (
              // No package locked yet, so there is nothing to owe. "Paid up"
              // on a job that was never invoiced is a small lie.
              <small>not booked yet</small>
            )}
          </span>
          <span>
            <strong>{project.nextAction}</strong>
            <small>{project.owner}</small>
          </span>
          <Link
            href={`/studio/projects/${project.id}`}
            aria-label={`Open ${project.name}`}
          >
            <ArrowRight size={16} />
          </Link>
        </article>
      ))}
    </>
  );
}
export function LiveLeadRows({ view, q }: { view: string; q: string }) {
  const { records, error, loading } = useTenantDocuments("leads");
  const values = records
    ? records
        .filter((item) =>
          view === "open"
            ? !["converted", "lost"].includes(String(item.status))
            : String(item.status) === view,
        )
        .filter((item) =>
          String(item.displayName ?? item.firstName ?? "")
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
        // Longest-waiting first. This list had no sort at all, so it came back
        // in Firestore's order and put a 5-day-old inquiry below a 2-day-old
        // one — the studio's most perishable asset, last.
        .sort(byLongestWaiting((item) => item.createdAt))
        .map((item) => ({
          id: item.id,
          name: String(
            item.displayName ??
              `${item.firstName ?? ""} ${item.lastName ?? ""}`,
          ),
          age: formatDueDate(String(item.createdAt)),
          // How long it has been sitting there, which is the reason to open it.
          // Today computes this and the list that exists to work leads did not.
          waiting: waitingLabel(item.createdAt),
          event: String(item.eventType ?? "Event"),
          // Was `String(item.eventDate)`, printing a raw `2027-07-01` while
          // every other surface said "Jul 1, 2027".
          date: formatEventDate(item.eventDate),
          venue: String(item.venue ?? item.city ?? "Venue pending"),
          source: String(item.referralSource ?? "Direct"),
          status: String(item.status ?? "new"),
          missing: Array.isArray(item.missingFields)
            ? item.missingFields.length
            : 0,
        }))
    : view === "open"
      ? crmLeads.filter((lead) =>
          lead.name.toLowerCase().includes(q.toLowerCase()),
        )
      : [];
  if (loading) {
    return (
      <LiveRecordsState
        kind="loading"
        state="Loading leads…"
        detail="Loading your inquiries."
      />
    );
  }
  if (error) {
    return (
      <LiveRecordsState
        kind="error"
        state="Leads could not be loaded"
        detail={error}
      />
    );
  }
  if (values.length === 0) {
    return (
      <LiveRecordsState
        kind="empty"
        state="No inquiries in this view"
        detail="Share your studio inquiry form or change the active filter."
      />
    );
  }
  return (
    <>
      {values.map((lead) => (
        <article key={lead.id}>
          <span className="crm-primary">
            <strong>{lead.name}</strong>
            <small>
              Received {lead.age}
              {"waiting" in lead && lead.waiting ? ` · ${lead.waiting}` : ""}
            </small>
          </span>
          <span>
            <strong>
              {lead.event} · {lead.date}
            </strong>
            <small>{lead.venue}</small>
          </span>
          <span>{lead.source}</span>
          <span>
            <StatusBadge tone={stateTone(lead.status)} dot>
              {lead.status}
            </StatusBadge>
            {lead.missing > 0 ? (
              <small>
                {lead.missing} detail{lead.missing > 1 ? "s" : ""} missing
              </small>
            ) : null}
          </span>
          <Link
            href={`/studio/leads/${lead.id}`}
            aria-label={`Open ${lead.name}`}
          >
            <ArrowUpRight size={16} />
          </Link>
        </article>
      ))}
    </>
  );
}

export function LiveLeadDetail({ id }: { id: string }) {
  const { records, error, loading } = useTenantDocuments("leads");
  const aiState = useTenantDocuments("aiActions");
  const liveLead = records?.find((item) => item.id === id);
  const demoLead = !dataIsLive
    ? crmLeads.find((item) => item.id === id)
    : null;
  const lead = liveLead ?? (demoLead as TenantDocument | undefined);
  if (loading)
    return <LiveRecordsState kind="loading" state="Loading inquiry…" detail="Opening the latest client details." />;
  if (error)
    return <LiveRecordsState kind="error" state="Inquiry could not be loaded" detail={error} />;
  if (!lead)
    return (
      <div className="live-detail-page">
        <Link className="back-link" href="/studio/leads"><ArrowLeft /> Back to inquiries</Link>
        <LiveRecordsState kind="empty" state="Inquiry not found" detail="It may have been converted, archived, or removed." />
      </div>
    );
  const fullName = String(
    lead.displayName ??
      lead.name ??
      `${lead.firstName ?? ""} ${lead.lastName ?? ""}`,
  ).trim() || "New inquiry";
  const missingSource = lead.missingInformation ?? lead.missingFields;
  const missing = Array.isArray(missingSource)
    ? missingSource.map(String)
    : [];
  const questions = Array.isArray(lead.suggestedConsultationQuestions)
    ? lead.suggestedConsultationQuestions.map(String)
    : [];
  const email = typeof lead.email === "string" ? lead.email : "";
  const phone = typeof lead.phone === "string" ? lead.phone : "";
  const replyAction = (aiState.records ?? []).find(
    (action) =>
      action.capability === "inquiry_reply_draft" &&
      Array.isArray(action.sourceReferences) &&
      action.sourceReferences.some((reference) => {
        if (
          typeof reference !== "object" ||
          reference === null ||
          Array.isArray(reference)
        )
          return false;
        return (reference as Record<string, unknown>).entityId === id;
      }),
  );
  const replyOutput =
    replyAction?.structuredOutput &&
    typeof replyAction.structuredOutput === "object" &&
    !Array.isArray(replyAction.structuredOutput)
      ? (replyAction.structuredOutput as Record<string, unknown>)
      : null;
  return (
    <div className="live-detail-page lead-detail-page">
      <Link className="back-link" href="/studio/leads"><ArrowLeft /> Back to inquiries</Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Client inquiry</p>
          <h1>{fullName}</h1>
          <p>{String(lead.eventType ?? "Photography")} inquiry for {String(lead.eventDate ?? "a date to be confirmed")}.</p>
        </div>
        <StatusBadge tone={stateTone(String(lead.status ?? ""))}>
          {statusLabel(lead.status ?? "new")}
        </StatusBadge>
      </header>
      <div className="lead-action-row">
        {!replyAction && String(lead.status) !== "converted" ? (
          <DraftReplyButton leadId={lead.id} />
        ) : null}
        {String(lead.status) !== "converted" ? (
          <ConvertInquiryButton lead={lead} />
        ) : lead.projectId ? (
          <Link
            className="button button-dark"
            href={`/studio/projects/${String(lead.projectId)}`}
          >
            Open project <ArrowRight />
          </Link>
        ) : null}
        {email ? <a className="button button-dark" href={`mailto:${email}`}><Mail /> Email client</a> : null}
        {phone ? <a className="button button-light" href={`tel:${phone}`}><Phone /> Call client</a> : null}
      </div>
      <section className="lead-detail-grid">
        <article className="panel lead-detail-card">
          <div className="panel-heading"><div><h2>Contact</h2><p>How to follow up</p></div></div>
          <dl>
            <div><dt>Email</dt><dd>{email || "Not provided"}</dd></div>
            <div><dt>Phone</dt><dd>{phone || "Not provided"}</dd></div>
            <div><dt>Partner or contact</dt><dd>{String(lead.partnerName ?? "Not provided")}</dd></div>
          </dl>
        </article>
        <article className="panel lead-detail-card">
          <div className="panel-heading"><div><h2>Event</h2><p>What they shared</p></div></div>
          <dl>
            <div><dt>Date</dt><dd><CalendarDays /> {String(lead.eventDate ?? "Not provided")}</dd></div>
            <div><dt>Location</dt><dd><MapPin /> {String(lead.venue ?? lead.city ?? "Not provided")}</dd></div>
            <div><dt>Budget</dt><dd>{String(lead.budgetRange ?? "Not provided")}</dd></div>
            <div><dt>Source</dt><dd>{String(lead.referralSource ?? "Direct")}</dd></div>
          </dl>
        </article>
      </section>
      {typeof lead.message === "string" && lead.message ? (
        <section className="panel lead-message-card">
          <div className="panel-heading"><div><h2>Client message</h2><p>Submitted with the inquiry</p></div></div>
          <p>{lead.message}</p>
        </section>
      ) : null}
      {typeof lead.aiSummary === "string" && lead.aiSummary ? (
        <section className="panel lead-message-card">
          <div className="panel-heading">
            <div>
              <h2>Inquiry brief</h2>
              <p>AI-assisted summary. Verify details against the original inquiry.</p>
            </div>
          </div>
          <p>{lead.aiSummary}</p>
        </section>
      ) : null}
      {replyAction && replyOutput ? (
        <section className="lead-ai-reply-card">
          <header>
            <span><Sparkles size={16} /></span>
            <div>
              <p className="eyebrow">AI-prepared · unsent</p>
              <h2>Personalized inquiry reply</h2>
            </div>
            <StatusBadge
              tone={replyAction.status === "approved" ? "success" : "warning"}
            >
              {statusLabel(replyAction.status)}
            </StatusBadge>
          </header>
          <div>
            <small>Subject</small>
            <strong>{String(replyOutput.subject ?? "Inquiry follow-up")}</strong>
            <p>{String(replyOutput.body ?? "")}</p>
          </div>
          <footer>
            <span>
              <ShieldCheck size={14} />
              Grounded in the original inquiry. No availability or pricing was
              invented.
            </span>
            <Link href="/studio/ai-queue">
              Review, edit, or approve <ArrowRight size={14} />
            </Link>
          </footer>
        </section>
      ) : null}
      <section className="lead-detail-grid">
        <article className="panel lead-insight-card">
          <h2>Before the consultation</h2>
          {missing.length ? (
            <ul>{missing.map((item) => <li key={item}>{item.replaceAll("_", " ")}</li>)}</ul>
          ) : <p>The essential intake details are complete.</p>}
        </article>
        <article className="panel lead-insight-card">
          <h2>Suggested questions</h2>
          {questions.length ? (
            <ul>{questions.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>Ask about priorities, timing, locations, and who will approve the final plan.</p>}
        </article>
      </section>
    </div>
  );
}

function DraftReplyButton({ leadId }: { leadId: string }) {
  const workspace = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function draft() {
    if (!workspace.tenantId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await requestMessageDraft({
        tenantId: workspace.tenantId,
        trigger: "inquiry_reply",
        leadId,
      });
      if (result.mode === "preview") {
        setNotice(
          "Preview: a personalized reply draft would be prepared for review.",
        );
      } else {
        setNotice("Reply drafted — it's waiting in your review queue.");
        router.refresh();
      }
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
    <>
      <button
        className="button button-dark"
        disabled={busy}
        onClick={() => void draft()}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" /> : <Sparkles />}
        {busy ? "Drafting reply…" : "Review reply"}
      </button>
      {notice ? <small className="lead-action-notice" role="status">{notice}</small> : null}
    </>
  );
}

/**
 * Turn the inquiry itself into a client record.
 *
 * The lead already holds everything `createContact` needs — a website form
 * captures a name and an email before it captures anything else — so the
 * conversion never has to stop and ask.
 */
async function createContactFromLead(
  lead: TenantDocument,
  displayName: string,
): Promise<string> {
  const parts = displayName.split(/\s+/).filter(Boolean);
  const firstName =
    (typeof lead.firstName === "string" && lead.firstName) || parts[0] || "Client";
  const lastName =
    (typeof lead.lastName === "string" && lead.lastName) ||
    parts.slice(1).join(" ") ||
    // createContact requires a surname; the inquiry's own event is a more
    // useful placeholder than an empty string the studio has to clean up.
    String(lead.eventTypeLabel ?? lead.eventType ?? "Inquiry");
  const created = await runCrmCommand("createContact", {
    firstName,
    lastName,
    email: typeof lead.email === "string" && lead.email ? lead.email : null,
    phone: typeof lead.phone === "string" && lead.phone ? lead.phone : null,
    company: null,
    contactTypes: ["client"],
  });
  const contactId = String(created.result.contactId ?? "");
  if (!contactId)
    throw new Error("We couldn't create the client record for this inquiry.");
  return contactId;
}

function ConvertInquiryButton({ lead }: { lead: TenantDocument }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function convert() {
    setBusy(true);
    setNotice(null);
    try {
      const eventTypeLabel = String(
        lead.eventTypeLabel ?? lead.eventType ?? "Wedding",
      );
      const displayName = String(
        lead.displayName ??
          `${String(lead.firstName ?? "")} ${String(lead.lastName ?? "")}`,
      ).trim();
      // A web inquiry arrives before the couple is anyone in the address
      // book, so most leads carry no contact at all. Creating the client from
      // what they already told us is the whole point of "convert" — asking
      // the photographer to go and make one first (or worse, failing with
      // CLIENT_NOT_FOUND) is how this used to dead-end.
      const contactId =
        typeof lead.primaryContactId === "string" && lead.primaryContactId
          ? lead.primaryContactId
          : await createContactFromLead(lead, displayName);

      const response = await runCrmCommand("createProject", {
        name: `${displayName || "Client"} ${eventTypeLabel}`.trim(),
        eventTypeId: String(lead.eventTypeId ?? eventTypeLabel.toLowerCase()),
        eventType: eventTypeLabel,
        eventDate: String(lead.eventDate),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clientContactIds: [contactId],
        leadPhotographerId: null,
        leadId: lead.id,
        venueName:
          typeof lead.venue === "string" && lead.venue ? lead.venue : null,
        city: typeof lead.city === "string" && lead.city ? lead.city : null,
      });
      const projectId = String(response.result.projectId ?? "");
      if (response.persisted && projectId) {
        router.push(`/studio/projects/${projectId}`);
        router.refresh();
      } else {
        setNotice("Preview: this inquiry would become a project.");
      }
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "The inquiry could not be converted.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="button button-dark"
        disabled={busy}
        onClick={() => void convert()}
        type="button"
      >
        {busy ? "Creating project…" : "Convert to project"} <ArrowRight />
      </button>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </>
  );
}
export function LiveUpcomingRows({ limit = 5 }: { limit?: number } = {}) {
  const { records: allRecords, error, loading } =
    useTenantDocuments("projects");
  const records = allRecords
    ? allRecords
        .filter(
          (item) =>
            !["ARCHIVED", "CANCELLED", "CLOSED"].includes(String(item.state)),
        )
        .sort((a, b) => {
          const readinessDifference =
            Number(a.readinessScore ?? 0) - Number(b.readinessScore ?? 0);
          return readinessDifference !== 0
            ? readinessDifference
            : String(a.eventDate).localeCompare(String(b.eventDate));
        })
        .slice(0, limit)
    : null;
  const values = records
    ? records.map((item, index) => ({
        id: item.id,
        client: String(item.name),
        event: String(item.eventType),
        date: String(item.eventDate ?? "")
          ? `${formatEventDate(item.eventDate)} · ${describeEventProximity(item.eventDate)}`
          : "Date to confirm",
        state: String(item.state),
        readiness: Number(item.readinessScore ?? 0),
        blocker: String(item.nextAction ?? "Review readiness"),
        owner: "Assigned team",
        tone: ["sand", "lilac", "blue", "green", "amber"][index % 5],
      }))
    : demoProjects;
  if (loading) {
    return (
      <LiveRecordsState
        kind="loading"
        state="Loading upcoming projects…"
        detail="Calculating your next operational priorities."
      />
    );
  }
  if (error) {
    return (
      <LiveRecordsState
        kind="error"
        state="Upcoming projects could not be loaded"
        detail={error}
      />
    );
  }
  if (values.length === 0) {
    return (
      <LiveRecordsState
        kind="empty"
        state="No upcoming projects"
        detail="Active projects will appear here in event-date order."
      />
    );
  }
  return (
    <>
      {values.map((project) => (
        <Link
          className="project-table-row"
          role="row"
          href={`/studio/projects/${project.id}`}
          key={project.id}
        >
          <span className="project-name" role="cell">
            <span className={`project-avatar avatar-${project.tone}`}>
              {project.client.charAt(0)}
            </span>
            <span>
              <strong>{project.client}</strong>
              <small>{project.event}</small>
            </span>
          </span>
          <time role="cell">{project.date}</time>
          <span role="cell">
            <StatusBadge tone={stateTone(project.state)} dot>
              {project.state.replaceAll("_", " ")}
            </StatusBadge>
          </span>
          <span className="readiness-cell" role="cell">
            <ReadinessMeter value={project.readiness} size="sm" />
            <strong>{project.readiness}%</strong>
          </span>
          <span className="blocker-cell" role="cell">
            {project.readiness === 100 ? (
              <CircleCheck size={16} className="text-success" />
            ) : (
              <Clock3 size={16} />
            )}
            <span>
              <strong>{project.blocker}</strong>
              <small>{project.owner}</small>
            </span>
            <ChevronRight size={16} />
          </span>
        </Link>
      ))}
    </>
  );
}
