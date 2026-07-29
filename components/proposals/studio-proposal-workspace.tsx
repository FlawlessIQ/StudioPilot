"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Inbox,
  LoaderCircle,
  Mail,
  PencilLine,
  Plus,
  RefreshCw,
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
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  runProposalCommand,
  type ProposalCommandType,
} from "@/lib/proposals/command-client";
import { dataIsLive } from "@/lib/runtime-mode";

type Value = Record<string, unknown> & { id: string };

type ProjectOption = {
  id: string;
  name: string;
  eventDate: string;
  eventType: string;
  state: string;
  contactName: string;
  contactEmail: string;
  packageSnapshotId: string;
  packageSnapshot: Value;
  openProposalId: string | null;
};

const mockProposal: Value = {
  id: "demo-proposal",
  tenantId: "demo-tenant",
  projectId: "demo-project",
  packageSnapshotId: "demo-package-snapshot",
  version: 2,
  status: "draft",
  draftRevision: 1,
  clientSnapshot: {
    displayName: "Maya and Elena Rivera",
    email: "maya@example.test",
  },
  eventSnapshot: {
    name: "Rivera wedding",
    eventType: "Wedding photography",
    eventDate: "2027-06-12",
    timezone: "America/New_York",
    venue: "The Garden Conservatory",
  },
  pricingSnapshot: {
    currency: "USD",
    packageName: "Signature wedding",
    subtotalCents: 680000,
    discountCents: 25000,
    taxCents: 51300,
    retainerCents: 220680,
    totalCents: 706300,
    lineItems: [
      {
        description: "Signature wedding",
        quantity: 1,
        unitPriceCents: 620000,
        totalCents: 620000,
      },
      {
        description: "Engagement session",
        quantity: 1,
        unitPriceCents: 60000,
        totalCents: 60000,
      },
    ],
  },
  paymentSchedule: [
    { label: "Retainer", amountCents: 220680, dueDate: "2027-02-05" },
    { label: "Final balance", amountCents: 485620, dueDate: "2027-05-29" },
  ],
  expiresAt: "2027-02-05T23:59:59.000Z",
  notes:
    "A calm, documentary approach with intentional direction when it matters.",
  termsSummary:
    "Coverage, deliverables, travel, rescheduling, and cancellation details are finalized in the photography agreement.",
  pdfDocumentId: null,
  pdfState: "not_requested",
  submittedAt: null,
  approvedAt: null,
  approvedBy: null,
  sentAt: null,
  viewedAt: null,
  acceptedAt: null,
  declinedAt: null,
  declineReason: null,
  emailDeliveryStatus: "not_sent",
  updatedAt: "2027-01-28T15:00:00.000Z",
};

const mockProject: ProjectOption = {
  id: "demo-project",
  name: "Rivera wedding",
  eventDate: "2027-06-12",
  eventType: "Wedding photography",
  state: "CONSULTATION",
  contactName: "Maya and Elena Rivera",
  contactEmail: "maya@example.test",
  packageSnapshotId: "demo-package-snapshot",
  packageSnapshot: {
    id: "demo-package-snapshot",
    packageName: "Signature wedding",
    description:
      "Eight hours of wedding-day coverage with two photographers and a complete digital collection.",
    currency: "USD",
    basePriceCents: 620000,
    subtotalCents: 680000,
    discountCents: 25000,
    taxCents: 51300,
    retainerCents: 220680,
    totalCents: 706300,
    terms:
      "Coverage, deliverables, travel, rescheduling, and cancellation details are finalized in the photography agreement.",
    addOns: [
      {
        name: "Engagement session",
        quantity: 1,
        unitPriceCents: 60000,
        lineTotalCents: 60000,
      },
    ],
    includedCoverageMinutes: 480,
    includedPhotographers: 2,
    includedDeliverables: [
      "High-resolution digital collection",
      "Private online gallery",
      "Print release",
    ],
  },
  openProposalId: null,
};

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function money(value: unknown, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(number(value) / 100);
}

function date(value: unknown, includeTime = false): string {
  if (typeof value !== "string" || !value) return "Not set";
  const parsed = new Date(
    value.includes("T") ? value : `${value}T12:00:00`,
  );
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(parsed);
}

function dateInput(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function proposalTone(status: string) {
  if (["accepted", "approved", "delivered"].includes(status)) return "success";
  if (["declined", "expired", "failed", "bounce", "dropped"].includes(status))
    return "danger";
  if (["sent", "viewed", "open", "click"].includes(status)) return "info";
  return "warning";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    internal_review: "Needs approval",
    approved: "Approved",
    sent: "Sent",
    viewed: "Viewed",
    accepted: "Accepted",
    declined: "Changes requested",
    expired: "Expired",
    superseded: "Superseded",
  };
  const fallback = status.replaceAll("_", " ");
  return labels[status] ?? `${fallback.charAt(0).toUpperCase()}${fallback.slice(1)}`;
}

