"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  CircleCheck,
  Clock3,
  CreditCard,
  ExternalLink,
  FileText,
  FolderOpen,
  Heart,
  Images,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Paperclip,
  RotateCw,
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
  portalPastNotice,
  portalStageIsBehind,
  type PortalArea,
} from "@/features/client/portal-stage";
import type { ClientMilestone } from "@/server/client/portal-experience";
import { daysUntilEvent } from "@/lib/format/event-date";
import {
  displayableScheduleItems,
  scheduleItemClock,
} from "@/features/schedules/item-clock";
import {
  decideClientProposal,
  getClientAvailablePackages,
  getClientPortalProject,
  getClientPortalRecords,
  sendClientPortalMessage,
  selectClientPackage,
  type ClientPortalCollection,
  type ClientPortalProject,
} from "@/lib/client/portal-client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import {
  uploadClientMessageAttachment,
  type ClientMessageAttachment,
} from "@/lib/client/message-upload";
import { dataIsLive } from "@/lib/runtime-mode";
import { statusLabel } from "@/features/format/status-label";
import { friendlyError } from "@/lib/ai/friendly-error";
import { isStandingInvoice } from "@/features/booking/invoice-standing";

type RecordValue = Record<string, unknown> & { id: string };
type Loadable<T> = {
  value: T;
  loading: boolean;
  error: string | null;
  refresh?: () => void;
};

function mockClientRecords(
  collectionName: ClientPortalCollection,
): RecordValue[] {
  const records: Partial<Record<ClientPortalCollection, RecordValue[]>> = {
    proposals: [{
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
        // Canonical field name, matching features/packages/schema.ts. The
        // fixture previously said `totalCents`, so the component rendered
        // correctly here and $0.00 against real documents — the mock was
        // hiding the bug rather than catching it.
        lineItems: [
          {
            description: "Signature wedding collection",
            quantity: 1,
            unitPriceCents: 650000,
            lineTotalCents: 650000,
          },
          {
            description: "Engagement session",
            quantity: 1,
            unitPriceCents: 65000,
            lineTotalCents: 65000,
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
    }],
    contracts: [{
      id: "demo-contract",
      provider: "dropbox_sign",
      status: "sent",
      updatedAt: "2026-08-12T14:00:00.000Z",
      signingUrl: "https://example.com/secure-signing",
      signers: [
        { name: "Alex Rivera", email: "alex@example.com", order: 1, status: "pending" },
        { name: "Jordan Rivera", email: "jordan@example.com", order: 2, status: "pending" },
      ],
    }],
    invoiceReferences: [{
      id: "demo-invoice",
      kind: "Retainer",
      status: "open",
      currency: "USD",
      amountCents: 182650,
      balanceCents: 182650,
      dueDate: "2026-08-22",
      hostedUrl: "https://example.com/secure-payment",
      lastSyncedAt: "2026-08-15T12:00:00.000Z",
    }],
    schedules: [{
      id: "demo-client-schedule",
      projectId: "demo-project",
      version: 3,
      status: "client_review",
      timezone: "America/New_York",
      updatedAt: "2026-08-15T12:00:00.000Z",
      items: [
        { id: "arrival", startAt: "2027-06-12T14:00:00-04:00", endAt: "2027-06-12T14:30:00-04:00", title: "Photographer arrival", location: "The Garden Conservatory", visibility: "shared" },
        { id: "ceremony", startAt: "2027-06-12T17:00:00-04:00", endAt: "2027-06-12T17:30:00-04:00", title: "Ceremony", location: "Garden ceremony space", visibility: "client" },
      ],
    }],
    messages: [{
      id: "demo-studio-message",
      subject: "Your planning timeline",
      body: "We prepared the first schedule for your review.",
      bodyPreview: "We prepared the first schedule for your review.",
      context: "Event schedule",
      direction: "outbound",
      visibility: "shared",
      status: "delivered",
      createdAt: "2026-08-14T15:00:00.000Z",
      clientReadAt: null,
    }],
    documents: [{
      id: "demo-shared-file",
      name: "Venue certificate of insurance",
      category: "coi",
      status: "available",
      downloadUrl: "https://example.com/shared-document.pdf",
      updatedAt: "2027-06-01T12:00:00.000Z",
    }],
    deliveryRecords: [{
      id: "demo-delivery",
      projectId: "demo-project",
      provider: "pixieset",
      galleryUrl: "https://example.com/gallery",
      accessCode: "RIVERA27",
      expirationDate: "2027-08-01",
      deliveryDate: "2027-07-01",
      status: "delivered",
    }],
    albumWorkflows: [{
      id: "demo-album",
      projectId: "demo-project",
      status: "design_sent",
      designProofUrl: "https://example.com/album-proof",
      creativeAuthority: "studio_human",
      updatedAt: "2027-07-10T12:00:00.000Z",
    }],
    reviewRequests: [{
      id: "demo-review",
      projectId: "demo-project",
      status: "delivered",
      destinationLabel: "Google",
      destinationUrl: "https://example.com/review",
      deliveredAt: "2027-07-02T12:00:00.000Z",
    }],
  };
  return records[collectionName] ?? [];
}

/** Unpaid and past its due date, from the client's point of view. */
function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function invoiceOverdue(invoice: Record<string, unknown>): boolean {
  if (number(invoice.balanceCents) <= 0) return false;
  const due = text(invoice.dueDate).slice(0, 10);
  return Boolean(due) && due < new Date().toISOString().slice(0, 10);
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
              friendlyError(caught, "Project details could not be loaded."),
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
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loadable<RecordValue[]>>({
    value: mockClientRecords(collectionName),
    loading: dataIsLive,
    error: null,
  });
  const refresh = useCallback(() => {
    if (!dataIsLive) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    setAttempt((current) => current + 1);
  }, []);
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
    attempt,
    collectionName,
    workspace.loading,
    workspace.projectId,
    workspace.tenantId,
  ]);
  return { ...state, refresh };
}

