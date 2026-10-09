"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  Send,
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
import { isPutAway, liveProjects } from "@/features/projects/put-away";
import { formatCents } from "@/lib/format/money";
import { useTodayInbox } from "@/components/today/use-today-inbox";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { preBookingStates } from "@/features/inquiries/stages";
import { describeProviderFailure } from "@/features/today/provider-failure";
import { jobKindOf } from "@/features/job-kinds/job-kinds";
import { jobValueCents } from "@/features/packages/job-packages";
import {
  ClientPortalInvite,
  type ClientInvitationStatus,
  type ClientInviteProjectOption,
} from "@/components/clients/client-portal-invite";
import { runClientInvitation } from "@/lib/client/invitation-client";
import {
  clientListEmptyState,
  clientListView,
  searchClientList,
} from "@/features/contacts/client-search";
export type TenantDocument = Record<string, unknown> & { id: string };

import { demoTenantDocuments } from "@/features/live/demo-records";
import { describeEventProximity, formatDueDate, formatEventDate, todayLocalIso } from "@/lib/format/event-date";

import {
  byLongestWaiting,
  waitingLabel,
} from "@/features/ordering/attention";
import { statusLabel } from "@/features/format/status-label";
import { friendlyError } from "@/lib/ai/friendly-error";
import { leadIntakeGaps } from "@/features/crm/lead-intake";
import { billingAddressOf, ClientRecordActions } from "@/components/clients/client-record-actions";
import { billingAddressOrigin, coupleConfirmed, formatBillingAddress } from "@/features/contacts/billing-address-signing";
import { cacheEntryPredatesWrite } from "@/lib/live/record-writes";
import {
  InferredTag,
  LeadDetailsEditor,
  MaybeInquiryPrompt,
  leadSourceLabel,
} from "@/components/leads/lead-capture-review";
import { ignorableSenderOf } from "@/features/intake/not-inquiry";
import { leadAnswers } from "@/features/leads/lead-answers";
import { InquiryRestore, ProjectInquiryClose } from "@/components/projects/project-inquiry-close";
import { TRADE_LABELS, tradeOf, tradeVocab } from "@/features/trades/trades";
import { callWords } from "@/components/studio/trade-words";

// Re-exported so existing importers of this module keep working.
export { demoTenantDocuments };

const tenantRecordsCacheTtlMs = 15_000;
const tenantRecordsRequestTimeoutMs = 12_000;
const tenantRecordsCache = new Map<
  string,
  { records: TenantDocument[]; cachedAt: number; expiresAt: number }
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
  "crewMessages",
  "crewCascades",
  "crewStaffingPlans",
  "albumWorkflows",
  "projectCloseouts",
  "messages",
  "conversations",
  "packageRequests",
  "billingAddressRequests",
  "detailChangeRequests",
  "clientShotLists",
  "detailSignoffs",
  "bookingAmendments",
  "communicationDrafts",
  "aiActions",
  "actionReceipts",
  "productEvents",
  "providerJobs",
  "emailJobs",
  "bookingOrchestrations",
  "galleryInboxes",
  "deliveryDrafts",
  "deliveryRecords",
  "reviewRequests",
]);

/**
 * How many records a tenant-wide read takes.
 *
 * The read is unordered, so a cap below the tenant's real count drops records
 * at random — and every dated inquiry now becomes a job, with a lead and a
 * thread, so these three grow with every inquiry a studio receives. Below the
 * higher cap, a busy season of inquiries could push a booked wedding off the
 * Jobs list, Today and the calendar without any error.
 */
function tenantReadLimit(collectionName: string): number {
  return ["projects", "leads", "conversations", "contacts"].includes(collectionName) ? 1000 : 100;
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
      limit(tenantReadLimit(collectionName)),
    ),
  );
  return snapshot.docs.map(
    (document) => ({ id: document.id, ...document.data() }) as TenantDocument,
  );
}

/**
 * A cache entry is usable while it is inside its TTL *and* was taken after the
 * last command that persisted. See lib/live/record-writes.ts: the second half
 * is what stops a route that wrote, and then navigated, being served records
 * read before its own write.
 */