function commandError(error: string): string {
  if (error.startsWith("OPEN_PROPOSAL_EXISTS:")) {
    return "This project already has an open proposal. Open that version before creating another.";
  }
  const messages: Record<string, string> = {
    PROJECT_NOT_READY_FOR_PROPOSAL:
      "Complete the consultation stage before preparing a proposal.",
    PACKAGE_SNAPSHOT_REQUIRED:
      "Select and lock a package on the project before creating a proposal.",
    CLIENT_EMAIL_REQUIRED:
      "Add a valid primary client email before creating the proposal.",
    PROPOSAL_DRAFT_CONFLICT:
      "This draft changed in another session. Refresh before saving again.",
    APPROVAL_PERMISSION_REQUIRED:
      "A studio owner or administrator must approve this proposal.",
    SEND_PERMISSION_REQUIRED:
      "A studio owner or administrator must send this proposal.",
    PROPOSAL_PDF_NOT_READY:
      "The approved PDF is still being generated. Try again when it is ready.",
  };
  return messages[error] ?? error.replaceAll("_", " ").toLowerCase();
}

async function loadProjectOptions(tenantId: string): Promise<ProjectOption[]> {
  const { firestore } = getFirebaseClient();
  const [projects, proposals] = await Promise.all([
    getDocs(
      query(
        collection(firestore, "projects"),
        where("tenantId", "==", tenantId),
        limit(100),
      ),
    ),
    getDocs(
      query(
        collection(firestore, "proposals"),
        where("tenantId", "==", tenantId),
        limit(200),
      ),
    ),
  ]);
  const openByProject = new Map<string, string>();
  for (const proposal of proposals.docs) {
    if (
      ["draft", "internal_review", "approved"].includes(
        String(proposal.get("status")),
      )
    ) {
      openByProject.set(String(proposal.get("projectId")), proposal.id);
    }
  }
  const eligible = projects.docs.filter(
    (project) =>
      ["CONSULTATION", "PROPOSAL"].includes(String(project.get("state"))) &&
      typeof project.get("packageSnapshotId") === "string",
  );
  return Promise.all(
    eligible.map(async (project) => {
      const packageSnapshotId = String(project.get("packageSnapshotId"));
      const contactIds = Array.isArray(project.get("clientContactIds"))
        ? (project.get("clientContactIds") as unknown[]).filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      const [snapshot, contact] = await Promise.all([
        getDoc(doc(firestore, "packageSnapshots", packageSnapshotId)),
        contactIds[0]
          ? getDoc(doc(firestore, "contacts", contactIds[0]))
          : Promise.resolve(null),
      ]);
      return {
        id: project.id,
        name: text(project.get("name"), "Photography project"),
        eventDate: text(project.get("eventDate"), ""),
        eventType: text(project.get("eventType"), "Photography"),
        state: text(project.get("state"), ""),
        contactName: text(contact?.get("displayName"), "Client"),
        contactEmail: text(contact?.get("email"), ""),
        packageSnapshotId,
        packageSnapshot: {
          id: snapshot.id,
          ...(snapshot.data() ?? {}),
        },
        openProposalId: openByProject.get(project.id) ?? null,
      };
    }),
  );
}

