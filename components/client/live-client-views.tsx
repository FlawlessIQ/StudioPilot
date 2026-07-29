"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CircleCheck,
  Clock3,
  ExternalLink,
  FileText,
  FolderOpen,
  Heart,
  Images,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Star,
  UserRound,
  XCircle,
} from "lucide-react";
import { ClientQuestionnaireForm } from "@/components/planning/client-questionnaire-form";
import { PostEventAction } from "@/components/post-event/post-event-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  decideClientProposal,
  getClientPortalProject,
  getClientPortalRecords,
  sendClientPortalMessage,
  type ClientPortalCollection,
  type ClientPortalProject,
} from "@/lib/client/portal-client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { dataIsLive } from "@/lib/runtime-mode";

type RecordValue = Record<string, unknown> & { id: string };
type Loadable<T> = {
  value: T;
  loading: boolean;
  error: string | null;
};

function mockClientRecords(
  collectionName: ClientPortalCollection,
): RecordValue[] {
  if (collectionName !== "proposals") return [];
  return [
    {
      id: "demo-proposal-v2",
      version: 2,
      status: "viewed",
      eventSnapshot: {
        name: "Rivera wedding",
        eventType: "Wedding",
        eventDate: "2027-06-12",
        timezone: "America/New_York",
        venue: "The Garden Conservatory",
      },
      pricingSnapshot: {
        currency: "USD",
        packageName: "Signature wedding",
        subtotalCents: 715000,
        discountCents: 25000,
        taxCents: 45600,
        retainerCents: 182650,
        totalCents: 735600,
        lineItems: [
          {
            description: "Signature wedding collection",
            quantity: 1,
            unitPriceCents: 650000,
            totalCents: 650000,
          },
          {
            description: "Engagement session",
            quantity: 1,
            unitPriceCents: 65000,
            totalCents: 65000,
          },
        ],
      },
      paymentSchedule: [
        {
          label: "Retainer",
          amountCents: 182650,
          dueDate: "2026-08-14",
        },
        {
          label: "Final balance",
          amountCents: 552950,
          dueDate: "2027-05-29",
        },
      ],
      expiresAt: "2027-01-31T17:00:00.000Z",
      termsSummary:
        "Coverage, deliverables, and payment timing are subject to the completed photography services agreement.",
      sentAt: "2026-07-25T15:00:00.000Z",
      viewedAt: "2026-07-28T18:00:00.000Z",
      acceptedAt: null,
      declinedAt: null,
    },
  ];
}

function useProject(): Loadable<ClientPortalProject | null> {
  const workspace = useWorkspace();
  const [state, setState] = useState<Loadable<ClientPortalProject | null>>({
    value: null,
    loading: dataIsLive,
    error: null,
  });
  useEffect(() => {
    if (!dataIsLive || workspace.loading) return;
    if (!workspace.tenantId || !workspace.projectId) {
      queueMicrotask(() =>
        setState({
          value: null,
          loading: false,
          error: "No project is assigned to this portal membership.",
        }),
      );
      return;
    }
    if (workspace.clientProject?.id === workspace.projectId) {
      queueMicrotask(() =>
        setState({
          value: workspace.clientProject,
          loading: false,
          error: null,
        }),
      );
      return;
    }
    let active = true;
    void getClientPortalProject(workspace.tenantId, workspace.projectId)
      .then((project) => {
        if (!active) return;
        setState({
          value: project,
          loading: false,
          error: null,
        });
      })
      .catch((caught: unknown) => {
        if (active)
          setState({
            value: null,
            loading: false,
            error:
              caught instanceof Error
                ? caught.message
                : "Project details could not be loaded.",
          });
      });
    return () => {
      active = false;
    };
  }, [
    workspace.clientProject,
    workspace.loading,
    workspace.projectId,
    workspace.tenantId,
  ]);
  return state;
}

function useProjectRecords(
  collectionName: ClientPortalCollection,
): Loadable<RecordValue[]> {
  const workspace = useWorkspace();
  const [state, setState] = useState<Loadable<RecordValue[]>>({
    value: mockClientRecords(collectionName),
    loading: dataIsLive,
    error: null,
  });
  useEffect(() => {
    if (!dataIsLive || workspace.loading) return;
    if (!workspace.tenantId || !workspace.projectId) {
      queueMicrotask(() =>
        setState({
          value: [],
          loading: false,
          error: "No project is assigned to this portal membership.",
        }),
      );
      return;
    }
    let active = true;
    void getClientPortalRecords(
      workspace.tenantId,
      workspace.projectId,
      collectionName,
    )
      .then((result) => {
        if (!active) return;
        setState({
          value: result.records as RecordValue[],
          loading: false,
          error: null,
        });
      })
      .catch((caught: unknown) => {
        if (active)
          setState({
            value: [],
            loading: false,
            error:
              caught instanceof Error
                ? caught.message
                : `${collectionName} could not be loaded.`,
          });
      });
    return () => {
      active = false;
    };
  }, [
    collectionName,
    workspace.loading,
    workspace.projectId,
    workspace.tenantId,
  ]);
  return state;
}