function usable(
  entry: { cachedAt: number; expiresAt: number } | undefined,
): boolean {
  return (
    entry !== undefined &&
    entry.expiresAt > Date.now() &&
    !cacheEntryPredatesWrite(entry.cachedAt)
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
  if (cached && usable(cached)) return cached.records;
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
      // Not if a refresh has since dropped this read: these records predate the
      // write that triggered the refresh, and caching them would put the stale
      // answer back where the next reader finds it.
      if (tenantRecordsRequests.get(key) === request)
        tenantRecordsCache.set(key, {
          records,
          cachedAt: Date.now(),
          expiresAt: Date.now() + tenantRecordsCacheTtlMs,
        });
      return records;
    })
    .finally(() => {
      // Only if it is still ours: a refresh may have dropped this entry and a
      // newer read may already be registered under the same key.
      if (tenantRecordsRequests.get(key) === request)
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

/**
 * Subscribe to record invalidations without owning any records.
 *
 * `LiveDomainView` loads its own documents with `getDocs` rather than through
 * `useTenantDocuments`, so `refreshTenantRecords` could not reach it: a
 * photographer assigned a questionnaire, got "Questionnaire assigned", and the
 * panel above the form went on saying "No questionnaires assigned" until they
 * reloaded. This lets any independent loader re-run on the same signal.
 */
export function useTenantRecordsGeneration(): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      tenantRecordsListeners.add(onStoreChange);
      return () => tenantRecordsListeners.delete(onStoreChange);
    },
    () => tenantRecordsGeneration,
    () => 0,
  );
}