export function StudioProposalCenter() {
  const workspace = useWorkspace();
  const [proposals, setProposals] = useState<Value[] | undefined>(
    dataIsLive
      ? undefined
      : [
          mockProposal,
          {
            ...mockProposal,
            id: "demo-proposal-sent",
            version: 1,
            status: "viewed",
            sentAt: "2027-01-21T15:00:00.000Z",
            viewedAt: "2027-01-21T16:08:00.000Z",
            emailDeliveryStatus: "open",
          },
        ],
  );
  const [filter, setFilter] = useState<
    "all" | "approval" | "client" | "complete"
  >("all");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    let active = true;
    void getDocs(
      query(
        collection(getFirebaseClient().firestore, "proposals"),
        where("tenantId", "==", workspace.tenantId),
        limit(200),
      ),
    )
      .then((snapshot) => {
        if (!active) return;
        setProposals(
          snapshot.docs
            .map(
              (record): Value => ({
                id: record.id,
                ...record.data(),
              }),
            )
            .sort(
              (left, right) =>
                new Date(text(right.updatedAt, "1970-01-01")).valueOf() -
                new Date(text(left.updatedAt, "1970-01-01")).valueOf(),
            ),
        );
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Proposals could not be loaded.",
        );
        setProposals([]);
      });
    return () => {
      active = false;
    };
  }, [workspace.loading, workspace.tenantId]);

  const visible = useMemo(
    () =>
      (proposals ?? []).filter((proposal) => {
        const status = text(proposal.status, "draft");
        if (filter === "approval")
          return ["draft", "internal_review", "approved"].includes(status);
        if (filter === "client") return ["sent", "viewed"].includes(status);
        if (filter === "complete")
          return ["accepted", "declined", "expired", "superseded"].includes(
            status,
          );
        return true;
      }),
    [filter, proposals],
  );
  const counts = useMemo(() => {
    const values = proposals ?? [];
    return {
      approval: values.filter((item) =>
        ["draft", "internal_review", "approved"].includes(
          text(item.status, ""),
        ),
      ).length,
      client: values.filter((item) =>
        ["sent", "viewed"].includes(text(item.status, "")),
      ).length,
      accepted: values.filter((item) => item.status === "accepted").length,
    };
  }, [proposals]);

  return (
    <div className="proposal-center-page">
      <header className="proposal-center-hero">
        <div>
          <p className="eyebrow">Sales documents</p>
          <h1>Proposals</h1>
          <p>
            Build a precise offer, route it for approval, and know exactly when
            your client has reviewed it.
          </p>
        </div>
        <Link className="button button-dark" href="/studio/proposals/new">
          <Plus /> New proposal
        </Link>
      </header>

      <section className="proposal-center-metrics" aria-label="Proposal summary">
        <article>
          <span><FileCheck2 /></span>
          <div><small>In studio</small><strong>{counts.approval}</strong></div>
          <p>Drafting or approval</p>
        </article>
        <article>
          <span><Mail /></span>
          <div><small>With clients</small><strong>{counts.client}</strong></div>
          <p>Sent or viewed</p>
        </article>
        <article>
          <span><CheckCircle2 /></span>
          <div><small>Accepted</small><strong>{counts.accepted}</strong></div>
          <p>Ready for agreement</p>
        </article>
      </section>

      <section className="proposal-center-workspace">
        <div className="proposal-center-toolbar">
          <div role="tablist" aria-label="Filter proposals">
            {(
              [
                ["all", "All"],
                ["approval", "In studio"],
                ["client", "With clients"],
                ["complete", "Outcomes"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-selected={filter === value}
                key={value}
                onClick={() => setFilter(value)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <small>{visible.length} proposal{visible.length === 1 ? "" : "s"}</small>
        </div>

        {proposals === undefined ? (
          <div className="proposal-center-state">
            <LoaderCircle className="spin" />
            <strong>Loading proposals…</strong>
          </div>
        ) : error ? (
          <div className="proposal-center-state proposal-center-state-error">
            <Inbox />
            <strong>Proposals are unavailable</strong>
            <p>{error}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="proposal-center-state">
            <FileText />
            <strong>No proposals in this view</strong>
            <p>Start from a project with a selected package.</p>
            <Link className="button button-light" href="/studio/proposals/new">
              Create a proposal
            </Link>
          </div>
        ) : (
          <div className="proposal-center-list">
            {visible.map((proposal) => {
              const pricing = objectValue(proposal.pricingSnapshot);
              const event = objectValue(proposal.eventSnapshot);
              const client = objectValue(proposal.clientSnapshot);
              const status = text(proposal.status, "draft");
              return (
                <Link
                  href={`/studio/proposals/${proposal.id}`}
                  key={proposal.id}
                >
                  <span className="proposal-center-list-icon">
                    {status === "accepted" ? <Check /> : <FileText />}
                  </span>
                  <span className="proposal-center-list-main">
                    <small>
                      Version {number(proposal.version)} ·{" "}
                      {text(client.displayName, "Client")}
                    </small>
                    <strong>{text(event.name, "Photography project")}</strong>
                    <span>{text(pricing.packageName, "Photography package")}</span>
                  </span>
                  <span className="proposal-center-list-meta">
                    <small>Total</small>
                    <strong>
                      {money(pricing.totalCents, text(pricing.currency, "USD"))}
                    </strong>
                  </span>
                  <span className="proposal-center-list-meta">
                    <small>Expires</small>
                    <strong>{date(proposal.expiresAt)}</strong>
                  </span>
                  <StatusBadge tone={proposalTone(status)}>
                    {statusLabel(status)}
                  </StatusBadge>
                  <ArrowRight />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function StudioProposalComposer() {
  const workspace = useWorkspace();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectOption[] | undefined>(
    dataIsLive ? undefined : [mockProject],
  );
  const [projectId, setProjectId] = useState("");
  const [expiresOn, setExpiresOn] = useState(
    dateInput(addDays(new Date(), 7).toISOString()),
  );
  const [retainerDueDate, setRetainerDueDate] = useState("");
  const [balanceDueDate, setBalanceDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [termsSummary, setTermsSummary] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    let active = true;
    void loadProjectOptions(workspace.tenantId)
      .then((value) => {
        if (!active) return;
        setProjects(value);
        const requested = new URLSearchParams(window.location.search).get(
          "projectId",
        );
        const requestedProject = value.find(
          (project) => project.id === requested,
        );
        if (requestedProject) {
          setProjectId(requestedProject.id);
          setNotes(text(requestedProject.packageSnapshot.description, ""));
          setTermsSummary(
            text(requestedProject.packageSnapshot.terms, ""),
          );
          const event = new Date(`${requestedProject.eventDate}T12:00:00`);
          if (!Number.isNaN(event.valueOf())) {
            setBalanceDueDate(
              dateInput(addDays(event, -14).toISOString()),
            );
          }
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setProjects([]);
        setError(
          caught instanceof Error
            ? caught.message
            : "Eligible projects could not be loaded.",
        );
      });
    return () => {
      active = false;
    };
  }, [workspace.loading, workspace.tenantId]);

  const selected = projects?.find((project) => project.id === projectId);

  function selectProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    const nextProject = projects?.find(
      (project) => project.id === nextProjectId,
    );
    if (!nextProject) return;
    setNotes(text(nextProject.packageSnapshot.description, ""));
    setTermsSummary(text(nextProject.packageSnapshot.terms, ""));
    const event = new Date(`${nextProject.eventDate}T12:00:00`);
    setBalanceDueDate(
      Number.isNaN(event.valueOf())
        ? ""
        : dateInput(addDays(event, -14).toISOString()),
    );
  }

  const pricing = objectValue(selected?.packageSnapshot);
  const currency = text(pricing.currency, "USD");
  const addOns = Array.isArray(pricing.addOns)
    ? pricing.addOns.map(objectValue)
    : [];

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError("Choose a project before creating the draft.");
      return;
    }
    if (selected.openProposalId) {
      router.push(`/studio/proposals/${selected.openProposalId}`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const expiration = new Date(`${expiresOn}T23:59:59.000Z`);
      const command = await runProposalCommand("create_draft", {
        projectId: selected.id,
        expiresAt: expiration.toISOString(),
        notes: notes.trim() || null,
        termsSummary,
        retainerDueDate: retainerDueDate || null,
        balanceDueDate: balanceDueDate || null,
      });
      const proposalId = text(command.result.proposalId, "demo-proposal");
      router.push(`/studio/proposals/${proposalId}`);
    } catch (caught: unknown) {
      setError(
        commandError(
          caught instanceof Error
            ? caught.message
            : "The proposal draft could not be created.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="proposal-composer-page">
      <Link className="back-link" href="/studio/proposals">
        <ArrowLeft /> Back to proposals
      </Link>
      <header className="proposal-composer-heading">
        <div>
          <p className="eyebrow">New proposal</p>
          <h1>Turn a selected package into a clear decision.</h1>
          <p>
            Pricing remains locked to the project snapshot. You control the
            presentation, timing, and approval path.
          </p>
        </div>
        <div>
          <ShieldCheck />
          <span>
            <strong>Snapshot protected</strong>
            <small>Package pricing cannot drift while you write.</small>
          </span>
        </div>
      </header>

      <form className="proposal-composer-grid" onSubmit={create}>
        <div className="proposal-composer-fields">
          <section className="proposal-composer-section">
            <div className="proposal-composer-section-number">01</div>
            <div className="proposal-composer-section-body">
              <div>
                <p className="eyebrow">Project</p>
                <h2>Choose the client and event</h2>
                <p>
                  Only projects at consultation or proposal stage with a locked
                  package are available.
                </p>
              </div>
              {projects === undefined ? (
                <div className="proposal-inline-loading">
                  <LoaderCircle className="spin" /> Loading eligible projects…
                </div>
              ) : projects.length === 0 ? (
                <div className="proposal-inline-empty">
                  <Inbox />
                  <span>
                    <strong>No project is ready yet</strong>
                    <small>
                      Complete a consultation and select a package first.
                    </small>
                  </span>
                  <Link href="/studio/projects">Open projects</Link>
                </div>
              ) : (
                <label className="proposal-field">
                  <span>Project</span>
                  <select
                    onChange={(event) => selectProject(event.target.value)}
                    required
                    value={projectId}
                  >
                    <option value="">Select an eligible project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} · {project.contactName} ·{" "}
                        {date(project.eventDate)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selected ? (
                <div className="proposal-selected-project">
                  <span>
                    <CalendarDays />
                    <small>Event</small>
                    <strong>{date(selected.eventDate)}</strong>
                  </span>
                  <span>
                    <Mail />
                    <small>Client</small>
                    <strong>{selected.contactEmail}</strong>
                  </span>
                  <span>
                    <FileCheck2 />
                    <small>Package</small>
                    <strong>
                      {text(pricing.packageName, "Selected package")}
                    </strong>
                  </span>
                  {selected.openProposalId ? (
                    <p>
                      This project already has an open proposal. Continuing
                      opens that version instead of creating a duplicate.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <section className="proposal-composer-section">
            <div className="proposal-composer-section-number">02</div>
            <div className="proposal-composer-section-body">
              <div>
                <p className="eyebrow">Presentation</p>
                <h2>Frame the offer</h2>
                <p>
                  This copy appears in the client portal and the branded PDF.
                </p>
              </div>
              <label className="proposal-field">
                <span>Client-facing introduction</span>
                <textarea
                  maxLength={4000}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Describe the approach and value of this coverage."
                  rows={5}
                  value={notes}
                />
                <small>{notes.length}/4,000</small>
              </label>
              <label className="proposal-field">
                <span>Terms summary</span>
                <textarea
                  maxLength={6000}
                  minLength={10}
                  onChange={(event) => setTermsSummary(event.target.value)}
                  required
                  rows={6}
                  value={termsSummary}
                />
                <small>
                  Keep this concise. The completed signature-provider agreement
                  remains authoritative.
                </small>
              </label>
            </div>
          </section>

          <section className="proposal-composer-section">
            <div className="proposal-composer-section-number">03</div>
            <div className="proposal-composer-section-body">
              <div>
                <p className="eyebrow">Timing</p>
                <h2>Set the decision and payment dates</h2>
                <p>Dates are explicit and preserved with this proposal version.</p>
              </div>
              <div className="proposal-field-grid">
                <label className="proposal-field">
                  <span>Proposal expires</span>
                  <input
                    min={dateInput(new Date().toISOString())}
                    onChange={(event) => setExpiresOn(event.target.value)}
                    required
                    type="date"
                    value={expiresOn}
                  />
                </label>
                <label className="proposal-field">
                  <span>Retainer due</span>
                  <input
                    onChange={(event) =>
                      setRetainerDueDate(event.target.value)
                    }
                    type="date"
                    value={retainerDueDate}
                  />
                  <small>Optional until the agreement is ready.</small>
                </label>
                <label className="proposal-field">
                  <span>Final balance due</span>
                  <input
                    onChange={(event) =>
                      setBalanceDueDate(event.target.value)
                    }
                    type="date"
                    value={balanceDueDate}
                  />
                </label>
              </div>
            </div>
          </section>
        </div>

        <aside className="proposal-composer-preview">
          <div className="proposal-composer-preview-label">
            <Sparkles /> Offer snapshot
          </div>
          <div>
            <small>Prepared for</small>
            <strong>{selected?.contactName ?? "Select a project"}</strong>
            <span>{selected?.name ?? "Project details appear here"}</span>
          </div>
          <div className="proposal-composer-price">
            <small>Project total</small>
            <strong>{money(pricing.totalCents, currency)}</strong>
            <span>{text(pricing.packageName, "Locked package")}</span>
          </div>
          <dl>
            <div>
              <dt>Base coverage</dt>
              <dd>{money(pricing.basePriceCents, currency)}</dd>
            </div>
            {addOns.map((item, index) => (
              <div key={`${text(item.name)}-${index}`}>
                <dt>{text(item.name, "Add-on")}</dt>
                <dd>{money(item.lineTotalCents, currency)}</dd>
              </div>
            ))}
            {number(pricing.discountCents) > 0 ? (
              <div>
                <dt>Discount</dt>
                <dd>−{money(pricing.discountCents, currency)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Tax</dt>
              <dd>{money(pricing.taxCents, currency)}</dd>
            </div>
          </dl>
          <div className="proposal-composer-retainer">
            <CircleDollarSign />
            <span>
              <small>Retainer</small>
              <strong>{money(pricing.retainerCents, currency)}</strong>
            </span>
          </div>
          {error ? (
            <p className="proposal-command-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button button-dark"
            disabled={saving || !selected}
            type="submit"
          >
            {saving ? <LoaderCircle className="spin" /> : <PencilLine />}
            {selected?.openProposalId ? "Open current proposal" : "Create draft"}
          </button>
          <small>
            Creating a draft does not notify the client. Approval is required
            before sending.
          </small>
        </aside>
      </form>
    </div>
  );
}

export function StudioProposalWorkspace({ id }: { id: string }) {
  const workspace = useWorkspace();
  const [proposal, setProposal] = useState<Value | null | undefined>(
    dataIsLive ? undefined : { ...mockProposal, id },
  );
  const [versions, setVersions] = useState<Value[]>(
    dataIsLive ? [] : [{ ...mockProposal, id }],
  );
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState<ProposalCommandType | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [notes, setNotes] = useState(
    dataIsLive ? "" : text(mockProposal.notes, ""),
  );
  const [termsSummary, setTermsSummary] = useState(
    dataIsLive ? "" : text(mockProposal.termsSummary, ""),
  );
  const [expiresOn, setExpiresOn] = useState(
    dataIsLive ? "" : dateInput(mockProposal.expiresAt),
  );
  const [retainerDueDate, setRetainerDueDate] = useState(
    dataIsLive ? "" : "2027-02-05",
  );
  const [balanceDueDate, setBalanceDueDate] = useState(
    dataIsLive ? "" : "2027-05-29",
  );

  const load = useCallback(async () => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    const { app, firestore } = getFirebaseClient();
    const record = await getDoc(doc(firestore, "proposals", id));
    if (!record.exists() || record.get("tenantId") !== workspace.tenantId) {
      setProposal(null);
      return;
    }
    const value = { id: record.id, ...record.data() } as Value;
    setProposal(value);
    setNotes(text(value.notes, ""));
    setTermsSummary(text(value.termsSummary, ""));
    setExpiresOn(dateInput(value.expiresAt));
    const paymentValues = Array.isArray(value.paymentSchedule)
      ? value.paymentSchedule.map(objectValue)
      : [];
    setRetainerDueDate(dateInput(paymentValues[0]?.dueDate));
    setBalanceDueDate(dateInput(paymentValues[1]?.dueDate));
    const allVersions = await getDocs(
      query(
        collection(firestore, "proposals"),
        where("tenantId", "==", workspace.tenantId),
        where("projectId", "==", text(value.projectId, "")),
        limit(50),
      ),
    );
    setVersions(
      allVersions.docs
        .map(
          (version): Value => ({
            id: version.id,
            ...version.data(),
          }),
        )
        .sort(
          (left, right) => number(right.version) - number(left.version),
        ),
    );
    if (typeof value.pdfDocumentId === "string" && value.pdfDocumentId) {
      const documentRecord = await getDoc(
        doc(firestore, "documents", value.pdfDocumentId),
      );
      const path = text(documentRecord.get("providerFileId"), "");
      if (path) {
        try {
          setPdfUrl(await getDownloadURL(ref(getStorage(app), path)));
        } catch {
          setPdfUrl("");
        }
      }
    } else {
      setPdfUrl("");
    }
  }, [id, workspace.loading, workspace.tenantId]);

  useEffect(() => {
    if (!dataIsLive) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "The proposal could not be loaded.",
        );
        setProposal(null);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!dataIsLive || proposal?.pdfState !== "queued") return;
    const timer = window.setInterval(() => {
      void load();
    }, 3500);
    return () => window.clearInterval(timer);
  }, [load, proposal?.pdfState]);

  async function run(type: ProposalCommandType) {
    if (!proposal) return;
    setWorking(type);
    setError("");
    setNotice("");
    try {
      const input: Record<string, unknown> = { proposalId: proposal.id };
      if (type === "update_draft") {
        input.expectedDraftRevision = Math.max(
          1,
          number(proposal.draftRevision),
        );
        input.expiresAt = new Date(
          `${expiresOn}T23:59:59.000Z`,
        ).toISOString();
        input.notes = notes.trim() || null;
        input.termsSummary = termsSummary;
        input.retainerDueDate = retainerDueDate || null;
        input.balanceDueDate = balanceDueDate || null;
      }
      const command = await runProposalCommand(type, input);
      if (!command.persisted) {
        const status = text(command.result.status, text(proposal.status));
        setProposal((current) =>
          current
            ? {
                ...current,
                status,
                pdfState:
                  command.result.pdfState ?? current.pdfState,
              }
            : current,
        );
      } else {
        await load();
      }
      setConfirmSend(false);
      const messages: Partial<Record<ProposalCommandType, string>> = {
        update_draft: "Draft saved.",
        submit_for_approval: "Proposal sent for internal approval.",
        return_to_draft: "Proposal returned to draft.",
        approve: "Approved. The branded PDF is being generated.",
        regenerate_pdf: "A fresh PDF is being generated.",
        send: "Proposal queued for branded email delivery.",
        resend: "Proposal email queued again.",
      };
      setNotice(messages[type] ?? "Proposal updated.");
    } catch (caught: unknown) {
      setError(
        commandError(
          caught instanceof Error
            ? caught.message
            : "The proposal could not be updated.",
        ),
      );
    } finally {
      setWorking(null);
    }
  }

  if (proposal === undefined) {
    return (
      <div className="proposal-workspace-state">
        <LoaderCircle className="spin" />
        <strong>Loading proposal workspace…</strong>
      </div>
    );
  }
  if (!proposal) {
    return (
      <div className="proposal-workspace-page">
        <Link className="back-link" href="/studio/proposals">
          <ArrowLeft /> Back to proposals
        </Link>
        <div className="proposal-workspace-state">
          <Inbox />
          <strong>Proposal unavailable</strong>
          <p>{error || "This version may be outside your active studio."}</p>
        </div>
      </div>
    );
  }

  const status = text(proposal.status, "draft");
  const pricing = objectValue(proposal.pricingSnapshot);
  const event = objectValue(proposal.eventSnapshot);
  const client = objectValue(proposal.clientSnapshot);
  const lines = Array.isArray(pricing.lineItems)
    ? pricing.lineItems.map(objectValue)
    : [];
  const payments = Array.isArray(proposal.paymentSchedule)
    ? proposal.paymentSchedule.map(objectValue)
    : [];
  const currency = text(pricing.currency, "USD");
  const canApprove =
    workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const isEditable = status === "draft";

  return (
    <div className="proposal-workspace-page">
      <Link className="back-link" href="/studio/proposals">
        <ArrowLeft /> Back to proposals
      </Link>
      <header className="proposal-workspace-heading">
        <div>
          <p className="eyebrow">
            Proposal · version {number(proposal.version)}
          </p>
          <h1>{text(event.name, "Photography proposal")}</h1>
          <p>
            Prepared for {text(client.displayName, "client")} ·{" "}
            {text(pricing.packageName, "selected package")}
          </p>
        </div>
        <div>
          <StatusBadge tone={proposalTone(status)}>
            {statusLabel(status)}
          </StatusBadge>
          <Link
            className="button button-light button-sm"
            href={`/studio/proposals/${proposal.id}/preview`}
          >
            <Eye /> Preview
          </Link>
        </div>
      </header>

      <div className="proposal-workspace-grid">
        <div className="proposal-workspace-document">
          <section className="proposal-workspace-client">
            <span>SC</span>
            <div>
              <small>Prepared for</small>
              <h2>{text(client.displayName, "Client")}</h2>
              <p>
                {date(event.eventDate)} · {text(event.venue, "Venue pending")}
              </p>
            </div>
            <div>
              <small>Valid through</small>
              <strong>{date(proposal.expiresAt)}</strong>
            </div>
          </section>

          <section className="proposal-workspace-copy">
            <p className="eyebrow">The offer</p>
            <h2>{text(pricing.packageName, "Photography coverage")}</h2>
            {isEditable ? (
              <label className="proposal-field">
                <span>Client-facing introduction</span>
                <textarea
                  maxLength={4000}
                  onChange={(eventValue) => setNotes(eventValue.target.value)}
                  rows={5}
                  value={notes}
                />
              </label>
            ) : (
              <p>{text(proposal.notes, "Coverage prepared for this event.")}</p>
            )}
          </section>

          <section className="proposal-workspace-investment">
            <div>
              <p className="eyebrow">Investment</p>
              <strong>{money(pricing.totalCents, currency)}</strong>
            </div>
            <div className="proposal-workspace-lines">
              {lines.map((line, index) => (
                <article key={`${text(line.description)}-${index}`}>
                  <span>
                    <strong>{text(line.description, "Coverage")}</strong>
                    <small>
                      {number(line.quantity)} ×{" "}
                      {money(line.unitPriceCents, currency)}
                    </small>
                  </span>
                  <strong>{money(line.totalCents, currency)}</strong>
                </article>
              ))}
              <dl>
                <div>
                  <dt>Subtotal</dt>
                  <dd>{money(pricing.subtotalCents, currency)}</dd>
                </div>
                <div>
                  <dt>Discount</dt>
                  <dd>−{money(pricing.discountCents, currency)}</dd>
                </div>
                <div>
                  <dt>Tax</dt>
                  <dd>{money(pricing.taxCents, currency)}</dd>
                </div>
                <div>
                  <dt>Project total</dt>
                  <dd>{money(pricing.totalCents, currency)}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="proposal-workspace-payments">
            <div>
              <p className="eyebrow">Payment schedule</p>
              <h2>Clear milestones, before accounting.</h2>
            </div>
            {isEditable ? (
              <div className="proposal-field-grid">
                <label className="proposal-field">
                  <span>Proposal expires</span>
                  <input
                    min={dateInput(new Date().toISOString())}
                    onChange={(eventValue) =>
                      setExpiresOn(eventValue.target.value)
                    }
                    required
                    type="date"
                    value={expiresOn}
                  />
                </label>
                <label className="proposal-field">
                  <span>Retainer due</span>
                  <input
                    onChange={(eventValue) =>
                      setRetainerDueDate(eventValue.target.value)
                    }
                    type="date"
                    value={retainerDueDate}
                  />
                </label>
                <label className="proposal-field">
                  <span>Final balance due</span>
                  <input
                    onChange={(eventValue) =>
                      setBalanceDueDate(eventValue.target.value)
                    }
                    type="date"
                    value={balanceDueDate}
                  />
                </label>
              </div>
            ) : (
              <div className="proposal-workspace-payment-cards">
                {payments.map((payment, index) => (
                  <article key={`${text(payment.label)}-${index}`}>
                    <small>{text(payment.label, "Payment")}</small>
                    <strong>{money(payment.amountCents, currency)}</strong>
                    <span>{date(payment.dueDate)}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="proposal-workspace-terms">
            <ShieldCheck />
            <div>
              <p className="eyebrow">Terms summary</p>
              {isEditable ? (
                <label className="proposal-field">
                  <span className="sr-only">Terms summary</span>
                  <textarea
                    maxLength={6000}
                    minLength={10}
                    onChange={(eventValue) =>
                      setTermsSummary(eventValue.target.value)
                    }
                    required
                    rows={6}
                    value={termsSummary}
                  />
                </label>
              ) : (
                <p>{text(proposal.termsSummary)}</p>
              )}
              <small>
                Proposal acceptance is not a signed agreement or payment.
              </small>
            </div>
          </section>
        </div>

        <aside className="proposal-workspace-actions">
          <section>
            <div className="proposal-workspace-actions-heading">
              <span><Clock3 /></span>
              <div>
                <p className="eyebrow">Current step</p>
                <h2>
                  {status === "draft"
                    ? "Finish the draft"
                    : status === "internal_review"
                      ? "Approve the offer"
                      : status === "approved"
                        ? proposal.pdfState === "ready"
                          ? "Send to client"
                          : "Generate the PDF"
                        : ["sent", "viewed"].includes(status)
                          ? "Track the decision"
                          : "Review the outcome"}
                </h2>
              </div>
            </div>

            {status === "draft" ? (
              <div className="proposal-action-stack">
                <button
                  className="button button-light"
                  disabled={working !== null}
                  onClick={() => void run("update_draft")}
                  type="button"
                >
                  {working === "update_draft" ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <PencilLine />
                  )}
                  Save draft
                </button>
                <button
                  className="button button-dark"
                  disabled={working !== null}
                  onClick={() => void run("submit_for_approval")}
                  type="button"
                >
                  {working === "submit_for_approval" ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <ArrowRight />
                  )}
                  Send for approval
                </button>
                <small>
                  The client cannot see drafts or internal review activity.
                </small>
              </div>
            ) : null}

            {status === "internal_review" ? (
              <div className="proposal-action-stack">
                <div className="proposal-approval-checks">
                  <span><Check /> Pricing comes from the locked snapshot</span>
                  <span><Check /> Expiration and payment dates are explicit</span>
                  <span><Check /> Contract and payment remain separate</span>
                </div>
                {canApprove ? (
                  <button
                    className="button button-dark"
                    disabled={working !== null}
                    onClick={() => void run("approve")}
                    type="button"
                  >
                    {working === "approve" ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <FileCheck2 />
                    )}
                    Approve & generate PDF
                  </button>
                ) : (
                  <p className="proposal-permission-note">
                    A studio owner or administrator must approve this proposal.
                  </p>
                )}
                <button
                  className="button button-quiet"
                  disabled={working !== null}
                  onClick={() => void run("return_to_draft")}
                  type="button"
                >
                  Return to editing
                </button>
              </div>
            ) : null}

            {status === "approved" ? (
              <div className="proposal-action-stack">
                <div
                  className={`proposal-pdf-state proposal-pdf-state-${text(proposal.pdfState, "not_requested")}`}
                >
                  {proposal.pdfState === "ready" ? (
                    <FileCheck2 />
                  ) : proposal.pdfState === "failed" ? (
                    <RefreshCw />
                  ) : (
                    <LoaderCircle
                      className={proposal.pdfState === "queued" ? "spin" : ""}
                    />
                  )}
                  <span>
                    <strong>
                      {proposal.pdfState === "ready"
                        ? "Branded PDF ready"
                        : proposal.pdfState === "failed"
                          ? "PDF generation failed"
                          : "Generating branded PDF"}
                    </strong>
                    <small>
                      {proposal.pdfState === "ready"
                        ? "Stored privately until this proposal is sent."
                        : "The document worker usually finishes within a minute."}
                    </small>
                  </span>
                </div>
                {pdfUrl ? (
                  <a
                    className="button button-light"
                    href={pdfUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Download /> Open PDF
                  </a>
                ) : null}
                {proposal.pdfState === "failed" ? (
                  <button
                    className="button button-light"
                    disabled={working !== null}
                    onClick={() => void run("regenerate_pdf")}
                    type="button"
                  >
                    <RefreshCw /> Regenerate PDF
                  </button>
                ) : null}
                {proposal.pdfState === "ready" && canApprove ? (
                  <>
                    <label className="proposal-send-confirm">
                      <input
                        checked={confirmSend}
                        onChange={(eventValue) =>
                          setConfirmSend(eventValue.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>Ready to share with the client</strong>
                        <small>
                          Send the branded email and attached PDF to{" "}
                          {text(client.email, "the primary client")}.
                        </small>
                      </span>
                    </label>
                    <button
                      className="button button-dark"
                      disabled={!confirmSend || working !== null}
                      onClick={() => void run("send")}
                      type="button"
                    >
                      {working === "send" ? (
                        <LoaderCircle className="spin" />
                      ) : (
                        <Send />
                      )}
                      Send proposal
                    </button>
                  </>
                ) : null}
                <button
                  className="button button-quiet"
                  disabled={working !== null}
                  onClick={() => void run("return_to_draft")}
                  type="button"
                >
                  Return to editing
                </button>
              </div>
            ) : null}

            {["sent", "viewed"].includes(status) ? (
              <div className="proposal-action-stack">
                <div className="proposal-delivery-state">
                  <span><Mail /></span>
                  <div>
                    <small>Email delivery</small>
                    <strong>
                      {statusLabel(
                        text(proposal.emailDeliveryStatus, "queued"),
                      )}
                    </strong>
                  </div>
                </div>
                <dl className="proposal-client-activity">
                  <div>
                    <dt>Sent</dt>
                    <dd>{date(proposal.sentAt, true)}</dd>
                  </div>
                  <div>
                    <dt>Viewed</dt>
                    <dd>{date(proposal.viewedAt, true)}</dd>
                  </div>
                </dl>
                <button
                  className="button button-light"
                  disabled={working !== null}
                  onClick={() => void run("resend")}
                  type="button"
                >
                  {working === "resend" ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  Resend branded email
                </button>
                <small>
                  Resending creates a separate audited delivery attempt.
                </small>
              </div>
            ) : null}

            {status === "accepted" ? (
              <div className="proposal-outcome proposal-outcome-success">
                <CheckCircle2 />
                <strong>Proposal accepted</strong>
                <p>
                  The project can now move into the agreement and retainer
                  workflow.
                </p>
                <Link
                  className="button button-dark"
                  href={`/studio/projects/${text(proposal.projectId, "")}`}
                >
                  Continue to project <ArrowRight />
                </Link>
              </div>
            ) : null}

            {["declined", "expired", "superseded"].includes(status) ? (
              <div className="proposal-outcome">
                <FileText />
                <strong>{statusLabel(status)}</strong>
                <p>
                  {status === "declined"
                    ? text(
                        proposal.declineReason,
                        "The client requested an updated offer.",
                      )
                    : "This version is preserved and cannot be edited or sent."}
                </p>
                {status !== "superseded" ? (
                  <Link
                    className="button button-dark"
                    href={`/studio/proposals/new?projectId=${text(proposal.projectId, "")}`}
                  >
                    Create new version <ArrowRight />
                  </Link>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="proposal-command-error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="proposal-command-notice" role="status">
                <CheckCircle2 /> {notice}
              </p>
            ) : null}
          </section>

          <section className="proposal-version-history">
            <div>
              <p className="eyebrow">Version history</p>
              <strong>{versions.length} preserved version{versions.length === 1 ? "" : "s"}</strong>
            </div>
            {versions.map((version) => (
              <Link
                aria-current={version.id === proposal.id ? "page" : undefined}
                href={`/studio/proposals/${version.id}`}
                key={version.id}
              >
                <span>V{number(version.version)}</span>
                <div>
                  <strong>{statusLabel(text(version.status, "draft"))}</strong>
                  <small>{date(version.updatedAt, true)}</small>
                </div>
                <ArrowRight />
              </Link>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
