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
import {
  crewAssignments as demoCrewAssignments,
  crewProfiles as demoCrewProfiles,
  crewSchedule as demoCrewSchedule,
} from "@/config/crew-demo-data";
import {
  consultations as demoConsultations,
  contracts as demoContracts,
  invoices as demoInvoices,
  proposals as demoProposals,
} from "@/config/booking-demo-data";
import {
  coiCases as demoInsuranceCases,
  questionnaires as demoQuestionnaires,
} from "@/config/planning-demo-data";
import {
  automationRuns as demoAutomationRuns,
  readinessProjects as demoReadinessProjects,
} from "@/config/workflow-demo-data";
import type { Role } from "@/features/auth/roles";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";
import { getStudioRecords } from "@/lib/studio/records-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { stateTone } from "@/lib/status-tone";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ClientPortalInvite,
  type ClientInvitationStatus,
  type ClientInviteProjectOption,
} from "@/components/clients/client-portal-invite";
import { runClientInvitation } from "@/lib/client/invitation-client";
export type TenantDocument = Record<string, unknown> & { id: string };

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

function demoIsoDate(value: string): string {
  const parsed = new Date(`${value} 12:00:00`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toISOString().slice(0, 10);
}

function demoProjectId(name: string): string {
  const exact = crmProjects.find((project) => project.name === name);
  if (exact) return exact.id;
  if (name.toLowerCase().includes("hudson")) return "PRJ-2072";
  return crmProjects[0]?.id ?? "PRJ-2048";
}

function demoDateTime(date: string, time: string): string {
  const parsed = new Date(`${date} ${time}`);
  return Number.isNaN(parsed.valueOf())
    ? new Date().toISOString()
    : parsed.toISOString();
}

export function demoTenantDocuments(collectionName: string): TenantDocument[] {
  switch (collectionName) {
    case "projects":
      return crmProjects.map((project) => ({
        id: project.id,
        name: project.name,
        eventType: project.event,
        eventDate: demoIsoDate(project.date),
        venueName: project.venue,
        city: "New York",
        state: project.state,
        readinessScore: project.readiness,
        nextAction: project.nextAction,
        leadPhotographerName: project.owner,
      }));
    case "leads":
      return crmLeads.map((lead, index) => ({
        id: lead.id,
        displayName: lead.name,
        name: lead.name,
        eventType: lead.event,
        eventDate: demoIsoDate(lead.date),
        venue: lead.venue,
        venueName: lead.venue,
        referralSource: lead.source,
        status: lead.status.toLowerCase(),
        assignedToName: lead.assigned,
        createdAt: new Date(Date.now() - index * 86_400_000).toISOString(),
        email:
          index === 0
            ? "lena.ortiz@example.test"
            : index === 1
              ? "events@hearthwell.example.test"
              : "noah.elise@example.test",
        phone: index === 2 ? "" : index === 0 ? "+1 212 555 0187" : "+1 646 555 0144",
        missingFields:
          lead.missing === 0
            ? []
            : index === 0
              ? ["budget range"]
              : ["phone number", "confirmed venue", "budget range"],
      }));
    case "crewProfiles":
      return demoCrewProfiles.map((profile, index) => ({
        id: profile.id,
        name: profile.name,
        active: true,
        specialties: profile.specialties.split(" · ").map((value) => value.toLowerCase()),
        serviceAreas: [profile.area],
        travelRadiusMiles: 100,
        preferenceRank: index + 1,
        w9Status: "complete",
        insuranceStatus: profile.documents === "Complete" ? "complete" : "attention_required",
        contractStatus: "complete",
        rateCents: index === 0 ? 80000 : index === 1 ? 65000 : 95000,
      }));
    case "crewAssignments":
      return demoCrewAssignments.map((assignment) => ({
        id: assignment.id,
        projectId: demoProjectId(assignment.project),
        crewProfileId:
          demoCrewProfiles.find((profile) => profile.name === assignment.crew)?.id ?? "",
        crewName: assignment.crew,
        role: assignment.role,
        status: assignment.status.toLowerCase(),
        arrivalAt: demoDateTime(assignment.date, assignment.arrival),
        departureAt: demoDateTime(assignment.date, assignment.departure),
        acknowledgedScheduleVersion: assignment.status === "Accepted" ? 3 : 0,
      }));
    case "schedules": {
      const project = crmProjects[0]!;
      const eventDate = demoIsoDate(project.date);
      return [{
        id: "schedule-demo-prj-2048",
        projectId: project.id,
        projectName: project.name,
        status: "published",
        version: 4,
        items: demoCrewSchedule.map((item, index) => ({
          id: `schedule-item-${index + 1}`,
          title: item.title,
          location: item.location,
          startAt: demoDateTime(eventDate, item.time),
          endAt: demoDateTime(eventDate, item.end),
        })),
      }];
    }
    case "questionnaireResponses":
      return demoQuestionnaires.map((questionnaire, index) => ({
        id: `questionnaire-demo-${index + 1}`,
        projectId: demoProjectId(questionnaire.project),
        projectName: questionnaire.project,
        templateName: questionnaire.template,
        completionPercent: questionnaire.progress,
        status: questionnaire.status.toLowerCase().replaceAll(" ", "_"),
        dueDate: questionnaire.due === "Complete" ? null : questionnaire.due,
        missingInformation:
          questionnaire.missing === "None" ? [] : [questionnaire.missing],
      }));
    case "readinessAssessments":
      return demoReadinessProjects.map((item) => ({
        id: `readiness-${item.id}`,
        projectId: item.id,
        score: item.score,
        ready: item.ready,
      }));
    case "insuranceRequests":
      return demoInsuranceCases.map((item, index) => ({
        id: `insurance-demo-${index + 1}`,
        projectId: demoProjectId(item.project),
        projectName: item.project,
        venueName: item.venue,
        status:
          item.status === "Approved"
            ? "sent_to_venue"
            : item.status === "Correction required"
              ? "correction_required"
              : "under_review",
      }));
    case "invoiceReferences":
      return demoInvoices.map((invoice) => ({
        id: invoice.id,
        projectId: demoProjectId(invoice.project),
        projectName: invoice.project,
        kind: invoice.kind,
        amountCents: Math.round(Number(invoice.amount.replace(/[$,]/g, "")) * 100),
        balanceCents: Math.round(Number(invoice.balance.replace(/[$,]/g, "")) * 100),
        status: invoice.status.toLowerCase(),
      }));
    case "consultations":
      return demoConsultations.map((item) => ({
        ...item,
        projectId: demoProjectId(item.project),
        status: item.status.toLowerCase(),
      }));
    case "proposals":
      return demoProposals.map((item) => ({
        ...item,
        projectId: demoProjectId(item.project),
        status: item.status.toLowerCase(),
      }));
    case "contracts":
      return demoContracts.map((item) => ({
        ...item,
        projectId: demoProjectId(item.project),
        status: item.status === "Completed" ? "completed" : "sent",
      }));
    case "automationRuns":
      return demoAutomationRuns.map((item) => ({
        ...item,
        projectId: demoProjectId(item.project),
        status: item.status === "Succeeded" ? "completed" : "retry_scheduled",
      }));
    default:
      return [];
  }
}

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
  });
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
      <LiveRecordsState
        kind="empty"
        state="No matching clients"
        detail="Add a client directly or convert an inquiry when you are ready to book."
        action={{ href: "/studio/clients/new", label: "Add client" }}
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
        .map((item) => ({
          id: item.id,
          name: String(item.name),
          event: String(item.eventType),
          date: String(item.eventDate),
          venue: String(item.venueName ?? item.city ?? "Location pending"),
          state: String(item.state),
          readiness: Number(item.readinessScore ?? 0),
          nextAction: String(item.nextAction ?? "Review project readiness"),
          owner: "Assigned team",
        }))
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
          <span>
            <StatusBadge tone={stateTone(project.state)}>
              {project.state.replaceAll("_", " ")}
            </StatusBadge>
          </span>
          <span className="readiness-cell">
            <ReadinessMeter value={project.readiness} size="sm" />
            <small>{project.readiness === 100 ? "Ready" : "Not ready"}</small>
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
        .map((item) => ({
          id: item.id,
          name: String(
            item.displayName ??
              `${item.firstName ?? ""} ${item.lastName ?? ""}`,
          ),
          age: new Date(String(item.createdAt)).toLocaleDateString(),
          event: String(item.eventType ?? "Event"),
          date: String(item.eventDate ?? "Date pending"),
          venue: String(item.venue ?? item.city ?? "Venue pending"),
          source: String(item.referralSource ?? "Direct"),
          assigned: String(item.assignedUserName ?? "Unassigned"),
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
            <small>Received {lead.age}</small>
          </span>
          <span>
            <strong>
              {lead.event} · {lead.date}
            </strong>
            <small>{lead.venue}</small>
          </span>
          <span>{lead.source}</span>
          <span>{lead.assigned}</span>
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
          {String(lead.status ?? "new").replaceAll("_", " ")}
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
              {String(replyAction.status).replaceAll("_", " ")}
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
      const response = await runCrmCommand("createProject", {
        name: `${displayName || "Client"} ${eventTypeLabel}`.trim(),
        eventTypeId: String(
          lead.eventTypeId ?? eventTypeLabel.toLowerCase(),
        ),
        eventType: eventTypeLabel,
        eventDate: String(lead.eventDate),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clientContactIds: [String(lead.primaryContactId)],
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
        date: String(item.eventDate),
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