export function refreshTenantRecords(...collectionNames: string[]): void {
  const stale = (key: string) =>
    collectionNames.length === 0 ||
    collectionNames.some((name) => key.startsWith(`${name}:`));
  if (collectionNames.length === 0) tenantRecordsCache.clear();
  else
    for (const key of [...tenantRecordsCache.keys()])
      if (stale(key)) tenantRecordsCache.delete(key);
  /**
   * Drop the in-flight reads too, not just the cached answers.
   *
   * `cachedTenantDocuments` shares one request per key so a page reading a
   * dozen collections issues a dozen requests, not a hundred. But a read that
   * is already in flight was started BEFORE the write we are refreshing for,
   * and sharing it hands that pre-write answer to the refresh whose whole
   * purpose is to see the write.
   *
   * Two commands in a row is all it took: recording a closeout attestation
   * refreshed (starting a read), then reconciled, then refreshed again — and
   * the second refresh was served the first read. The panel sat at "6 of 8 are
   * settled" with the row still listed, while the reconcile line beside it,
   * which came from the command's own response, already knew there were seven.
   * Two contradicting counts on one panel, correct again only after a manual
   * reload. Every "refresh after an action" in the app shares this path.
   *
   * Forgetting the promise does not cancel it; whoever is awaiting it still
   * gets their answer, and its `finally` only clears the entry if it is still
   * the one registered.
   */
  for (const key of [...tenantRecordsRequests.keys()])
    if (stale(key)) tenantRecordsRequests.delete(key);
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
      // The same rule as the read below: a warm entry from before the last
      // write must not be painted, even for the moment before the real read
      // lands. That flash is the stale list the studio reports.
      setRecords(usable(cached) ? cached!.records : null);
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
  const listView = clientListView(view);
  const search = searchClientList(records ?? [], listView, q);
  const values = search.rows
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
      // `state !== "ARCHIVED"` missed every job put away by `archivedAt`,
      // which is how the rest of the product archives. One predicate now.
      liveProjects(projectRecords ?? [])
        .map((project) => ({
          id: project.id,
          name: String(project.name ?? "Untitled project"),
          eventDate:
            typeof project.eventDate === "string" ? project.eventDate : null,
          state: String(project.state ?? ""),
        }))
        .sort((left, right) =>
          String(left.eventDate ?? "").localeCompare(
            String(right.eventDate ?? ""),
          ),
        ),
    [projectRecords],
  );
  // Every job by id, archived ones too: a client row names the wedding, not a
  // bare count (UI audit, 2026-10-02).
  const jobNameById = useMemo(
    () =>
      new Map(
        (projectRecords ?? []).map((project) => [
          project.id,
          String(project.name ?? "Untitled job"),
        ]),
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
      // "No matching" implies a filter was applied, so an empty search, an
      // empty list and an empty tab each say which they are.
      <LiveRecordsState kind="empty" {...clientListEmptyState(listView, q, search.elsewhere)} />
    );
  return (
    <>
      {values.map((client) => {
        const name = String(client.displayName ?? "Client");
        const email =
          typeof client.email === "string" ? client.email : null;
        const projectIds = Array.isArray(client.projectIds)
          ? client.projectIds.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        const billingAddress = billingAddressOf(client.billingAddress);
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
              <small>
                {[email ?? "No email recorded", typeof client.company === "string" && client.company ? client.company : null]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              {billingAddress ? (
                <small title={formatBillingAddress(billingAddress)}>
                  {`Billing: ${formatBillingAddress(billingAddress)}${
                    coupleConfirmed(client) ? ` · ${billingAddressOrigin(client)}` : ""
                  }`}
                </small>
              ) : null}
            </span>
            {/* Which wedding, as a link. This read "PROJECTS 1" beside a
                COMPANY column that was "—" for every couple (UI audit,
                2026-10-02). */}
            <span className="ds-people-job">
              <small>Job</small>
              {projectIds.length ? (
                <Link href={`/studio/projects/${projectIds[0]}`}>
                  {jobNameById.get(projectIds[0]) ?? "Open job"}
                  {projectIds.length > 1 ? ` +${projectIds.length - 1}` : ""}
                </Link>
              ) : (
                <strong>None yet</strong>
              )}
            </span>
            <StatusBadge tone={client.portalUserId ? "success" : "neutral"}>
              {client.portalUserId ? "Portal active" : "No portal yet"}
            </StatusBadge>
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
            {/* A row's controls side by side, as small buttons; each used to
                take a full-width line of its own (docs/ui-audit-2026-09-27.md). */}
            <div className="record-row-actions">
              {/* Correcting and archiving a client — the two things this page
                  could never do. See components/clients/client-record-actions. */}
              <ClientRecordActions
                archived={Boolean(client.archivedAt)}
                client={{
                  id: client.id,
                  firstName: String(client.firstName ?? ""),
                  lastName: String(client.lastName ?? ""),
                  displayName: name,
                  email,
                  phone:
                    typeof client.phone === "string" ? client.phone : null,
                  company:
                    typeof client.company === "string" ? client.company : null,
                  notes: typeof client.notes === "string" ? client.notes : null,
                  billingAddress: billingAddressOf(client.billingAddress),
                  billingAddressByCouple: coupleConfirmed(client) !== null,
                }}
              />
              {!client.portalUserId && email ? (
                <details className="ds-people-invite">
                  <summary>
                    <Send aria-hidden="true" size={14} /> Invite to portal
                  </summary>
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
            </div>
          </article>
        );
      })}
    </>
  );
}

export function LiveRecordsState({
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
  const trade = useWorkspace().tenantTrade;
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
  // The accepted proposal's total is what a job is worth once agreed; before
  // that, every package on it — never the primary alone (jobValueCents).
  const proposals = useTenantDocuments("proposals");
  // Jobs whose automation has already tried and failed. Production showed a
  // row reading "Create retainer invoice" as fresh work while a provider job
  // to create that invoice had failed and been waiting a day.
  const providerJobs = useTenantDocuments("providerJobs");
  const today = todayLocalIso();
  // Only a step whose *latest* attempt failed: an old failure later retried
  // successfully left "a previous attempt failed" under four of five jobs
  // (UI audit, 2026-10-02). Named for what did not happen.
  const latestStep = new Map<string, Record<string, unknown>>();
  for (const job of providerJobs.records ?? []) {
    const projectId = String(job.projectId ?? "");
    if (!projectId) continue;
    const key = `${projectId}|${String(job.type ?? "")}`;
    const prior = latestStep.get(key);
    const at = (record: Record<string, unknown>) =>
      String(record.updatedAt ?? record.createdAt ?? "");
    if (!prior || at(job) > at(prior)) latestStep.set(key, job);
  }
  const stalled = new Map<string, string>();
  for (const [key, job] of latestStep) {
    if (!["failed", "dead_letter"].includes(String(job.status))) continue;
    stalled.set(key.split("|")[0], describeProviderFailure(String(job.type ?? "")).title);
  }
  const owed = new Map<string, { cents: number; overdue: boolean }>();
  // Whether a job has ever been billed at all. "Paid up" needs an invoice
  // behind it; a value taken from a draft proposal is not a bill.
  const invoiced = new Set<string>();
  for (const invoice of invoices.records ?? []) {
    if (String(invoice.projectId ?? "")) {
      invoiced.add(String(invoice.projectId));
    }
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
        // A job is put away either by reaching the ARCHIVED state or by
        // carrying an `archivedAt` — which is how every other list in the
        // product decides (leads, contacts, vendors, crew, and the generic
        // domain view all read the field). Reading only the state meant a job
        // archived anywhere else stayed on this page for ever, and the
        // Archived tab never showed it.
        .filter((item) =>
          view === "archived" ? isPutAway(item) : !isPutAway(item),
        )
        // Not booked yet is an inquiry, listed under Inquiries: a couple
        // becomes a job here when they book.
        // A closed inquiry (LOST) never booked either — it sat in Active jobs
        // as "Closed inquiry" with money outstanding (UI audit, 2026-10-02).
        .filter(
          (item) =>
            view === "archived" ||
            (!preBookingStates.has(String(item.state ?? "")) &&
              String(item.state ?? "") !== "LOST"),
        )
        .filter(
          (item) => type === "all" || jobKindOf(item) === type,
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
            valueCents: jobValueCents({
              project: item,
              snapshots: snapshots.records,
              proposals: proposals.records,
            }),
            owedCents: balance?.cents ?? null,
            owedOverdue: balance?.overdue ?? false,
            invoiced: invoiced.has(item.id),
            // The real outstanding step, not a generic instruction repeated
            // down the column — including on jobs that are already finished.
            nextAction:
              position?.actionLabel ??
              position?.stepTitle ??
              String(item.nextAction ?? "Nothing outstanding"),
            stalled: stalled.get(item.id) ?? null,
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
        state="Loading jobs…"
        detail="Reading your studio’s jobs."
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
    /**
     * A filter clause only when there is a filter.
     *
     * "Create your first project or change the active filters" greeted a
     * brand-new studio with nothing set — nothing to change, and an
     * implication that the product might be hiding their work from them at the
     * moment they are least able to tell.
     */
    const filtered = view !== "active" || type !== "all";
    return (
      <LiveRecordsState
        kind="empty"
        state={filtered ? "No jobs in this view" : "No booked jobs yet"}
        detail={
          filtered
            ? "Nothing matches the current filters. Clear them, or create a project."
            : "A couple becomes a job here when they book. Everyone still deciding is under Inquiries."
        }
        action={
          filtered
            ? { href: "/studio/projects/new", label: "New job" }
            : { href: "/studio/leads", label: "Open Inquiries" }
        }
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
              {projectStateLabel(project.state, trade)}
            </StatusBadge>
            <PhaseTrack state={project.state} trade={trade} />
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
            ) : "invoiced" in project && project.invoiced ? (
              <small>paid up</small>
            ) : (
              // The comment below was right and the condition was not: this
              // tested for a *value*, and a job with a draft proposal has a
              // value with nothing billed. Production showed "$2,999 · paid up"
              // on a job whose proposal had never been sent. "Paid up" now needs
              // an invoice behind it.
              <small>not invoiced yet</small>
            )}
          </span>
          <span>
            <strong>{project.nextAction}</strong>
            {/* An attempt already failed on this job, so the action is a retry
                rather than fresh work. Saying so is the difference between
                "do this" and "this broke, and here is what it was trying". */}
            <small>
              {project.owner}
              {"stalled" in project && project.stalled ? (
                <em className="is-overdue"> · {project.stalled}</em>
              ) : null}
            </small>
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
            ? // A capture awaiting "is this an inquiry?" waits in the tray above.
              !["converted", "lost", "archived"].includes(String(item.status)) &&
              item.needsConfirmation !== true
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
          event: String(item.eventType ?? item.eventTypeLabel ?? "Event"),
          // Was `String(item.eventDate)`, printing a raw `2027-07-01` while
          // every other surface said "Jul 1, 2027".
          date: item.eventDate ? formatEventDate(item.eventDate) : "Date to confirm",
          venue: String(item.venue ?? item.city ?? "Venue pending"),
          source: leadSourceLabel(item),
          status: String(item.status ?? "new"),
          missing: Array.isArray(item.missingInformation)
            ? item.missingInformation.length
            : Array.isArray(item.missingFields)
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
                {lead.missing} detail{lead.missing > 1 ? "s" : ""}{" "} missing
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

/**
 * "Maybe an inquiry" — captures the reader wasn't sure about.
 *
 * Kept out of Today's queue and the Open list so a newsletter never outranks
 * a couple, but never dropped: Today asks about them beside the queue, and
 * each one is a tap to keep or file away. The answer teaches capture about
 * that sender.
 */
export function LiveMaybeInquiries() {
  const { records } = useTenantDocuments("leads");
  const maybes = (records ?? []).filter(
    (item) =>
      item.needsConfirmation === true &&
      !["converted", "lost", "archived"].includes(String(item.status)),
  );
  if (!maybes.length) return null;
  return (
    <section className="panel maybe-inquiry-tray">
      <div className="panel-heading">
        <div>
          <h2>Maybe an inquiry</h2>
          <p>
            {`${maybes.length === 1 ? "One email" : `${maybes.length} emails`} we weren't sure about. Keep the real ones; for the rest, you choose whether to ignore their sender.`}
          </p>
        </div>
      </div>
      <ul>
        {maybes.map((item) => (
          <li key={item.id}>
            <Link href={`/studio/leads/${item.id}`}>
              <strong>
                {String(item.displayName ?? item.email ?? "Unknown sender")}
              </strong>
              <small>
                {leadSourceLabel(item)} ·{" "}
                {String(item.message ?? "").slice(0, 120) || "No message"}
              </small>
            </Link>
            <MaybeInquiryPrompt
              compact
              leadId={item.id}
              onAnswered={() => refreshTenantRecords("leads", "projects", "conversations", "contacts")}
              sender={ignorableSenderOf(item)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LiveLeadDetail({ id }: { id: string }) {
  const workspace = useWorkspace();
  const { records, error, loading } = useTenantDocuments("leads");
  const aiState = useTenantDocuments("aiActions");
  const liveLead = records?.find((item) => item.id === id);
  const demoLead = !dataIsLive
    ? crmLeads.find((item) => item.id === id)
    : null;
  const lead = liveLead ?? (demoLead as TenantDocument | undefined);
  // An inquiry that is a job is worked on the job: one thread, one place to
  // reply, book the consultation and send the proposal. The inquiry's own
  // page is for what hasn't become one yet — a maybe, or one without a date.
  const router = useRouter();
  const jobId = typeof lead?.projectId === "string" ? lead.projectId : "";
  useEffect(() => {
    if (jobId) router.replace(`/studio/projects/${jobId}`);
  }, [jobId, router]);
  if (jobId)
    return <LiveRecordsState kind="loading" state="Opening the job…" detail="This inquiry is on its job now." />;
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
  /**
   * The record decides what is missing, not only what the intake declared.
   * See features/crm/lead-intake.ts.
   */
  const missing = leadIntakeGaps({
    email: typeof lead.email === "string" ? lead.email : null,
    phone: typeof lead.phone === "string" ? lead.phone : null,
    eventDate: typeof lead.eventDate === "string" ? lead.eventDate : null,
    declaredMissing: Array.isArray(missingSource)
      ? missingSource.map(String)
      : [],
  });
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
  // Converted means it has a project, whatever the status string says.
  const converted =
    Boolean(lead.projectId) || String(lead.status) === "converted";
  const captured = typeof lead.captureId === "string" && Boolean(lead.captureId);
  const guests =
    typeof lead.estimatedGuestCount === "number" ? String(lead.estimatedGuestCount) : "";
  const inquiryCount = typeof lead.inquiryCount === "number" ? lead.inquiryCount : 1;
  return (
    <div className="live-detail-page lead-detail-page">
      <Link className="back-link" href="/studio/leads"><ArrowLeft /> Back to inquiries</Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Client inquiry</p>
          <h1>{fullName}</h1>
          {/* Was printing the raw `2027-07-02`. Every other surface — Today's
              own row for this inquiry, the job it converts into, the AI's own
              draft — writes "Jul 2, 2027". A database value leaking onto the
              one screen whose job is to make a stranger feel like a person. */}
          <p>
            {String(lead.eventType ?? lead.eventTypeLabel ?? TRADE_LABELS[tradeOf(workspace.tenantTrade)])} inquiry for{" "}
            {typeof lead.eventDate === "string" && lead.eventDate
              ? formatEventDate(lead.eventDate)
              : "a date to be confirmed"}
            .
          </p>
        </div>
        <StatusBadge tone={stateTone(String(lead.status ?? ""))}>
          {statusLabel(lead.status ?? "new")}
        </StatusBadge>
      </header>
      {lead.needsConfirmation === true && !converted ? (
        <MaybeInquiryPrompt
          leadId={lead.id}
          onAnswered={() => refreshTenantRecords("leads", "projects", "conversations", "contacts")}
          sender={ignorableSenderOf(lead)}
        />
      ) : null}
      {typeof lead.eventDate === "string" && lead.eventDate && lead.availabilityStatus === "conflict" ? (
        <p className="form-notice lead-date-clash" role="status">
          You already have a job booked on {formatEventDate(lead.eventDate)}.
        </p>
      ) : null}
      <div className="lead-action-row">
        {/**
          * The project decides, not the status string.
          *
          * `convertLead` refuses any lead that already carries a `projectId` —
          * status is never consulted — so keying this on `status ===
          * "converted"` showed a "Convert to project" button on a lead that
          * had a project, and clicking it returned LEAD_NOT_CONVERTIBLE every
          * time. A lead whose status write did not land, or which was linked
          * by seeding or import, is exactly the case that got stuck.
          */}
        {!replyAction && !converted ? (
          <DraftReplyButton leadId={lead.id} />
        ) : null}
        {!converted ? (
          <ConvertInquiryButton lead={lead} />
        ) : lead.projectId ? (
          <Link
            className="button button-dark"
            href={`/studio/projects/${String(lead.projectId)}`}
          >
            Open project <ArrowRight />
          </Link>
        ) : null}
        {!converted ? (
          <LeadDetailsEditor
            key={String(lead.updatedAt ?? "")}
            lead={lead}
            onSaved={() => refreshTenantRecords("leads", "projects", "conversations", "contacts")}
          />
        ) : null}
        {/* Close and reopen, for an inquiry that never became a job — the
            server always accepted a leadId; the page offered neither, so a
            lost lead stayed open and its /i/ link kept working (Wave 3). */}
        {!converted && lead.notInquiry !== true ? (
          <ProjectInquiryClose
            className="button button-light"
            leadId={lead.id}
            projectId={null}
            state={String(lead.status) === "lost" ? "LOST" : "LEAD"}
          />
        ) : null}
        {lead.notInquiry === true && ["studio_owner", "studio_admin"].includes(workspace.role ?? "") ? (
          <InquiryRestore leadId={lead.id} sender={ignorableSenderOf(lead)} />
        ) : null}
        {email ? <a className="button button-dark" href={`mailto:${email}`}><Mail /> Email client</a> : null}
        {phone ? <a className="button button-light" href={`tel:${phone}`}><Phone /> Call client</a> : null}
      </div>
      <section className="lead-detail-grid">
        <article className="panel lead-detail-card">
          <div className="panel-heading"><div><h2>Contact</h2><p>How to follow up</p></div></div>
          <dl>
            <div><dt>Email</dt><dd>{email || "Not provided"} <InferredTag lead={lead} field="email" /></dd></div>
            <div><dt>Phone</dt><dd>{phone || "Not provided"} <InferredTag lead={lead} field="phone" /></dd></div>
            <div><dt>Partner or contact</dt><dd>{String(lead.partnerName ?? "Not provided")} <InferredTag lead={lead} field="partnerName" /></dd></div>
          </dl>
        </article>
        <article className="panel lead-detail-card">
          <div className="panel-heading"><div><h2>Event</h2><p>What they shared</p></div></div>
          <dl>
            <div>
              <dt>Date</dt>
              <dd>
                <CalendarDays />{" "}
                {typeof lead.eventDate === "string" && lead.eventDate
                  ? formatEventDate(lead.eventDate)
                  : "Not provided"}{" "}
                <InferredTag lead={lead} field="eventDate" />
              </dd>
            </div>
            <div><dt>Location</dt><dd><MapPin /> {[lead.venue, lead.city].filter((part) => typeof part === "string" && part).join(", ") || "Not provided"} <InferredTag lead={lead} field="venue" /></dd></div>
            {typeof lead.ceremonyTime === "string" && lead.ceremonyTime ? (
              <div><dt>Ceremony</dt><dd>{lead.ceremonyTime} <InferredTag lead={lead} field="ceremonyTime" /></dd></div>
            ) : null}
            {guests ? (
              <div><dt>Guests</dt><dd>{guests} <InferredTag lead={lead} field="estimatedGuestCount" /></dd></div>
            ) : null}
            {/* Shown only when there is one: a studio can stop asking, and
                "Not provided" then read as the couple holding it back. */}
            {typeof lead.budgetRange === "string" && lead.budgetRange ? (
              <div><dt>Budget</dt><dd>{lead.budgetRange} <InferredTag lead={lead} field="budgetRange" /></dd></div>
            ) : null}
            <div>
              <dt>Source</dt>
              <dd>
                {captured ? leadSourceLabel(lead) : String(lead.referralSource ?? "Direct")}
                {captured && typeof lead.referralSource === "string" && lead.referralSource
                  ? ` · found you via ${lead.referralSource}`
                  : ""}
              </dd>
            </div>
          </dl>
        </article>
      </section>
      {typeof lead.message === "string" && lead.message ? (
        <section className="panel lead-message-card">
          <div className="panel-heading"><div><h2>Client message</h2><p>{inquiryCount > 1 ? `They've written ${inquiryCount} times; this is the first` : captured ? "Read from the email" : "Submitted with the inquiry"}</p></div></div>
          <p>{lead.message}</p>
        </section>
      ) : null}
      {/* The studio's own questions on its inquiry form, as asked then. */}
      {leadAnswers(lead).length ? (
        <section className="panel lead-detail-card">
          <div className="panel-heading"><div><h2>Their answers</h2><p>Your questions on the inquiry form</p></div></div>
          <dl>
            {leadAnswers(lead).map((row) => (
              <div key={row.question}><dt>{row.question}</dt><dd>{row.answer}</dd></div>
            ))}
          </dl>
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
              {/* "unsent" was a lie once the draft had been approved: approving
                  a complete reply dispatches it, and this panel went on
                  labelling it unsent. It now says which of the two it is. */}
              <p className="eyebrow">
                {replyAction.status === "approved"
                  ? "AI-prepared · sent"
                  : "AI-prepared · unsent"}
              </p>
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
            <Link href="/studio">
              Review, edit, or approve <ArrowRight size={14} />
            </Link>
          </footer>
        </section>
      ) : null}
      <section className="lead-detail-grid">
        <article className="panel lead-insight-card">
          {/* A makeup or hair inquiry goes straight to the quote; there's no call to prepare for. */}
          <h2>{`Before the ${(callWords(workspace.tenantTrade).sales ?? tradeVocab(workspace.tenantTrade).proposal).toLowerCase()}`}</h2>
          {missing.length ? (
            <ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul>
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
        setNotice("Reply drafted — it's waiting on Today.");
        router.refresh();
      }
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "We couldn't prepare this draft. Try again."),
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
    // A prospect until they book; booking makes them a client.
    contactTypes: ["prospect"],
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
  // A job needs a date; a contact-form inquiry often doesn't carry one. Asked
  // here, at the moment it's needed, rather than failing the conversion.
  const knownDate =
    typeof lead.eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lead.eventDate)
      ? lead.eventDate
      : "";
  const [askingDate, setAskingDate] = useState(false);
  const [date, setDate] = useState(knownDate);

  async function convert() {
    const eventDate = knownDate || date;
    if (!eventDate) {
      setAskingDate(true);
      return;
    }
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
        // The kind the inquiry form recorded; the server reads the label
        // when there is none (job-kinds.ts).
        eventKind: jobKindOf({
          eventKind: lead.eventKind,
          eventTypeId: lead.eventTypeId,
          eventTypeLabel,
        }),
        eventTypeKey: typeof lead.eventTypeKey === "string" ? lead.eventTypeKey : null,
        eventDate,
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
      // `replaceAll("_", " ")` printed "LEAD NOT CONVERTIBLE" at a
      // photographer and left them to guess. friendlyError is what every
      // other command caller uses.
      setNotice(friendlyError(caught, "The inquiry could not be converted."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {askingDate && !knownDate ? (
        <label className="lead-convert-date">
          <span>Wedding date</span>
          <input
            onChange={(event) => setDate(event.target.value)}
            required
            type="date"
            value={date}
          />
        </label>
      ) : null}
      <button
        className="button button-dark"
        disabled={busy || (askingDate && !date)}
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