function PortalState({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: string | null;
  empty?: string;
}) {
  if (loading)
    return (
      <section className="panel portal-live-state">
        <LoaderCircle className="spin" />
        <span>
          <strong>Loading your project…</strong>
          <small>Reading only records assigned to your portal.</small>
        </span>
      </section>
    );
  if (error)
    return (
      <section className="panel portal-live-state portal-live-error">
        <ShieldCheck />
        <span>
          <strong>This information is unavailable</strong>
          <small>{error}</small>
        </span>
      </section>
    );
  if (empty)
    return (
      <section className="panel portal-live-state">
        <Clock3 />
        <span>
          <strong>Nothing to complete yet</strong>
          <small>{empty}</small>
        </span>
      </section>
    );
  return null;
}

function PortalPageState({
  eyebrow,
  title,
  description,
  loading,
  error,
  empty,
}: {
  eyebrow: string;
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  empty?: string;
}) {
  return (
    <div className="client-booking-page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <PortalState loading={loading} error={error} empty={empty} />
      {empty ? (
        <aside className="portal-empty-guide" aria-label="What happens next">
          <p className="eyebrow">What happens next</p>
          <div>
            <span><CheckCircle2 /><strong>Your studio prepares this area</strong></span>
            <span><MessageCircle /><strong>You’ll be notified when it changes</strong></span>
            <span><ShieldCheck /><strong>Only approved project details appear here</strong></span>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

const text = (value: unknown, fallback = "Pending") =>
  typeof value === "string" && value ? value : fallback;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const money = (cents: unknown, currency: unknown = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: text(currency, "USD"),
  }).format(number(cents) / 100);
const date = (value: unknown) => {
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  return Number.isNaN(parsed.valueOf())
    ? "Date pending"
    : parsed.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
};
const statusTone = (status: unknown) =>
  [
    "accepted",
    "completed",
    "paid",
    "approved",
    "published",
    "downloaded",
    "sent",
  ].includes(String(status))
    ? ("success" as const)
    : ["overdue", "error", "declined", "revoked"].includes(String(status))
      ? ("danger" as const)
      : ("warning" as const);

export function LiveClientHome() {
  const workspace = useWorkspace();
  const project = useProject();
  const [renderedAt] = useState(() => Date.now());
  if (project.loading || project.error || !project.value)
    return (
      <PortalPageState
        eyebrow="Your client portal"
        title={`Hello, ${workspace.userName.split(" ")[0]}.`}
        description="Your project plan, next steps, and shared files will live here."
        loading={project.loading}
        error={project.error}
        empty={!project.loading && !project.error ? "Project details will appear after assignment." : undefined}
      />
    );
  const value = project.value;
  const eventDate = value.eventDate
    ? new Date(`${value.eventDate}T12:00:00`)
    : new Date(Number.NaN);
  const hasEventDate = !Number.isNaN(eventDate.valueOf());
  const days = hasEventDate
    ? Math.ceil((eventDate.valueOf() - renderedAt) / 86400000)
    : null;
  const progress = value.clientProgress;
  const nextAction = value.nextClientAction;
  const studioIsWorking = nextAction.responsibility === "studio";
  return (
    <>
      <div className="portal-hero">
        <div>
          <p className="eyebrow">Your {text(value.eventType, "photography")} project</p>
          <h1>Hello, {workspace.userName.split(" ")[0]}.</h1>
          <p>Everything approved for your project, in one secure place.</p>
        </div>
        <div className="event-countdown">
          <strong>{days === null ? "—" : Math.max(0, days)}</strong>
          <span>
            {days === null
              ? "date pending"
              : days < 0
                ? "event complete"
                : "days to go"}
          </span>
        </div>
      </div>
      <section
        className={
          studioIsWorking
            ? "client-next-action client-next-action-studio"
            : "client-next-action"
        }
      >
        <span className="next-action-art">
          {studioIsWorking ? <ShieldCheck size={25} /> : <Clock3 size={25} />}
        </span>
        <div>
          <StatusBadge tone={studioIsWorking ? "success" : "warning"}>
            {studioIsWorking ? "Studio is working" : "Your next action"}
          </StatusBadge>
          <h2>{nextAction.name}</h2>
          <p>{nextAction.description}</p>
          {nextAction.dueDate ? (
            <span className="client-action-due">
              <CalendarDays size={14} />
              Due {date(nextAction.dueDate)}
            </span>
          ) : null}
        </div>
        <Link className="button button-dark" href={nextAction.href}>
          {nextAction.actionLabel}
        </Link>
      </section>
      <div className="client-grid">
        <section className="panel client-journey-card">
          <div className="panel-heading">
            <div>
              <h2>Your project journey</h2>
              <p>From inquiry through final delivery</p>
            </div>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track">
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="client-milestone-list">
            {value.milestones.map((milestone) => (
              <div
                className={`client-milestone client-milestone-${milestone.status}`}
                key={milestone.id}
              >
                <span>
                  {milestone.status === "complete" ? (
                    <CircleCheck />
                  ) : milestone.status === "current" ? (
                    <Clock3 />
                  ) : (
                    <span className="client-milestone-dot" />
                  )}
                </span>
                <span>
                  <strong>{milestone.label}</strong>
                  <small>{milestone.description}</small>
                </span>
                {milestone.status === "current" ? <em>Now</em> : null}
              </div>
            ))}
          </div>
        </section>
        <section className="panel event-detail-card">
          <div className="panel-heading">
            <div>
              <h2>Your event</h2>
              <p>{text(value.name)}</p>
            </div>
          </div>
          <div className="event-detail">
            <CalendarDays />
            <span>
              <small>Date</small>
              <strong>{date(value.eventDate)}</strong>
            </span>
          </div>
          <div className="event-detail">
            <MapPin />
            <span>
              <small>Location</small>
              <strong>
                {text(value.venueName ?? value.city, "Location pending")}
              </strong>
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

export function LiveClientProjectDetails() {
  const project = useProject();
  if (project.loading || project.error || !project.value)
    return (
      <PortalPageState
        eyebrow="Project overview"
        title="Your project details"
        description="The confirmed event information your studio has shared with you."
        loading={project.loading}
        error={project.error}
        empty={!project.loading && !project.error ? "Your project details will appear after the studio assigns your portal." : undefined}
      />
    );
  const value = project.value;
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Project overview</p>
      <h1>{text(value.name, "Your photography project")}</h1>
      <p>The confirmed details your studio has shared with you.</p>
      <section className="client-detail-grid">
        <article className="panel client-detail-card">
          <CalendarDays />
          <span><small>Event date</small><strong>{date(value.eventDate)}</strong></span>
        </article>
        <article className="panel client-detail-card">
          <MapPin />
          <span><small>Location</small><strong>{text(value.venueName ?? value.city, "Location pending")}</strong></span>
        </article>
        <article className="panel client-detail-card">
          <Images />
          <span><small>Project type</small><strong>{text(value.eventType, "Photography")}</strong></span>
        </article>
        <article className="panel client-detail-card">
          <UserRound />
          <span><small>Lead photographer</small><strong>{text(value.leadPhotographerName, "Your studio will confirm this")}</strong></span>
        </article>
      </section>
      <section className="panel client-help-card">
        <div>
          <h2>Need to update something?</h2>
          <p>Send your studio a message so they can review the change and keep the project plan in sync.</p>
        </div>
        <Link className="button button-light" href="/client/messages">Message your studio</Link>
      </section>
    </div>
  );
}

export function LiveClientDocuments() {
  const documents = useProjectRecords("documents");
  if (documents.loading || documents.error || documents.value.length === 0)
    return (
      <PortalPageState
        eyebrow="Shared files"
        title="Your documents"
        description="Contracts, schedules, and files shared by your studio."
        loading={documents.loading}
        error={documents.error}
        empty={!documents.loading && !documents.error ? "Documents shared by your studio will appear here." : undefined}
      />
    );
  const visible = documents.value.filter((item) => item.clientVisible !== false);
  if (!visible.length)
    return <PortalPageState eyebrow="Shared files" title="Your documents" description="Contracts, schedules, and files shared by your studio." loading={false} error={null} empty="Documents shared by your studio will appear here." />;
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Shared files</p>
      <h1>Your documents</h1>
      <p>Contracts, schedules, and other files your studio has made available to you.</p>
      <section className="panel client-document-list">
        {visible.map((document) => {
          const href = typeof document.temporaryUrl === "string"
            ? document.temporaryUrl
            : typeof document.downloadUrl === "string"
              ? document.downloadUrl
              : null;
          return (
            <article key={document.id}>
              <span className="client-document-icon"><FileText /></span>
              <span>
                <strong>{text(document.name ?? document.fileName, "Project document")}</strong>
                <small>{text(document.category, "Shared file").replaceAll("_", " ")}</small>
              </span>
              {href ? (
                <a href={href} rel="noreferrer" target="_blank">Open <ExternalLink /></a>
              ) : (
                <StatusBadge tone="neutral">Available soon</StatusBadge>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

export function LiveClientMessages() {
  const workspace = useWorkspace();
  const messages = useProjectRecords("messages");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function sendMessage() {
    if (!workspace.tenantId || !workspace.projectId || !body.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      await sendClientPortalMessage(
        workspace.tenantId,
        workspace.projectId,
        body.trim(),
      );
      setBody("");
      setNotice("Message sent securely to your studio.");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Your message could not be sent.",
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Conversation</p>
      <h1>Messages</h1>
      <p>Project updates and requests shared between you and {workspace.tenantName}.</p>
      {messages.loading || messages.error ? (
        <PortalState loading={messages.loading} error={messages.error} />
      ) : messages.value.length ? (
        <section className="panel client-message-list">
          {[...messages.value]
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .map((message) => (
              <article key={message.id}>
                <span className="client-message-icon"><MessageCircle /></span>
                <span>
                  <strong>{text(message.subject, "Project update")}</strong>
                  <p>{text(message.bodyPreview ?? message.body, "Open the email from your studio for full details.")}</p>
                  <small>{date(message.sentAt ?? message.createdAt)} · {text(message.status, "sent").replaceAll("_", " ")}</small>
                </span>
              </article>
            ))}
        </section>
      ) : (
        <section className="panel client-empty-moment">
          <FolderOpen />
          <div>
            <h2>No messages yet</h2>
            <p>When your studio sends a project update, it will appear here.</p>
          </div>
        </section>
      )}
      <section className="panel client-message-composer">
        <div>
          <p className="eyebrow">New message</p>
          <h2>Message {workspace.tenantName}</h2>
          <p>
            Use this for project questions or changes. Your message is saved in
            this secure project workspace.
          </p>
        </div>
        <label htmlFor="client-message-body">Message</label>
        <textarea
          id="client-message-body"
          maxLength={5000}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What would you like your studio to know?"
          rows={5}
          value={body}
        />
        <div className="client-message-composer-actions">
          <button
            className="button button-dark"
            disabled={sending || !body.trim()}
            onClick={() => void sendMessage()}
            type="button"
          >
            <MessageCircle />
            {sending ? "Sending…" : "Send secure message"}
          </button>
          {notice ? <p role="status">{notice}</p> : null}
        </div>
      </section>
    </div>
  );
}

function proposalErrorMessage(error: string) {
  const messages: Record<string, string> = {
    PROPOSAL_EXPIRED:
      "This proposal has expired. Message your studio for an updated version.",
    PROPOSAL_SUPERSEDED:
      "A newer proposal is available. Refresh this page to review the current version.",
    PROPOSAL_NOT_ACTIONABLE:
      "This proposal can no longer be changed from the portal.",
    PROJECT_STATE_CONFLICT:
      "Your project has already moved beyond this proposal. Refresh the page for the latest status.",
    PACKAGE_SNAPSHOT_CONFLICT:
      "The package linked to this proposal no longer matches the project. Your studio has been asked to review it.",
  };
  return messages[error] ?? error;
}

export function LiveClientProposal() {
  const workspace = useWorkspace();
  const proposals = useProjectRecords("proposals");
  const proposal = useMemo(
    () =>
      [...proposals.value].sort(
        (a, b) => number(b.version) - number(a.version),
      )[0],
    [proposals.value],
  );
  const [mode, setMode] = useState<"idle" | "accept" | "changes">("idle");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());

  if (proposals.loading || proposals.error || !proposal) {
    return (
      <PortalPageState
        eyebrow="Your offer"
        title="Your proposal"
        description="Review the exact coverage, price, payment schedule, and terms prepared for your project."
        loading={proposals.loading}
        error={proposals.error}
        empty={
          !proposals.loading && !proposals.error
            ? "Your studio is still preparing your proposal. You’ll be notified when it is ready."
            : undefined
        }
      />
    );
  }

  const pricing =
    proposal.pricingSnapshot &&
    typeof proposal.pricingSnapshot === "object"
      ? (proposal.pricingSnapshot as Record<string, unknown>)
      : {};
  const event =
    proposal.eventSnapshot && typeof proposal.eventSnapshot === "object"
      ? (proposal.eventSnapshot as Record<string, unknown>)
      : {};
  const lines = Array.isArray(pricing.lineItems)
    ? (pricing.lineItems as Array<Record<string, unknown>>)
    : [];
  const payments = Array.isArray(proposal.paymentSchedule)
    ? (proposal.paymentSchedule as Array<Record<string, unknown>>)
    : [];
  const storedStatus = text(proposal.status, "sent");
  const expired =
    !["accepted", "declined", "superseded"].includes(storedStatus) &&
    new Date(String(proposal.expiresAt)).valueOf() <= renderedAt;
  const status = localStatus ?? (expired ? "expired" : storedStatus);
  const actionable = ["sent", "viewed"].includes(status);

  async function submitDecision(decision: "accepted" | "declined") {
    if (!workspace.tenantId || !workspace.projectId) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await decideClientProposal(
        workspace.tenantId,
        workspace.projectId,
        proposal.id,
        decision,
        decision === "declined" ? reason.trim() : null,
      );
      setLocalStatus(result.status);
      setMode("idle");
      setNotice(
        decision === "accepted"
          ? "Proposal accepted. Your studio can now prepare the agreement."
          : "Your change request was sent to your studio.",
      );
    } catch (caught: unknown) {
      setNotice(
        proposalErrorMessage(
          caught instanceof Error
            ? caught.message
            : "Your decision could not be saved.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="client-booking-page client-proposal-page">
      <div className="client-proposal-heading">
        <div>
          <p className="eyebrow">Proposal · version {number(proposal.version)}</p>
          <h1>{text(pricing.packageName, "Photography proposal")}</h1>
          <p>
            Prepared for {text(event.name, "your photography project")} by{" "}
            {workspace.tenantName}.
          </p>
        </div>
        <StatusBadge tone={statusTone(status)}>
          {status.replaceAll("_", " ")}
        </StatusBadge>
      </div>

      <section className="client-proposal-summary">
        <span>
          <small>Event</small>
          <strong>{text(event.eventType, "Photography")}</strong>
        </span>
        <span>
          <small>Date</small>
          <strong>{date(event.eventDate)}</strong>
        </span>
        <span>
          <small>Location</small>
          <strong>{text(event.venue, "To be confirmed")}</strong>
        </span>
        <span>
          <small>Proposal valid through</small>
          <strong>{date(proposal.expiresAt)}</strong>
        </span>
      </section>

      <div className="client-proposal-grid">
        <section className="panel client-proposal-pricing">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Investment</p>
              <h2>Your selected coverage</h2>
            </div>
            <strong>{money(pricing.totalCents, pricing.currency)}</strong>
          </div>
          <div className="client-proposal-lines">
            {lines.map((line, index) => (
              <div key={`${String(line.description)}-${index}`}>
                <span>
                  <strong>{text(line.description, "Photography services")}</strong>
                  <small>
                    {number(line.quantity)} ×{" "}
                    {money(line.unitPriceCents, pricing.currency)}
                  </small>
                </span>
                <strong>{money(line.totalCents, pricing.currency)}</strong>
              </div>
            ))}
          </div>
          <dl className="client-proposal-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{money(pricing.subtotalCents, pricing.currency)}</dd>
            </div>
            {number(pricing.discountCents) > 0 ? (
              <div>
                <dt>Discount</dt>
                <dd>−{money(pricing.discountCents, pricing.currency)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Tax</dt>
              <dd>{money(pricing.taxCents, pricing.currency)}</dd>
            </div>
            <div className="client-proposal-total">
              <dt>Project total</dt>
              <dd>{money(pricing.totalCents, pricing.currency)}</dd>
            </div>
          </dl>
        </section>

        <aside className="panel client-proposal-payment-plan">
          <p className="eyebrow">Payment plan</p>
          <h2>What comes next</h2>
          {payments.map((payment, index) => (
            <div key={`${String(payment.label)}-${index}`}>
              <span>{index + 1}</span>
              <span>
                <strong>{text(payment.label, "Payment")}</strong>
                <small>
                  {payment.dueDate
                    ? `Due ${date(payment.dueDate)}`
                    : "Due date confirmed on the invoice"}
                </small>
              </span>
              <strong>{money(payment.amountCents, pricing.currency)}</strong>
            </div>
          ))}
          <p>
            Accepting this proposal does not sign a contract or collect a
            payment. Those remain separate, secure steps.
          </p>
        </aside>
      </div>

      <section className="panel client-proposal-terms">
        <div>
          <ShieldCheck />
          <span>
            <p className="eyebrow">Terms summary</p>
            <h2>Before you decide</h2>
          </span>
        </div>
        <p>{text(proposal.termsSummary, "Your studio will provide the full agreement as the next step.")}</p>
        <small>
          The signed agreement—not this summary—governs the photography
          services.
        </small>
      </section>

      {status === "accepted" ? (
        <section className="client-proposal-result client-proposal-result-success">
          <BadgeCheck />
          <div>
            <p className="eyebrow">Accepted</p>
            <h2>Your studio can prepare the agreement.</h2>
            <p>
              You’ll receive a separate secure Docusign request when the
              contract is ready.
            </p>
          </div>
          <Link className="button button-light" href="/client/contract">
            Contract status <ArrowRight />
          </Link>
        </section>
      ) : status === "declined" ? (
        <section className="client-proposal-result">
          <MessageCircle />
          <div>
            <p className="eyebrow">Changes requested</p>
            <h2>Your studio is reviewing your note.</h2>
            <p>This does not cancel your project or reserve a date.</p>
          </div>
          <Link className="button button-light" href="/client/messages">
            Message studio
          </Link>
        </section>
      ) : status === "expired" || status === "superseded" ? (
        <section className="client-proposal-result client-proposal-result-warning">
          <XCircle />
          <div>
            <p className="eyebrow">Proposal unavailable</p>
            <h2>
              {status === "expired"
                ? "This proposal has expired."
                : "A newer proposal replaced this version."}
            </h2>
            <p>Ask your studio to share the current offer before deciding.</p>
          </div>
          <Link className="button button-light" href="/client/messages">
            Message studio
          </Link>
        </section>
      ) : actionable ? (
        <section className="client-proposal-decision">
          <div>
            <p className="eyebrow">Your decision</p>
            <h2>Ready to move forward?</h2>
            <p>
              Acceptance locks this proposal to the project and asks your
              studio to prepare the contract. No charge is made now.
            </p>
          </div>
          {mode === "accept" ? (
            <div className="client-proposal-confirm">
              <BadgeCheck />
              <span>
                <strong>Accept proposal version {number(proposal.version)}?</strong>
                <small>
                  You are approving the coverage and {money(pricing.totalCents, pricing.currency)} project total shown above.
                </small>
              </span>
              <button
                className="button button-dark"
                disabled={submitting}
                onClick={() => void submitDecision("accepted")}
                type="button"
              >
                {submitting ? "Saving…" : "Confirm acceptance"}
              </button>
              <button
                className="button button-light"
                disabled={submitting}
                onClick={() => setMode("idle")}
                type="button"
              >
                Go back
              </button>
            </div>
          ) : mode === "changes" ? (
            <div className="client-proposal-change-request">
              <label htmlFor="proposal-change-request">
                What would you like your studio to change?
              </label>
              <textarea
                id="proposal-change-request"
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Describe the coverage, add-on, timing, or pricing question you would like reviewed."
                rows={4}
                value={reason}
              />
              <div>
                <button
                  className="button button-dark"
                  disabled={submitting || reason.trim().length < 10}
                  onClick={() => void submitDecision("declined")}
                  type="button"
                >
                  {submitting ? "Sending…" : "Send change request"}
                </button>
                <button
                  className="button button-light"
                  disabled={submitting}
                  onClick={() => setMode("idle")}
                  type="button"
                >
                  Go back
                </button>
              </div>
            </div>
          ) : (
            <div className="client-proposal-decision-actions">
              <button
                className="button button-dark"
                onClick={() => setMode("accept")}
                type="button"
              >
                Accept proposal <ArrowRight />
              </button>
              <button
                className="button button-light"
                onClick={() => setMode("changes")}
                type="button"
              >
                Request changes
              </button>
            </div>
          )}
          {notice ? <p className="client-proposal-notice" role="status">{notice}</p> : null}
        </section>
      ) : null}
      {notice && !actionable ? (
        <p className="client-proposal-notice" role="status">{notice}</p>
      ) : null}
    </div>
  );
}

export function LiveClientPackage() {
  const snapshots = useProjectRecords("packageSnapshots");
  const snapshot = snapshots.value[0];
  if (snapshots.loading || snapshots.error)
    return <PortalPageState eyebrow="Your selection" title="Your package" description="Coverage, deliverables, and the price preserved for this project." loading={snapshots.loading} error={snapshots.error} />;
  if (!snapshot)
    return <PortalPageState eyebrow="Your selection" title="Your package" description="Coverage, deliverables, and the price preserved for this project." loading={false} error={null} empty="Your selected package will appear after the studio confirms it for this project." />;
  const value = snapshot;
  const included = Array.isArray(value.includedDeliverables)
    ? value.includedDeliverables
    : Array.isArray(value.deliverables)
      ? value.deliverables
      : [];
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Your selection</p>
      <h1>{text(value.packageName ?? value.name, "Selected package")}</h1>
      <p>
        Package version {number(value.packageVersion ?? value.version)} ·
        selected {date(value.selectionDate ?? value.createdAt)}
      </p>
      <section className="panel client-package-card">
        <div>
          <h2>Locked project total</h2>
          <strong>{money(value.totalCents, value.currency)}</strong>
        </div>
        <ul>
          <li>
            <CircleCheck />{" "}
            {number(value.includedCoverageMinutes) / 60} coverage hours
          </li>
          <li>
            <CircleCheck /> {number(value.includedPhotographers)} photographer(s)
          </li>
          {included.map((item) => (
            <li key={String(item)}>
              <CircleCheck /> {String(item)}
            </li>
          ))}
        </ul>
        <div className="immutable-note">
          <Clock3 />
          <span>
            <strong>Your pricing is locked.</strong>
            <small>Future package edits cannot change this snapshot.</small>
          </span>
        </div>
      </section>
    </div>
  );
}

export function LiveClientContract() {
  const contracts = useProjectRecords("contracts");
  const contract = useMemo(
    () =>
      [...contracts.value].sort((a, b) =>
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
      )[0],
    [contracts.value],
  );
  if (contracts.loading || contracts.error || !contract)
    return <PortalPageState eyebrow="Agreement" title="Your contract" description="Review signature progress and open your secure Docusign request." loading={contracts.loading} error={contracts.error} empty={!contracts.loading && !contracts.error ? "Your agreement will appear after the studio sends it through Docusign." : undefined} />;
  const signers = Array.isArray(contract.signers)
    ? (contract.signers as Array<Record<string, unknown>>)
    : [];
  const signingUrl =
    typeof contract.signingUrl === "string" ? contract.signingUrl : null;
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Agreement</p>
      <h1>Photography services agreement</h1>
      <p>Your secure signature status from Docusign.</p>
      <section className="panel client-contract-card">
        <ShieldCheck />
        <div>
          <StatusBadge tone={statusTone(contract.status)}>
            {text(contract.status).replaceAll("_", " ")}
          </StatusBadge>
          <h2>
            {contract.status === "completed"
              ? "Every required signature is complete."
              : "Docusign is collecting required signatures."}
          </h2>
          {signers.map((signer) => (
            <div
              className={`client-signer ${signer.status === "completed" ? "" : "pending"}`}
              key={`${String(signer.email)}-${String(signer.order)}`}
            >
              <span>
                {signer.status === "completed" ? <CheckCircle2 /> : null}
                {text(signer.name)}
              </span>
              <strong>{text(signer.status)}</strong>
            </div>
          ))}
          {signingUrl ? (
            <a className="button button-dark" href={signingUrl} rel="noreferrer" target="_blank">
              Open secure Docusign <ExternalLink />
            </a>
          ) : (
            <p>Docusign sends each signer their secure signing link directly.</p>
          )}
        </div>
      </section>
      <p className="source-note">
        Only Docusign completion evidence can mark this contract complete.
      </p>
    </div>
  );
}

export function LiveClientPayments() {
  const invoices = useProjectRecords("invoiceReferences");
  if (invoices.loading || invoices.error || invoices.value.length === 0)
    return <PortalPageState eyebrow="Payments" title="Your payment schedule" description="Review amounts, due dates, and secure QuickBooks payment links." loading={invoices.loading} error={invoices.error} empty={!invoices.loading && !invoices.error ? "QuickBooks invoice links will appear when created by the studio." : undefined} />;
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Payments</p>
      <h1>Your payment schedule</h1>
      <p>QuickBooks Online is the accounting and payment system of record.</p>
      {invoices.value
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
        .map((invoice) => (
          <section className="panel client-payment-card" key={invoice.id}>
            <div>
              <span>
                <small>{text(invoice.kind)}</small>
                <strong>{money(invoice.amountCents, invoice.currency)}</strong>
              </span>
              <StatusBadge tone={statusTone(invoice.status)}>
                {text(invoice.status).replaceAll("_", " ")}
              </StatusBadge>
            </div>
            <p>
              Due {date(invoice.dueDate)} · Balance{" "}
              {money(invoice.balanceCents, invoice.currency)}
            </p>
            {typeof invoice.hostedUrl === "string" && invoice.hostedUrl ? (
              <a className="button button-dark" href={invoice.hostedUrl} rel="noreferrer" target="_blank">
                Open QuickBooks invoice <ExternalLink />
              </a>
            ) : (
              <p>Payment link pending QuickBooks synchronization.</p>
            )}
            <footer>
              <LockKeyhole /> StudioCue never receives your card or bank details.
            </footer>
          </section>
        ))}
    </div>
  );
}

export function LiveClientQuestionnaire() {
  const responses = useProjectRecords("questionnaireResponses");
  const current = responses.value[0];
  if (responses.loading || responses.error || !current)
    return <PortalPageState eyebrow="Project planning" title="Your questionnaire" description="Share the details your studio needs to plan your project." loading={responses.loading} error={responses.error} empty={!responses.loading && !responses.error ? "Your studio has not assigned a questionnaire yet." : undefined} />;
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Project planning</p>
      <h1>Your questionnaire</h1>
      <p>
        Save your progress and return at any time. Your studio will be notified
        when you submit the completed form.
      </p>
      <section className="panel">
        <ClientQuestionnaireForm
          projectId={text(current.projectId)}
          responseId={current.id}
          initialAnswers={
            current.answers && typeof current.answers === "object"
              ? (current.answers as Record<string, unknown>)
              : {}
          }
        />
      </section>
    </div>
  );
}

export function LiveClientSchedule() {
  const schedules = useProjectRecords("schedules");
  const [notice, setNotice] = useState<string | null>(null);
  const schedule = useMemo(
    () =>
      [...schedules.value].sort(
        (a, b) => number(b.version) - number(a.version),
      )[0],
    [schedules.value],
  );
  if (schedules.loading || schedules.error || !schedule)
    return <PortalPageState eyebrow="Event day" title="Your schedule" description="Review the current run of show and respond when your studio requests approval." loading={schedules.loading} error={schedules.error} empty={!schedules.loading && !schedules.error ? "The published run of show will appear here when it is ready for you." : undefined} />;
  const items = Array.isArray(schedule.items)
    ? (schedule.items as Array<Record<string, unknown>>)
    : [];
  async function decide(decision: "approved" | "changes_requested") {
    setNotice(null);
    try {
      await sendPlanningCommand("approveSchedule", {
        projectId: schedule.projectId,
        scheduleId: schedule.id,
        decision,
        notes:
          decision === "approved"
            ? "Approved by client in the StudioCue portal."
            : "Client requested schedule changes in the StudioCue portal.",
      });
      setNotice(
        decision === "approved"
          ? "Schedule approved."
          : "Change request sent to the studio.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Schedule response failed.",
      );
    }
  }
  return (
    <div className="client-booking-page">
      <p className="eyebrow">
        Version {number(schedule.version)} · {text(schedule.status).replaceAll("_", " ")}
      </p>
      <h1>Your event-day schedule</h1>
      <p>Times are shown in {text(schedule.timezone)}.</p>
      <section className="mobile-schedule">
        {items
          .filter((item) =>
            ["client", "shared"].includes(text(item.visibility, "shared")),
          )
          .map((item) => (
            <article key={text(item.id)}>
              <span>
                <strong>
                  {new Date(String(item.startAt)).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </strong>
                <small>
                  {new Date(String(item.endAt)).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              <div>
                <h2>{text(item.title)}</h2>
                <p>
                  <MapPin /> {text(item.location, "Location pending")}
                </p>
              </div>
            </article>
          ))}
      </section>
      <div className="schedule-client-actions">
        <button className="button button-dark" onClick={() => void decide("approved")} type="button">
          Approve this version
        </button>
        <button className="button button-light" onClick={() => void decide("changes_requested")} type="button">
          Request changes
        </button>
      </div>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}

export function LiveClientDelivery() {
  const workspace = useWorkspace();
  const deliveries = useProjectRecords("deliveryRecords");
  const delivery = deliveries.value[0];
  if (deliveries.loading || deliveries.error || !delivery)
    return <PortalPageState eyebrow="Your photographs" title="Delivery" description="Open your gallery and confirm when your download is complete." loading={deliveries.loading} error={deliveries.error} empty={!deliveries.loading && !deliveries.error ? "Your secure gallery details will appear after delivery." : undefined} />;
  return (
    <div className="client-post-event">
      <header>
        <p className="eyebrow">Your photographs</p>
        <h1>Your gallery is ready.</h1>
        <p>Keep your access details private and download before expiration.</p>
      </header>
      <section className="client-gallery-card">
        <div className="gallery-art">
          <Images />
          <span>{workspace.tenantName}</span>
        </div>
        <div className="gallery-copy">
          <StatusBadge tone={statusTone(delivery.status)}>
            {text(delivery.status)}
          </StatusBadge>
          <h2>{workspace.projectName}</h2>
          <dl>
            <div>
              <dt>
                <LockKeyhole /> Access code
              </dt>
              <dd>{text(delivery.accessCode, "Not required")}</dd>
            </div>
            <div>
              <dt>
                <CalendarDays /> Available until
              </dt>
              <dd>{date(delivery.expirationDate)}</dd>
            </div>
          </dl>
          <a className="button button-dark" href={text(delivery.galleryUrl)} target="_blank" rel="noreferrer">
            <ExternalLink /> Open secure gallery
          </a>
          <PostEventAction
            type="markDeliveryDownloaded"
            input={{
              projectId: delivery.projectId,
              deliveryRecordId: delivery.id,
            }}
            label="Confirm download complete"
            completedLabel="Download confirmed"
          />
        </div>
      </section>
    </div>
  );
}

export function LiveClientReviews() {
  const workspace = useWorkspace();
  const reviews = useProjectRecords("reviewRequests");
  const review = reviews.value.find((item) => item.status !== "skipped");
  if (reviews.loading || reviews.error || !review)
    return <PortalPageState eyebrow="After delivery" title="Reviews" description="Your studio may invite you to share feedback after delivery." loading={reviews.loading} error={reviews.error} empty={!reviews.loading && !reviews.error ? "A review request may appear after your gallery is delivered." : undefined} />;
  const confirmed = ["client_confirmed", "manually_confirmed"].includes(
    String(review.status),
  );
  return (
    <div className="client-post-event">
      <header>
        <p className="eyebrow">A small favor</p>
        <h1>How was your experience?</h1>
      </header>
      <section className="client-review-card">
        <Heart />
        <h2>Thank you for trusting {workspace.tenantName}.</h2>
        <p>
          Opening the review site records engagement only. StudioCue never
          claims that a review was posted from a click.
        </p>
        <a className="button button-dark" href={text(review.destinationUrl)} target="_blank" rel="noreferrer">
          <Star /> Open review site
        </a>
        <div className="review-confirm-boundary">
          <CheckCircle2 />
          <span>
            <strong>Already completed?</strong>
            <small>Your explicit confirmation stops future reminders.</small>
          </span>
        </div>
        {!confirmed ? (
          <PostEventAction
            type="confirmReview"
            input={{
              projectId: review.projectId,
              reviewRequestId: review.id,
            }}
            label="I’ve completed my review"
            completedLabel="Review confirmed"
          />
        ) : (
          <StatusBadge tone="success">Confirmed</StatusBadge>
        )}
      </section>
    </div>
  );
}