function PortalState({
  loading,
  error,
  empty,
  emptyTitle,
}: {
  loading: boolean;
  error: string | null;
  empty?: string;
  emptyTitle?: string;
}) {
  const workspace = useWorkspace();
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
        <button className="button button-light button-sm" onClick={workspace.retry} type="button">
          <RotateCw size={14} /> Try again
        </button>
      </section>
    );
  if (empty)
    return (
      <section className="panel portal-live-state">
        <Clock3 />
        <span>
          {/* "Nothing to complete yet" was the headline on six pages, standing
              in both for "no task for you" and for "no such record exists" —
              and on a finished project it was wrong on both counts. */}
          <strong>{emptyTitle ?? "Nothing to complete yet"}</strong>
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
  area,
  milestones,
}: {
  eyebrow: string;
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  empty?: string;
  /**
   * Which part of the project this page is, so an empty state can tell the
   * difference between "not yet" and "not ever". Without it every page here
   * promised a future step to a couple whose wedding had already happened.
   */
  area?: PortalArea;
  milestones?: ClientMilestone[] | null;
}) {
  const behind = area ? portalStageIsBehind(milestones, area) : false;
  const past = behind && area ? portalPastNotice(area) : null;
  return (
    <div className="client-booking-page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <PortalState
        emptyTitle={past?.title}
        empty={empty ? (past ? past.detail : empty) : undefined}
        error={error}
        loading={loading}
      />
      {empty && !past ? (
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
  const contracts = useProjectRecords("contracts");
  const invoices = useProjectRecords("invoiceReferences");
  const schedules = useProjectRecords("schedules");
  const documents = useProjectRecords("documents");
  const deliveries = useProjectRecords("deliveryRecords");
  const albums = useProjectRecords("albumWorkflows");
  const [renderedAt] = useState(() => Date.now());
  if (project.loading || project.error || !project.value)
    return (
      <PortalPageState
        eyebrow="Your client portal"
        title={workspace.error ? "Your project portal" : `Hello, ${workspace.userName.split(" ")[0]}.`}
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
  // The couple's countdown and the studio's must be the same number. This
  // anchored the event at midday and ceil'd from the exact render instant,
  // while the studio rounds from the start of today — so before noon the
  // portal read one day higher than the studio for the same wedding, every
  // day. One shared function, no second opinion.
  const days = hasEventDate
    ? daysUntilEvent(value.eventDate, new Date(renderedAt))
    : null;
  const progress = value.clientProgress;
  const nextAction = value.nextClientAction;
  const studioIsWorking = nextAction.responsibility === "studio";
  const signedContract = contracts.value.find((contract) =>
    ["completed", "signed"].includes(String(contract.status)),
  );
  const paidInvoice = invoices.value.find(
    (invoice) =>
      invoice.status === "paid" || Number(invoice.balanceCents ?? 1) === 0,
  );
  // The largest unsettled invoice, and whether it has gone past its date. A
  // couple needs one number here, not a status word.
  const today = new Date().toISOString().slice(0, 10);
  const outstanding = invoices.value
    .filter(
      (invoice) =>
        isStandingInvoice(invoice.status) &&
        Number(invoice.balanceCents ?? 0) > 0,
    )
    .map((invoice) => ({
      balanceCents: Number(invoice.balanceCents ?? 0),
      currency: invoice.currency,
      overdue: Boolean(invoice.dueDate) && String(invoice.dueDate) < today,
    }))
    .sort((left, right) => right.balanceCents - left.balanceCents)[0];
  const currentSchedule = [...schedules.value].sort(
    (left, right) => number(right.version) - number(left.version),
  )[0];
  const sharedCoi = documents.value.find(
    (document) => document.category === "coi",
  );
  const sharedVideo = documents.value.find((document) =>
    ["video", "film", "highlight_film"].includes(String(document.category)),
  );
  const delivery = deliveries.value[0];
  const album = albums.value[0];
  const artifacts = [
    {
      label: "Signed contract",
      // Said "Signed copy available", and the page it links to offers no copy —
      // only "Ask your studio about this agreement". The contract record holds a
      // `signedDocumentId`, but serving the document needs a lookup and a signed
      // URL, so the tile states what is actually true today.
      detail: signedContract ? "Signature complete" : "Awaiting completion",
      ready: Boolean(signedContract),
      href: "/client/contract",
      icon: FileText,
    },
    {
      label: "Payment",
      // `paidInvoice` is true when *any* invoice is settled, so a paid retainer
      // made this read "Payment evidence recorded" while the final balance was
      // overdue — the couple's reasonable reading was that they had paid. The
      // tile now reflects what is outstanding, which is the only thing they
      // need from it.
      detail: outstanding
        ? `${money(outstanding.balanceCents, outstanding.currency)} still to pay${
            outstanding.overdue ? " · overdue" : ""
          }`
        : paidInvoice
          ? "Paid in full"
          : "Check provider status",
      ready: Boolean(paidInvoice) && !outstanding,
      href: "/client/payments",
      icon: CreditCard,
    },
    {
      /**
       * Any schedule at all counted as an approved one.
       *
       * A run of show still sitting in `client_review` was listed here as
       * "Approved schedule · Version 4" under the heading "Your approved
       * records", while the Records page — which filters on approved or
       * published, correctly — said no records existed at all. Two pages in one
       * portal, opposite answers about the same document.
       */
      label: "Event schedule",
      detail: !currentSchedule
        ? "Not published yet"
        : ["approved", "published"].includes(text(currentSchedule.status))
          ? `Version ${number(currentSchedule.version)} · approved`
          : `Version ${number(currentSchedule.version)} · awaiting your review`,
      ready:
        Boolean(currentSchedule) &&
        ["approved", "published"].includes(text(currentSchedule.status)),
      href: "/client/schedule",
      icon: CalendarDays,
    },
    {
      label: "Shared COI",
      detail: sharedCoi ? "Approved certificate available" : "Not shared",
      ready: Boolean(sharedCoi),
      href: "/client/documents",
      icon: ShieldCheck,
    },
    {
      label: "Gallery",
      detail: delivery ? "Gallery delivered" : "In production",
      ready: Boolean(delivery),
      href: "/client/delivery",
      icon: Images,
    },
    {
      label: "Video",
      detail: sharedVideo ? "Film available" : "Not available yet",
      ready: Boolean(sharedVideo),
      href: "/client/documents",
      icon: ExternalLink,
    },
    {
      label: "Album",
      detail: album
        ? statusLabel(album.status)
        : "Not included or not started",
      ready: Boolean(album),
      href: "/client/delivery",
      icon: BookOpenCheck,
    },
  ];
  const availableRecords = artifacts.filter((artifact) => artifact.ready);
  const upcomingMilestones = value.milestones
    .filter((milestone) => milestone.status !== "complete")
    .slice(0, 3);
  return (
    <>
      <div className="portal-hero">
        <div>
          <p className="eyebrow">Your {text(value.eventType, "photography")} project</p>
          <h1>Hello, {workspace.userName.split(" ")[0]}.</h1>
          <p>Everything approved for your project, in one secure place.</p>
        </div>
        <div className="event-countdown">
          {/* `Math.max(0, days)` printed a large "0" above "event complete" for
              every couple whose day had passed — a countdown widget pressed
              into service as a status. Past the day, the number that means
              something is how long ago it was. */}
          <strong>
            {days === null ? "—" : days < 0 ? Math.abs(days) : days}
          </strong>
          <span>
            {days === null
              ? "date pending"
              : days < 0
                ? `${Math.abs(days) === 1 ? "day" : "days"} since your day`
                : days === 0
                  ? "today"
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
      <section className="panel client-artifact-hub">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Project records</p>
            <h2>Your approved records</h2>
            <p>
              Current signed, paid, approved, or delivered records stay here.
            </p>
          </div>
          <FolderOpen aria-hidden="true" />
        </div>
        <div>
          {availableRecords.map((artifact) => {
            const Icon = artifact.icon;
            return (
              <Link
                className={artifact.ready ? "is-ready" : ""}
                href={artifact.href}
                key={artifact.label}
              >
                <Icon />
                <span>
                  <strong>{artifact.label}</strong>
                  <small>{artifact.detail}</small>
                </span>
                {artifact.ready ? (
                  <CheckCircle2 />
                ) : (
                  <Clock3 />
                )}
              </Link>
            );
          })}
          {!availableRecords.length ? (
            <div className="client-records-empty">
              <Clock3 />
              <span>
                <strong>No approved records yet</strong>
                <small>They will appear here as your project progresses.</small>
              </span>
            </div>
          ) : null}
        </div>
      </section>
      <div className="client-grid">
        <section className="panel client-journey-card">
          <div className="panel-heading">
            <div>
              <h2>What happens next</h2>
              <p>Your current stage and the next milestones</p>
            </div>
            {/* A bare "67%" with nothing saying what it counted. */}
            <strong title="Project milestones complete">
              {progress}% <em>done</em>
            </strong>
          </div>
          <div className="progress-track">
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="client-milestone-list">
            {upcomingMilestones.map((milestone) => (
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
            {!upcomingMilestones.length ? (
              <div className="client-milestone client-milestone-complete">
                <span><CircleCheck /></span>
                <span>
                  <strong>Your project is complete</strong>
                  <small>Your approved records remain available here.</small>
                </span>
              </div>
            ) : null}
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
          {/* "Your studio will confirm this" was shown to a couple whose
              wedding had already been shot — a promise about a future step on a
              project that is past it. */}
          <span><small>Lead photographer</small><strong>{text(
            value.leadPhotographerName,
            portalStageIsBehind(value.milestones, "schedule")
              ? "Ask your studio who covered your day"
              : "Your studio will confirm this",
          )}</strong></span>
        </article>
      </section>
      <section className="panel client-help-card">
        <div>
          <h2>Need to update something?</h2>
          <p>Send your studio a message so they can review the change and keep the project plan in sync.</p>
        </div>
        <Link className="button button-light" href="/client/messages">Message your studio</Link>
      </section>
      {value.clientStage === "Complete" ? (
        <section className="client-project-closed">
          <BadgeCheck />
          <div>
            <p className="eyebrow">Project complete</p>
            <h2>Your project is safely archived.</h2>
            <p>Signed agreements, payment references, approved schedules, delivery details, and shared files remain available in your records.</p>
          </div>
          <Link className="button button-light" href="/client/documents">
            Open project records <ArrowRight />
          </Link>
        </section>
      ) : null}
    </div>
  );
}

export function LiveClientDocuments() {
  const documents = useProjectRecords("documents");
  const contracts = useProjectRecords("contracts");
  const invoices = useProjectRecords("invoiceReferences");
  const schedules = useProjectRecords("schedules");
  const deliveries = useProjectRecords("deliveryRecords");
  const albums = useProjectRecords("albumWorkflows");
  const loading = [documents, contracts, invoices, schedules, deliveries, albums].some(
    (collection) => collection.loading,
  );
  const error = [documents, contracts, invoices, schedules, deliveries, albums]
    .map((collection) => collection.error)
    .find(Boolean) ?? null;
  const visibleDocuments = documents.value.filter(
    (item) => item.clientVisible !== false,
  );
  type ClientRecordRow = {
    id: string;
    label: string;
    detail: string;
    status: string;
    href: string | null;
    external: boolean;
    /** Overrides the default "Review" verb — money you owe wants "Pay". */
    actionLabel?: string;
  };
  const projectRecords: ClientRecordRow[] = [
    ...contracts.value
      .filter((record) => ["completed", "signed"].includes(text(record.status)))
      .map((record) => ({
        id: `contract-${record.id}`,
        label: "Signed photography agreement",
        detail: `Contract · ${date(record.completedAt ?? record.updatedAt)}`,
        status: text(record.status),
        href: "/client/contract",
        external: false,
      })),
    ...invoices.value
      .filter((record) => isStandingInvoice(record.status))
      .map((record) => ({
      id: `invoice-${record.id}`,
      // Was `${record.kind} invoice`, rendering "final invoice" and "retainer
      // invoice" in lowercase beside "Signed photography agreement". And it
      // stated the amount and date with no sign the balance was 27 days past
      // due, while /client/payments correctly said "Overdue".
      label: `${sentenceCase(text(record.kind, "Project"))} invoice`,
      detail: invoiceOverdue(record)
        ? `${money(record.balanceCents, record.currency)} still to pay · overdue since ${date(record.dueDate)}`
        : number(record.balanceCents) > 0
          ? `${money(record.balanceCents, record.currency)} due ${date(record.dueDate)}`
          : `${money(record.amountCents, record.currency)} · paid`,
      status: text(record.status),
      href: "/client/payments",
      external: false,
      // "Review" is the wrong verb for money you owe.
      actionLabel: number(record.balanceCents) > 0 ? "Pay" : "Review",
    })),
    ...schedules.value
      .filter((record) => ["approved", "published"].includes(text(record.status)))
      .map((record) => ({
        id: `schedule-${record.id}`,
        label: `Event schedule · version ${number(record.version)}`,
        detail: `Schedule · ${date(record.publishedAt ?? record.approvedAt ?? record.updatedAt)}`,
        status: text(record.status),
        href: "/client/schedule",
        external: false,
      })),
    ...deliveries.value.map((record) => ({
      id: `delivery-${record.id}`,
      label: "Photography gallery",
      detail: `Delivery · ${date(record.deliveryDate ?? record.updatedAt)}`,
      status: text(record.status),
      href: "/client/delivery",
      external: false,
    })),
    ...albums.value.map((record) => ({
      id: `album-${record.id}`,
      label: "Album record",
      detail: `Album · ${statusLabel(record.status)}`,
      status: text(record.status),
      href: "/client/delivery",
      external: false,
    })),
    ...visibleDocuments.map((record) => ({
      id: `document-${record.id}`,
      label: text(record.name ?? record.fileName, "Project document"),
      detail: text(record.category, "Shared file").replaceAll("_", " "),
      status: text(record.status, "available"),
      href:
        typeof record.temporaryUrl === "string"
          ? record.temporaryUrl
          : typeof record.downloadUrl === "string"
            ? record.downloadUrl
            : null,
      external: true,
    })),
  ];
  if (loading || error || projectRecords.length === 0)
    return (
      <PortalPageState
        eyebrow="Project records"
        title="Your records"
        description="Signed agreements, payments, schedules, deliveries, and files in one place."
        loading={loading}
        error={error}
        empty={!loading && !error ? "Approved project records will appear here as your project progresses." : undefined}
      />
    );
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Project records</p>
      <h1>Your records</h1>
      <p>One permanent home for every approved record your studio has shared.</p>
      <section className="panel client-document-list">
        {projectRecords.map((record) => (
            <article key={record.id}>
              <span className="client-document-icon"><FileText /></span>
              <span>
                <strong>{record.label}</strong>
                <small>{record.detail}</small>
              </span>
              {record.href ? (
                record.external ? (
                  <a href={record.href} rel="noreferrer" target="_blank">Open <ExternalLink /></a>
                ) : (
                  <Link href={record.href}>
                    {record.actionLabel ?? "Review"} <ArrowRight />
                  </Link>
                )
              ) : (
                <StatusBadge tone={statusTone(record.status)}>{statusLabel(record.status)}</StatusBadge>
              )}
            </article>
          ))}
      </section>
    </div>
  );
}

export function LiveClientMessages() {
  const workspace = useWorkspace();
  const messages = useProjectRecords("messages");
  const draftId = useRef<string | null>(null);
  const [subject, setSubject] = useState("Project question");
  const [context, setContext] = useState<string | null>(null);
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<ClientMessageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const requestedContext = new URLSearchParams(window.location.search).get("context");
    if (!requestedContext) return;
    queueMicrotask(() => {
      setContext(requestedContext.slice(0, 120));
      setSubject(`${requestedContext} question`.slice(0, 120));
    });
  }, []);
  async function addAttachments(files: FileList | null) {
    if (!files || !workspace.tenantId || !workspace.projectId) return;
    const selected = Array.from(files).slice(0, 5 - attachments.length);
    if (!selected.length) return;
    draftId.current ??= crypto.randomUUID();
    setUploading(true);
    setNotice(null);
    try {
      const uploaded: ClientMessageAttachment[] = [];
      for (const file of selected) {
        uploaded.push(
          await uploadClientMessageAttachment({
            tenantId: workspace.tenantId,
            projectId: workspace.projectId,
            draftId: draftId.current,
            file,
          }),
        );
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The attachment could not be uploaded."));
    } finally {
      setUploading(false);
    }
  }
  async function sendMessage() {
    if (!workspace.tenantId || !workspace.projectId || !body.trim() || !subject.trim()) return;
    draftId.current ??= crypto.randomUUID();
    setSending(true);
    setNotice(null);
    try {
      await sendClientPortalMessage(
        workspace.tenantId,
        workspace.projectId,
        {
          subject: subject.trim(),
          body: body.trim(),
          context,
          replyToMessageId,
          attachments,
          idempotencyKey: draftId.current,
        },
      );
      setBody("");
      setSubject("Project question");
      setContext(null);
      setReplyToMessageId(null);
      setAttachments([]);
      draftId.current = null;
      setNotice("Message sent securely to your studio.");
      messages.refresh?.();
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Your message could not be sent."),
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
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
            .map((message) => {
              const fromStudio = message.direction === "outbound";
              const messageAttachments = Array.isArray(message.attachmentReferences)
                ? (message.attachmentReferences as Array<Record<string, unknown>>)
                : [];
              return (
              <article className={fromStudio ? "is-studio" : "is-client"} key={message.id}>
                <span className="client-message-icon"><MessageCircle /></span>
                <span>
                  <span className="client-message-title">
                    <strong>{text(message.subject, "Project update")}</strong>
                    {fromStudio && !message.clientReadAt ? <em>New</em> : null}
                  </span>
                  <p>{text(message.bodyPreview ?? message.body, "Open the email from your studio for full details.")}</p>
                  {messageAttachments.length ? (
                    <small><Paperclip /> {messageAttachments.map((attachment) => text(attachment.name, "Attachment")).join(", ")}</small>
                  ) : null}
                  <small>{fromStudio ? workspace.tenantName : "You"} · {date(message.sentAt ?? message.createdAt)} · {statusLabel(message.status) || "sent"}</small>
                </span>
                {fromStudio ? (
                  <button
                    className="client-message-reply"
                    onClick={() => {
                      setReplyToMessageId(message.id);
                      setContext(text(message.context, "Project message"));
                      setSubject(`Re: ${text(message.subject, "Project update")}`.slice(0, 120));
                      document.getElementById("client-message-body")?.focus();
                    }}
                    type="button"
                  >
                    Reply
                  </button>
                ) : null}
              </article>
            );})}
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
        {context ? (
          <div className="client-message-context">
            <span>About: <strong>{context}</strong></span>
            <button onClick={() => setContext(null)} type="button">Clear</button>
          </div>
        ) : null}
        <label htmlFor="client-message-subject">Subject</label>
        <input
          id="client-message-subject"
          maxLength={120}
          onChange={(event) => setSubject(event.target.value)}
          value={subject}
        />
        <label htmlFor="client-message-body">Message</label>
        <textarea
          id="client-message-body"
          maxLength={5000}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What would you like your studio to know?"
          rows={5}
          value={body}
        />
        <div className="client-message-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.storagePath}>
              <Paperclip /> {attachment.name}
              <button
                aria-label={`Remove ${attachment.name}`}
                onClick={() => setAttachments((current) => current.filter((item) => item.storagePath !== attachment.storagePath))}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
          {attachments.length < 5 ? (
            <label className="button button-light" htmlFor="client-message-files">
              <Paperclip /> {uploading ? "Uploading…" : "Attach files"}
            </label>
          ) : null}
          <input
            accept=".pdf,.docx,.jpg,.jpeg,.png"
            disabled={uploading}
            hidden
            id="client-message-files"
            multiple
            onChange={(event) => {
              void addAttachments(event.target.files);
              event.target.value = "";
            }}
            type="file"
          />
          <small>PDF, Word, JPG, or PNG · 12 MB each · securely scanned before studio access</small>
        </div>
        <div className="client-message-composer-actions">
          <button
            className="button button-dark"
            disabled={sending || uploading || !body.trim() || !subject.trim()}
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
  const portalProject = useProject();
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
        area="proposal"
        milestones={portalProject.value?.milestones ?? null}
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
          friendlyError(caught, "Your decision could not be saved."),
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
                {/*
                  Two field names reach this component for one number. Package
                  snapshots store `lineTotalCents` (features/packages/schema.ts),
                  and the portal route serves those documents unchanged — while
                  functions/src/booking/proposals.ts and
                  server/services/proposal-service.ts rename it to `totalCents`
                  on their way out. Reading only one name renders $0.00 on the
                  other path, which is what the client portal was doing on a
                  real $8,950 proposal.
                */}
                <strong>
                  {money(line.lineTotalCents ?? line.totalCents, pricing.currency)}
                </strong>
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
              You’ll receive a separate secure signature request when the
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
  const workspace = useWorkspace();
  const snapshots = useProjectRecords("packageSnapshots");
  const snapshot = snapshots.value[0];
  const [packages, setPackages] = useState<RecordValue[]>([]);
  const [packageLoading, setPackageLoading] = useState(dataIsLive);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (
      !dataIsLive ||
      workspace.loading ||
      !workspace.tenantId ||
      !workspace.projectId ||
      snapshot
    ) {
      if (!dataIsLive || snapshot) queueMicrotask(() => setPackageLoading(false));
      return;
    }
    let active = true;
    void getClientAvailablePackages(
      workspace.tenantId,
      workspace.projectId,
    )
      .then((result) => {
        if (active) setPackages(result.packages as RecordValue[]);
      })
      .catch((caught: unknown) => {
        if (active)
          setNotice(
            friendlyError(caught, "Packages could not be loaded."),
          );
      })
      .finally(() => {
        if (active) setPackageLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    snapshot,
    workspace.loading,
    workspace.projectId,
    workspace.tenantId,
  ]);
  if (snapshots.loading || snapshots.error)
    return <PortalPageState eyebrow="Your selection" title="Your package" description="Coverage, deliverables, and the price preserved for this project." loading={snapshots.loading} error={snapshots.error} />;
  if (!snapshot) {
    if (packageLoading)
      return <PortalPageState eyebrow="Choose coverage" title="Photography packages" description="Compare the studio’s current options and preserve your selection." loading error={null} />;
    return (
      <div className="client-booking-page">
        <p className="eyebrow">Choose coverage</p>
        <h1>Photography packages</h1>
        <p>
          Compare the studio’s current options. Your exact selection, add-ons,
          tax, retainer, and total will be preserved when you confirm.
        </p>
        <div className="client-package-options">
          {packages.map((studioPackage) => {
            const addOns = Array.isArray(studioPackage.addOns)
              ? (studioPackage.addOns as Array<Record<string, unknown>>)
              : [];
            const selectedForPackage = addOns.filter((addOn) =>
              selectedAddOns.includes(`${studioPackage.id}:${String(addOn.id)}`),
            );
            const total =
              number(studioPackage.basePriceCents) +
              selectedForPackage.reduce(
                (sum, addOn) => sum + number(addOn.unitPriceCents),
                0,
              );
            return (
              <article className="panel client-package-option" key={studioPackage.id}>
                <div>
                  <span>
                    <h2>{text(studioPackage.name, "Photography package")}</h2>
                    <strong>
                      {money(studioPackage.basePriceCents, studioPackage.currency)}
                    </strong>
                  </span>
                  <p>{text(studioPackage.description)}</p>
                </div>
                <ul>
                  <li>
                    <CircleCheck />{" "}
                    {number(studioPackage.includedCoverageMinutes) / 60} hours
                  </li>
                  <li>
                    <CircleCheck />{" "}
                    {number(studioPackage.includedPhotographers)} photographer(s)
                  </li>
                  {(Array.isArray(studioPackage.includedDeliverables)
                    ? studioPackage.includedDeliverables
                    : []
                  ).map((item) => (
                    <li key={String(item)}>
                      <CircleCheck /> {String(item)}
                    </li>
                  ))}
                </ul>
                {addOns.length ? (
                  <fieldset>
                    <legend>Optional add-ons</legend>
                    {addOns.map((addOn) => {
                      const key = `${studioPackage.id}:${String(addOn.id)}`;
                      return (
                        <label key={key}>
                          <input
                            checked={selectedAddOns.includes(key)}
                            onChange={(event) =>
                              setSelectedAddOns((current) =>
                                event.target.checked
                                  ? [...current, key]
                                  : current.filter((value) => value !== key),
                              )
                            }
                            type="checkbox"
                          />
                          <span>
                            <strong>{String(addOn.name)}</strong>
                            <small>
                              {money(addOn.unitPriceCents, studioPackage.currency)}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}
                <div className="client-package-confirm">
                  <span>
                    <small>Selection before tax</small>
                    <strong>{money(total, studioPackage.currency)}</strong>
                  </span>
                  <button
                    className="button button-dark"
                    disabled={busy}
                    onClick={() => {
                      if (!workspace.tenantId || !workspace.projectId) return;
                      setBusy(true);
                      setNotice("");
                      void selectClientPackage(
                        workspace.tenantId,
                        workspace.projectId,
                        studioPackage.id,
                        selectedForPackage.map((addOn) => ({
                          addOnId: String(addOn.id),
                          quantity: 1,
                        })),
                      )
                        .then(() => window.location.reload())
                        .catch((caught: unknown) =>
                          setNotice(
                            caught instanceof Error
                              ? caught.message.replaceAll("_", " ")
                              : "Your package could not be selected.",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                    type="button"
                  >
                    {busy ? "Confirming…" : "Select this package"}
                  </button>
                </div>
              </article>
            );
          })}
          {!packages.length ? (
            <section className="panel portal-live-state">
              <span>
                <strong>Packages are being prepared</strong>
                <small>Your studio will publish options for this project.</small>
              </span>
            </section>
          ) : null}
        </div>
        {notice ? <p className="client-proposal-notice">{notice}</p> : null}
      </div>
    );
  }
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
  const portalProject = useProject();
  const contracts = useProjectRecords("contracts");
  const [providerOpened, setProviderOpened] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshContracts = contracts.refresh;
  const contract = useMemo(
    () =>
      [...contracts.value].sort((a, b) =>
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
      )[0],
    [contracts.value],
  );
  const contractStatus = text(contract?.status);
  useEffect(() => {
    if (!providerOpened) return;
    const checkOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      setNotice("Checking the signing provider for your latest status…");
      refreshContracts?.();
    };
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => {
      window.removeEventListener("focus", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
    };
  }, [providerOpened, refreshContracts]);
  if (contracts.error || !contract)
    return <PortalPageState eyebrow="Agreement" title="Your contract" description="Review signature progress and open your secure signing request." loading={contracts.loading} error={contracts.error} empty={!contracts.loading && !contracts.error ? "Your agreement will appear after the studio sends it for signature." : undefined} area="contract" milestones={portalProject.value?.milestones ?? null} />;
  /**
   * Who actually witnessed this signature.
   *
   * This was `provider === "dropbox_sign" ? "Dropbox Sign" : "Docusign"`, so
   * a contract the studio recorded by hand — provider null — told the couple
   * their signature status came "from Docusign", a product their studio has
   * not connected. The whole point of recording an attestation separately is
   * that it is never presented as a provider's word.
   */
  const attested = contract.completionAuthority === "manual_attested";
  const signingProvider =
    contract.provider === "dropbox_sign"
      ? "Dropbox Sign"
      : contract.provider === "docusign"
        ? "Docusign"
        : null;
  const signers = Array.isArray(contract.signers)
    ? (contract.signers as Array<Record<string, unknown>>)
    : [];
  const signingUrl =
    typeof contract.signingUrl === "string" ? contract.signingUrl : null;
  const complete = ["completed", "signed"].includes(contractStatus);
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Agreement</p>
      <h1>Photography services agreement</h1>
      <p>
        {attested
          ? "Your studio recorded this signature and holds the signed copy."
          : signingProvider
            ? `Your secure signature status from ${signingProvider}.`
            : "Your signature status for this agreement."}
      </p>
      <section className="panel client-contract-card">
        <ShieldCheck />
        <div>
          <StatusBadge tone={statusTone(contract.status)}>
            {statusLabel(contract.status)}
          </StatusBadge>
          <h2>
            {complete
              ? "Every required signature is complete."
              : signingProvider
                ? `${signingProvider} is collecting required signatures.`
                : "Signatures are still being collected."}
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
              <strong>{statusLabel(signer.status)}</strong>
            </div>
          ))}
          {signingUrl && !complete ? (
            <div className="client-provider-handoff">
              <div>
                <LockKeyhole />
                <span>
                  <strong>You’re opening {signingProvider ?? "the signing page"}</strong>
                  <small>Sign there, then return to this page. StudioCue will check for the provider’s completion evidence.</small>
                </span>
              </div>
              <a
                className="button button-dark"
                href={signingUrl}
                onClick={() => {
                  setProviderOpened(true);
                  setNotice(null);
                }}
                rel="noreferrer"
                target="_blank"
              >
                Continue to secure signing <ExternalLink />
              </a>
            </div>
          ) : (
            !complete && signingProvider ? <p>{signingProvider} sends each signer their secure signing link directly.</p> : null
          )}
          {providerOpened && !complete ? (
            <div className="client-provider-return">
              <span>
                <strong>Back from {signingProvider ?? "signing"}?</strong>
                <small>Check whether the completed signature has synchronized.</small>
              </span>
              <button
                className="button button-light"
                disabled={contracts.loading}
                onClick={() => {
                  setNotice("Checking the signing provider for your latest status…");
                  refreshContracts?.();
                }}
                type="button"
              >
                <RotateCw className={contracts.loading ? "spin" : ""} />
                {contracts.loading ? "Checking…" : "Check signature status"}
              </button>
            </div>
          ) : null}
          {notice ? <p className="client-provider-notice" role="status">{notice}</p> : null}
        </div>
      </section>
      <p className="source-note">
        {attested
          ? "Your studio recorded this signature, and the record names who confirmed it."
          : signingProvider
            ? `Only ${signingProvider} completion evidence can mark this contract complete.`
            : "Only verified completion evidence can mark this contract complete."}
      </p>
      {complete ? (
        <p className="source-note">
          Your studio holds the signed agreement on file. Ask below if you would
          like a copy sent to you.
        </p>
      ) : null}
      <Link className="client-context-message-link" href="/client/messages?context=Contract%20signing">
        <MessageCircle /> Ask your studio about this agreement
      </Link>
    </div>
  );
}

export function LiveClientPayments() {
  const invoices = useProjectRecords("invoiceReferences");
  const [openedInvoiceId, setOpenedInvoiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshInvoices = invoices.refresh;
  useEffect(() => {
    if (!openedInvoiceId) return;
    const checkOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      setNotice("Checking for your latest payment status…");
      refreshInvoices?.();
    };
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => {
      window.removeEventListener("focus", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
    };
  }, [openedInvoiceId, refreshInvoices]);
  if (invoices.error || invoices.value.length === 0)
    return <PortalPageState eyebrow="Payments" title="Your payment schedule" description="Review amounts, due dates, and secure payment links." loading={invoices.loading} error={invoices.error} empty={!invoices.loading && !invoices.error ? "Invoices will appear here when your studio creates them." : undefined} />;
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Payments</p>
      <h1>Your payment schedule</h1>
      <p>Every payment and its status, kept in one place.</p>
      <Link className="client-context-message-link" href="/client/messages?context=Payments">
        <MessageCircle /> Ask your studio a payment question
      </Link>
      {invoices.value
        // A replaced or refused invoice is not the client's to see. One was
        // being listed above the real one, badged "Replaced", saying $569.70
        // still to pay on a deposit that had been paid in full.
        .filter((invoice) => isStandingInvoice(invoice.status))
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
        .map((invoice) => (
          <section className="panel client-payment-card" key={invoice.id}>
            <div>
              {/* "retainer" and "final" are the system's words for these,
                  not a couple's. And an overdue balance has to say so on the
                  client's own page — the studio can see it, so hiding it here
                  only makes the reminder email a surprise. */}
              <span>
                <small>
                  {text(invoice.kind) === "retainer"
                    ? "Deposit"
                    : text(invoice.kind) === "final"
                      ? "Final balance"
                      : text(invoice.kind).replace(/^\w/, (c) => c.toUpperCase())}
                </small>
                <strong>{money(invoice.amountCents, invoice.currency)}</strong>
              </span>
              <StatusBadge
                tone={
                  invoiceOverdue(invoice)
                    ? "danger"
                    : statusTone(invoice.status)
                }
              >
                {invoiceOverdue(invoice)
                  ? "Overdue"
                  : statusLabel(invoice.status)}
              </StatusBadge>
            </div>
            <p>
              {number(invoice.balanceCents) > 0
                ? `${money(invoice.balanceCents, invoice.currency)} still to pay · due ${date(invoice.dueDate)}`
                : `Paid in full · ${date(invoice.dueDate)}`}
            </p>
            {typeof invoice.hostedUrl === "string" && invoice.hostedUrl ? (
              <div className="client-provider-handoff">
                <div>
                  <LockKeyhole />
                  <span>
                    <strong>
                      Secure payment opens in{" "}
                      {text(invoice.provider) === "stripe" ? "Stripe" : "QuickBooks"}
                    </strong>
                    <small>StudioCue never sees your card or bank details. Return here after paying to confirm the updated status.</small>
                  </span>
                </div>
                <a
                  className="button button-dark"
                  href={invoice.hostedUrl}
                  onClick={() => {
                    setOpenedInvoiceId(invoice.id);
                    setNotice(null);
                  }}
                  rel="noreferrer"
                  target="_blank"
                >
                  Continue to secure payment <ExternalLink />
                </a>
                {openedInvoiceId === invoice.id ? (
                  <button
                    className="button button-light"
                    disabled={invoices.loading}
                    onClick={() => {
                      setNotice("Checking for your latest payment status…");
                      refreshInvoices?.();
                    }}
                    type="button"
                  >
                    <RotateCw className={invoices.loading ? "spin" : ""} />
                    {invoices.loading ? "Checking…" : "Check payment status"}
                  </button>
                ) : null}
              </div>
            ) : number(invoice.balanceCents) > 0 ? (
              <div className="client-provider-unavailable">
                <Clock3 />
                <span>
                  <strong>Secure payment link is still syncing</strong>
                  <small>Refresh the status, or message your studio if you need to pay now.</small>
                </span>
                <button className="button button-light" onClick={() => refreshInvoices?.()} type="button">
                  <RotateCw /> Refresh status
                </button>
              </div>
            ) : null}
            {openedInvoiceId === invoice.id && notice ? (
              <p className="client-provider-notice" role="status">{notice}</p>
            ) : null}
            <footer>
              <LockKeyhole /> StudioCue never receives your card or bank details.
            </footer>
          </section>
        ))}
    </div>
  );
}

export function LiveClientQuestionnaire() {
  const portalProject = useProject();
  const workspace = useWorkspace();
  const responses = useProjectRecords("questionnaireResponses");
  const ordered = useMemo(
    () =>
      [...responses.value].sort((left, right) => {
        const leftComplete = left.status === "submitted" ? 1 : 0;
        const rightComplete = right.status === "submitted" ? 1 : 0;
        if (leftComplete !== rightComplete) return leftComplete - rightComplete;
        const due = String(left.dueDate ?? "9999").localeCompare(
          String(right.dueDate ?? "9999"),
        );
        if (due !== 0) return due;
        return String(right.updatedAt ?? "").localeCompare(
          String(left.updatedAt ?? ""),
        );
      }),
    [responses.value],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = ordered.find((response) => response.id === selectedId) ?? ordered[0];
  if (responses.loading || responses.error || !current)
    return <PortalPageState eyebrow="Project planning" title="Your questionnaire" description="Share the details your studio needs to plan your project." loading={responses.loading} error={responses.error} empty={!responses.loading && !responses.error ? "Your studio has not assigned a questionnaire yet." : undefined} area="questionnaire" milestones={portalProject.value?.milestones ?? null} />;
  return (
    <div className="client-booking-page">
      <p className="eyebrow">Project planning</p>
      <h1>Your questionnaire</h1>
      <p>
        Save your progress and return at any time. Your studio will be notified
        when you submit the completed form.
      </p>
      {ordered.length > 1 ? (
        <section className="client-questionnaire-picker" aria-label="Assigned questionnaires">
          {ordered.map((response, index) => (
            <button
              className={response.id === current.id ? "is-active" : ""}
              key={response.id}
              onClick={() => setSelectedId(response.id)}
              type="button"
            >
              <span>
                <strong>{text(response.name ?? response.templateName, `Questionnaire ${index + 1}`)}</strong>
                <small>
                  {response.status === "submitted"
                    ? "Submitted"
                    : response.dueDate
                      ? `Due ${date(response.dueDate)}`
                      : "Ready to complete"}
                </small>
              </span>
              <StatusBadge tone={response.status === "submitted" ? "success" : "warning"}>
                {statusLabel(response.status) || "in progress"}
              </StatusBadge>
            </button>
          ))}
        </section>
      ) : null}
      {/* A bare `.panel` supplies no inset, so the form sat against the border.
          Named so the panel-inset block in legacy-bridge.css can reach it. */}
      <section className="panel client-questionnaire-panel">
        <ClientQuestionnaireForm
          key={current.id}
          tenantId={workspace.tenantId ?? undefined}
          projectId={text(current.projectId)}
          responseId={current.id}
          status={text(current.status, "in_progress")}
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
  const portalProject = useProject();
  const schedules = useProjectRecords("schedules");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"idle" | "changes">("idle");
  const [changeNote, setChangeNote] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const orderedSchedules = useMemo(
    () => [...schedules.value].sort((a, b) => number(b.version) - number(a.version)),
    [schedules.value],
  );
  const schedule = orderedSchedules[0];
  if (schedules.loading || schedules.error || !schedule)
    return <PortalPageState eyebrow="Event day" title="Your schedule" description="Review the current run of show and respond when your studio requests approval." loading={schedules.loading} error={schedules.error} empty={!schedules.loading && !schedules.error ? "The published run of show will appear here when it is ready for you." : undefined} area="schedule" milestones={portalProject.value?.milestones ?? null} />;
  const items = Array.isArray(schedule.items)
    ? (schedule.items as Array<Record<string, unknown>>)
    : [];
  const status = localStatus ?? text(schedule.status);
  /**
   * Whether the couple can still decide anything about this run of show.
   *
   * A schedule left in `client_review` keeps asking "Is this schedule ready?
   * Approve this exact version or explain what your studio should revise" — and
   * that question was still being put to a couple thirteen days after their
   * wedding. There is nothing to revise about a day that has happened.
   */
  const eventBehindThem = portalStageIsBehind(
    portalProject.value?.milestones ?? null,
    "schedule",
  );
  const actionable = status === "client_review" && !eventBehindThem;
  async function decide(decision: "approved" | "changes_requested") {
    if (busy || (decision === "changes_requested" && changeNote.trim().length < 10)) return;
    setBusy(true);
    setNotice(null);
    try {
      const selectedItem = items.find((item) => text(item.id) === selectedItemId);
      const itemContext = selectedItem
        ? `Schedule item: ${text(selectedItem.title)} (${new Date(String(selectedItem.startAt)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}). `
        : "";
      await sendPlanningCommand("approveSchedule", {
        projectId: schedule.projectId,
        scheduleId: schedule.id,
        decision,
        notes:
          decision === "approved"
            ? "Approved by client in the StudioCue portal."
            : `${itemContext}${changeNote.trim()}`,
      });
      setLocalStatus(decision);
      setMode("idle");
      setNotice(
        decision === "approved"
          ? "Schedule approved."
          : "Change request sent to the studio.",
      );
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Schedule response failed."),
      );
    } finally {
      setBusy(false);
    }
  }
  const clientVisibleItems = displayableScheduleItems(
    items.filter((item) =>
      ["client", "shared"].includes(text(item.visibility, "shared")),
    ),
  );
  return (
    <div className="client-booking-page">
      <p className="eyebrow">
        Version {number(schedule.version)} · {status.replaceAll("_", " ")}
      </p>
      <h1>Your event-day schedule</h1>
      <p>
        {eventBehindThem
          ? `Times are shown in ${text(schedule.timezone)}. This is the running order your day was built on, kept for your records.`
          : `Times are shown in ${text(schedule.timezone)}. Keep this page available on your phone for the current event brief.`}
      </p>
      {orderedSchedules.length > 1 ? (
        <p className="client-schedule-history">
          <Clock3 /> Version {number(schedule.version)} is current · {orderedSchedules.length - 1} earlier {orderedSchedules.length === 2 ? "version" : "versions"} preserved
        </p>
      ) : null}
      {/* Items with no usable start time are left out rather than rendered as
          "Invalid Date". A schedule can be marked approved and still hold items
          the reader cannot understand, and a couple should be told that plainly
          instead of being handed six broken clocks the night before. */}
      {clientVisibleItems.length ? (
        <section className="mobile-schedule">
          {clientVisibleItems.map((item) => {
            const clock = scheduleItemClock(item, text(schedule.timezone, "") || undefined);
            return (
              <article key={text(item.id)}>
                <span>
                  <strong>{clock?.start}</strong>
                  {clock?.end ? <small>{clock.end}</small> : null}
                </span>
                <div>
                  <h2>{text(item.title, "Detail to be confirmed")}</h2>
                  <p>
                    <MapPin /> {text(item.location, "Location pending")}
                  </p>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="panel client-schedule-empty">
          <h2>No times are set on this schedule yet</h2>
          <p>
            Your studio is still putting the running order together. It will
            appear here as soon as the times are set.
          </p>
        </section>
      )}
      {actionable ? (
        <section className="panel client-schedule-decision">
          <div>
            <p className="eyebrow">Your decision</p>
            <h2>Is this schedule ready?</h2>
            <p>Approve this exact version or explain what your studio should revise.</p>
          </div>
          {mode === "changes" ? (
            <div className="client-schedule-change">
              <label htmlFor="schedule-item-reference">Schedule item (optional)</label>
              <select
                id="schedule-item-reference"
                onChange={(event) => setSelectedItemId(event.target.value)}
                value={selectedItemId}
              >
                <option value="">The schedule overall</option>
                {items.map((item) => (
                  <option key={text(item.id)} value={text(item.id)}>
                    {new Date(String(item.startAt)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — {text(item.title)}
                  </option>
                ))}
              </select>
              <label htmlFor="schedule-change-note">What should change?</label>
              <textarea
                id="schedule-change-note"
                maxLength={2000}
                onChange={(event) => setChangeNote(event.target.value)}
                placeholder="Describe the correct time, location, order, or detail."
                rows={4}
                value={changeNote}
              />
              <div className="schedule-client-actions">
                <button
                  className="button button-dark"
                  disabled={busy || changeNote.trim().length < 10}
                  onClick={() => void decide("changes_requested")}
                  type="button"
                >
                  {busy ? "Sending…" : "Send change request"}
                </button>
                <button
                  className="button button-light"
                  disabled={busy}
                  onClick={() => setMode("idle")}
                  type="button"
                >
                  Go back
                </button>
              </div>
            </div>
          ) : (
            <div className="schedule-client-actions">
              <button
                className="button button-dark"
                disabled={busy}
                onClick={() => void decide("approved")}
                type="button"
              >
                {busy ? "Saving…" : "Approve this version"}
              </button>
              <button
                className="button button-light"
                disabled={busy}
                onClick={() => setMode("changes")}
                type="button"
              >
                Request changes
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="client-schedule-result">
          <CheckCircle2 />
          <span>
            <strong>
              {status === "approved" ? "You approved this schedule." : "This is the current shared schedule."}
            </strong>
            <small>Your studio will notify you if a newer version needs review.</small>
          </span>
        </section>
      )}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      <Link className="client-context-message-link" href="/client/messages?context=Event%20schedule">
        <MessageCircle /> Ask your studio about the schedule
      </Link>
    </div>
  );
}

export function LiveClientDelivery() {
  const portalProject = useProject();
  const workspace = useWorkspace();
  const deliveries = useProjectRecords("deliveryRecords");
  const albums = useProjectRecords("albumWorkflows");
  const [copied, setCopied] = useState(false);
  const [revisionMode, setRevisionMode] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [albumBusy, setAlbumBusy] = useState(false);
  const [albumNotice, setAlbumNotice] = useState<string | null>(null);
  const [localAlbumStatus, setLocalAlbumStatus] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());
  const delivery = deliveries.value[0];
  const album = albums.value[0];
  if (deliveries.loading || deliveries.error || !delivery)
    return <PortalPageState eyebrow="Your photographs" title="Delivery" description="Open your gallery and confirm when your download is complete." loading={deliveries.loading} error={deliveries.error} empty={!deliveries.loading && !deliveries.error ? "Your secure gallery details will appear after delivery." : undefined} area="delivery" milestones={portalProject.value?.milestones ?? null} />;
  const expirationAt = new Date(String(delivery.expirationDate)).valueOf();
  const daysUntilExpiration = Number.isNaN(expirationAt)
    ? null
    : Math.ceil((expirationAt - renderedAt) / 86400000);
  const galleryExpired = daysUntilExpiration !== null && daysUntilExpiration < 0;
  const albumStatus = localAlbumStatus ?? text(album?.status);
  async function requestAlbumRevision() {
    if (!album || revisionNote.trim().length < 10 || albumBusy) return;
    setAlbumBusy(true);
    setAlbumNotice(null);
    try {
      const response = await sendPostEventCommand("updateAlbumStatus", {
        projectId: album.projectId,
        albumWorkflowId: album.id,
        status: "revision_requested",
        evidenceUrl: null,
        evidenceId: null,
        notes: revisionNote.trim(),
      });
      if (response.persisted) setLocalAlbumStatus("revision_requested");
      setRevisionMode(false);
      setAlbumNotice(
        response.persisted
          ? "Your revision notes were sent to the studio."
          : "Development preview: your revision request was validated but not saved.",
      );
    } catch (caught: unknown) {
      setAlbumNotice(friendlyError(caught, "Your revision request could not be sent."));
    } finally {
      setAlbumBusy(false);
    }
  }
  return (
    <div className="client-post-event">
      <header>
        <p className="eyebrow">Your photographs</p>
        <h1>Your gallery is ready.</h1>
        <p>Keep your access details private and download before expiration.</p>
        <Link className="client-context-message-link" href="/client/messages?context=Gallery%20and%20delivery">
          <MessageCircle /> Ask your studio about delivery
        </Link>
      </header>
      <section className="client-gallery-card">
        <div className="gallery-art">
          <Images />
          <span>{workspace.tenantName}</span>
        </div>
        <div className="gallery-copy">
          <StatusBadge tone={statusTone(delivery.status)}>
            {statusLabel(delivery.status)}
          </StatusBadge>
          <h2>{workspace.projectName}</h2>
          <dl>
            <div>
              <dt>
                <LockKeyhole /> Access code
              </dt>
              <dd>
                {text(delivery.accessCode, "Not required")}
                {delivery.accessCode ? (
                  <button
                    className="client-copy-access"
                    onClick={() => {
                      void navigator.clipboard.writeText(text(delivery.accessCode));
                      setCopied(true);
                    }}
                    type="button"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>
                <CalendarDays /> Available until
              </dt>
              <dd>{date(delivery.expirationDate)}</dd>
            </div>
          </dl>
          {daysUntilExpiration !== null && daysUntilExpiration <= 14 ? (
            <div className={galleryExpired ? "client-gallery-expiry is-expired" : "client-gallery-expiry"}>
              <Clock3 />
              <span>
                <strong>{galleryExpired ? "Gallery access has expired" : `${daysUntilExpiration} days left to download`}</strong>
                <small>{galleryExpired ? "Ask your studio to restore access." : "Download and back up your photographs before access closes."}</small>
              </span>
            </div>
          ) : null}
          {typeof delivery.galleryUrl === "string" && delivery.galleryUrl && !galleryExpired ? (
            <a className="button button-dark" href={delivery.galleryUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Open secure gallery
            </a>
          ) : (
            <Link className="button button-light" href="/client/messages?context=Gallery%20access">
              <MessageCircle /> Request gallery access
            </Link>
          )}
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
      {album ? (
        <section className="client-album-workflow">
          <header>
            <span>
              <p className="eyebrow">Album</p>
              <h2>Your album, in one clear timeline</h2>
              <p>
                StudioCue coordinates milestones and reminders. Your
                photographer remains the creative authority for the design.
              </p>
            </span>
            <BookOpenCheck aria-hidden="true" />
          </header>
          <div className="album-status-track">
            {[
              "instructions_available",
              "selections_received",
              "design_sent",
              "approved",
              "fulfilled",
            ].map((status, index, statuses) => {
              const currentIndex = statuses.indexOf(albumStatus);
              const revision = albumStatus === "revision_requested";
              return (
                <span
                  className={
                    index <= currentIndex && !revision ? "is-complete" : ""
                  }
                  key={status}
                >
                  <i />
                  <small>{status.replaceAll("_", " ")}</small>
                </span>
              );
            })}
          </div>
          {typeof album.instructionsUrl === "string" &&
          album.instructionsUrl ? (
            <a
              className="button button-light"
              href={album.instructionsUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink /> Watch selection instructions
            </a>
          ) : null}
          {albumStatus === "instructions_available" ? (
            <PostEventAction
              completedLabel="Instructions viewed"
              input={{
                projectId: album.projectId,
                albumWorkflowId: album.id,
                status: "instructions_viewed",
                evidenceUrl: null,
                evidenceId: null,
                notes: "Client confirmed viewing instructions in the portal.",
              }}
              label="I’ve viewed the instructions"
              type="updateAlbumStatus"
            />
          ) : null}
          {["instructions_viewed", "selections_pending"].includes(
            albumStatus,
          ) ? (
            <PostEventAction
              completedLabel="Selections recorded"
              input={{
                projectId: album.projectId,
                albumWorkflowId: album.id,
                status: "selections_received",
                evidenceUrl: null,
                evidenceId: null,
                notes: "Client confirmed album selections were submitted.",
              }}
              label="I submitted my selections"
              type="updateAlbumStatus"
            />
          ) : null}
          {albumStatus === "design_sent" ? (
            <div className="album-decision-actions">
              {typeof album.designProofUrl === "string" &&
              album.designProofUrl ? (
                <a
                  className="button button-light"
                  href={album.designProofUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink /> Open design proof
                </a>
              ) : null}
              <PostEventAction
                completedLabel="Album approved"
                input={{
                  projectId: album.projectId,
                  albumWorkflowId: album.id,
                  status: "approved",
                  evidenceUrl: null,
                  evidenceId: null,
                  notes: "Client approved the album design in the portal.",
                }}
                label="Approve this design"
                type="updateAlbumStatus"
              />
              <button className="button button-light" onClick={() => setRevisionMode(true)} type="button">
                Request a revision
              </button>
            </div>
          ) : null}
          {revisionMode ? (
            <div className="client-album-revision">
              <label htmlFor="album-revision-notes">What should your photographer change?</label>
              <textarea
                id="album-revision-notes"
                maxLength={2000}
                onChange={(event) => setRevisionNote(event.target.value)}
                placeholder="Reference the spread, photograph, crop, layout, or wording and describe the change clearly."
                rows={4}
                value={revisionNote}
              />
              <div>
                <button className="button button-dark" disabled={albumBusy || revisionNote.trim().length < 10} onClick={() => void requestAlbumRevision()} type="button">
                  {albumBusy ? "Sending…" : "Send revision notes"}
                </button>
                <button className="button button-light" disabled={albumBusy} onClick={() => setRevisionMode(false)} type="button">Cancel</button>
              </div>
            </div>
          ) : null}
          {["selections_received", "revision_requested", "approved"].includes(
            albumStatus,
          ) ? (
            <div className="album-studio-working">
              <ShieldCheck />
              <span>
                <strong>Your studio is working on the next milestone.</strong>
                <small>
                  No action is needed until a new proof or fulfillment update
                  appears.
                </small>
              </span>
            </div>
          ) : null}
          {albumStatus === "fulfilled" ? (
            <StatusBadge tone="success">Album fulfilled</StatusBadge>
          ) : null}
          {albumNotice ? <p className="form-notice" role="status">{albumNotice}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

export function LiveClientReviews() {
  const portalProject = useProject();
  const workspace = useWorkspace();
  const reviews = useProjectRecords("reviewRequests");
  const review = reviews.value.find((item) => item.status !== "skipped");
  if (reviews.loading || reviews.error || !review)
    return <PortalPageState eyebrow="After delivery" title="Reviews" description="Your studio may invite you to share feedback after delivery." loading={reviews.loading} error={reviews.error} empty={!reviews.loading && !reviews.error ? "A review request may appear after your gallery is delivered." : undefined} area="reviews" milestones={portalProject.value?.milestones ?? null} />;
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
        <a
          className="button button-dark"
          href={text(review.destinationUrl)}
          onClick={() => {
            void sendPostEventCommand("markReviewOpened", {
              projectId: review.projectId,
              reviewRequestId: review.id,
            });
          }}
          target="_blank"
          rel="noreferrer"
        >
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
