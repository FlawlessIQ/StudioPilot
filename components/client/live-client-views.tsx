"use client";

import {
  coverageRoleLabel,
  resolveCoverage,
} from "@/features/packages/coverage";
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
} from "lucide-react";
import { PostEventAction } from "@/components/post-event/post-event-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  portalPastNotice,
  portalStageIsBehind,
  type PortalArea,
} from "@/features/client/portal-stage";
import type { ClientMilestone } from "@/server/client/portal-experience";
import { todayLocalIso } from "@/lib/format/event-date";
import {
  eventHasPassed,
  portalEmptyNotice,
  type PortalEmptyArea,
} from "@/features/client/portal-day";
import {
  displayableScheduleItems,
  scheduleItemClock,
} from "@/features/schedules/item-clock";
import {
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
import { bookingSteps, type BookingStepsView } from "@/features/client/booking-steps";
import { statusLabel } from "@/features/format/status-label";
import { friendlyError } from "@/lib/ai/friendly-error";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { MOCK_CLIENT_PROJECT } from "@/features/client/mock-project";

type RecordValue = Record<string, unknown> & { id: string };
export type Loadable<T> = {
  value: T;
  loading: boolean;
  error: string | null;
  refresh?: () => void;
};

export function mockClientRecords(
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
    // The portal's record list leaves the template out; mock mode carries it
    // so the one-section-per-screen form can be walked. `studioNotes` is
    // internal-only: the couple never sees it, and a save must keep it.
    questionnaireResponses: [{
      id: "demo-questionnaire",
      projectId: "demo-project",
      name: "Wedding day planning",
      status: "in_progress",
      dueDate: "2027-05-01",
      updatedAt: "2026-08-15T12:00:00.000Z",
      answers: { ceremonyTime: "16:30", studioNotes: "Bring the 85mm for the vows." },
      templateSnapshot: {
        sections: [
          {
            id: "day",
            title: "The day",
            fields: [
              { id: "ceremonyTime", label: "Ceremony start time", type: "time", required: true },
              { id: "ceremonyStyle", label: "Ceremony style", type: "radio", required: true, options: ["Religious", "Civil", "Symbolic"] },
              { id: "firstLook", label: "Are you planning a first look?", type: "radio", required: false, options: ["Yes", "No", "Not sure yet"] },
            ],
          },
          {
            id: "family",
            title: "Family photos",
            fields: [
              { id: "familyPhotoList", label: "Family photo list", type: "long_text", required: true },
              { id: "familyHelper", label: "Is someone helping gather family?", type: "radio", required: false, options: ["Yes", "No"] },
              { id: "familyHelperName", label: "Their name and phone", type: "text", required: false, conditionalOn: { fieldId: "familyHelper", equals: "Yes" } },
            ],
          },
          {
            id: "people",
            title: "Your people",
            fields: [
              { id: "plannerName", label: "Planner or coordinator", type: "text", required: false },
              { id: "plannerPhone", label: "Their phone", type: "phone", required: false },
              { id: "studioNotes", label: "Studio notes", type: "long_text", required: false, internalOnly: true },
            ],
          },
          {
            id: "else",
            title: "Anything else",
            fields: [
              { id: "doNotPhotograph", label: "Anyone or anything we shouldn’t photograph?", type: "long_text", required: false },
              { id: "venueRules", label: "We’ll share any venue photography rules", type: "acknowledgement", required: true },
            ],
          },
        ],
      },
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
export function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function invoiceOverdue(invoice: Record<string, unknown>): boolean {
  if (number(invoice.balanceCents) <= 0) return false;
  const due = text(invoice.dueDate).slice(0, 10);
  return Boolean(due) && due < todayLocalIso();
}

export function useProject(): Loadable<ClientPortalProject | null> {
  const workspace = useWorkspace();
  // Mock mode has a project, so the couple's screens can be walked and tested
  // (Home only ever showed its empty state before).
  const [state, setState] = useState<Loadable<ClientPortalProject | null>>({
    value: dataIsLive ? null : MOCK_CLIENT_PROJECT,
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

export function useProjectRecords(
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

export function PortalState({
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

export function PortalPageState({
  eyebrow,
  title,
  description,
  loading,
  error,
  empty,
  area,
  milestones,
  emptyArea,
  eventDate = null,
  lead = null,
}: {
  /** Shown above the page title — the booking stepper, while booking. */
  lead?: React.ReactNode;
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
  /**
   * For the four pages that shared one block of filler: which page this is,
   * so the empty state can say something true and specific, and know whether
   * the day has been and gone. See features/client/portal-day.ts.
   */
  emptyArea?: PortalEmptyArea;
  eventDate?: string | null;
}) {
  const behind = area ? portalStageIsBehind(milestones, area) : false;
  const past = behind && area ? portalPastNotice(area) : null;
  const dayNotice =
    !past && emptyArea
      ? portalEmptyNotice(emptyArea, eventHasPassed(eventDate, todayLocalIso()))
      : null;
  const notice = past ?? dayNotice;
  return (
    <div className="client-booking-page">
      {lead}
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
      {/* The "What happens next" aside that used to follow every empty state —
          "Your studio prepares this area · You'll be notified when it changes
          · Only approved project details appear here" — is gone. It said the
          same three things on four pages and none of them answered a question
          the couple had. The page's own notice now carries the reason. */}
      <PortalState
        emptyTitle={notice?.title}
        empty={empty ? (notice ? notice.detail : empty) : undefined}
        error={error}
        loading={loading}
      />
    </div>
  );
}

export const text = (value: unknown, fallback = "Pending") =>
  typeof value === "string" && value ? value : fallback;
export const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
export const money = (cents: unknown, currency: unknown = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: text(currency, "USD"),
  }).format(number(cents) / 100);
export const date = (value: unknown) => {
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
export const statusTone = (status: unknown) =>
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

/**
 * Where the couple is in reserving their date, or null outside booking.
 *
 * Null before any proposal is shared and once the date is booked: the
 * stepper is for the three steps in between, not a permanent fixture. While a
 * step is with the studio or a provider (agreement on its way, invoice
 * syncing), it checks again every 20 seconds so the next step appears without
 * the couple reloading.
 */
export function useReserveYourDate(): BookingStepsView | null {
  const proposals = useProjectRecords("proposals");
  const contracts = useProjectRecords("contracts");
  const invoices = useProjectRecords("invoiceReferences");
  const proposal = [...proposals.value].sort(
    (a, b) => number(b.version) - number(a.version),
  )[0];
  const contract = [...contracts.value]
    .filter((entry) => !["superseded", "failed"].includes(text(entry.status)))
    .sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)))[0];
  const retainer = invoices.value.find(
    (invoice) => text(invoice.kind) === "retainer" && isStandingInvoice(invoice.status),
  );
  const view =
    proposal && !proposals.loading
      ? bookingSteps({
          proposalStatus: text(proposal.status) || null,
          contractStatus: contract ? text(contract.status) || null : null,
          retainer: retainer
            ? {
                status: text(retainer.status),
                balanceCents: number(retainer.balanceCents),
                hostedUrl:
                  typeof retainer.hostedUrl === "string" ? retainer.hostedUrl : null,
              }
            : null,
        })
      : null;
  const waiting = Boolean(
    view && !view.booked && view.next.href === null && proposal?.status === "accepted",
  );
  const refreshContracts = contracts.refresh;
  const refreshInvoices = invoices.refresh;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      refreshContracts?.();
      refreshInvoices?.();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [waiting, refreshContracts, refreshInvoices]);
  if (!view || view.booked) return null;
  return view;
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
            // Stage-based before: at PLANNING nineteen days after the wedding
            // it still promised confirmation of who had already shot it.
            portalStageIsBehind(value.milestones, "schedule") ||
              eventHasPassed(value.eventDate, todayLocalIso())
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
  const portalProject = useProject();
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
        emptyArea="documents"
        eventDate={portalProject.value?.eventDate ?? null}
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
                  {/* The stored status is written from the studio's side — a
                      client's message lands as `received`, meaning the studio
                      has it. Rendered verbatim that read "You · … · Received"
                      on the couple's own message, which is backwards from
                      where they are sitting. Their own message says what the
                      confirmation said: sent. */}
                  <small>{fromStudio ? workspace.tenantName : "You"} · {date(message.sentAt ?? message.createdAt)} · {fromStudio ? statusLabel(message.status) || "sent" : "Sent"}</small>
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

export function proposalErrorMessage(error: string) {
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
                    {number(studioPackage.includedCoverageMinutes) / 60}{" "} hours
                  </li>
                  {resolveCoverage(studioPackage).map((item) => (
                    <li key={item.role}>
                      <CircleCheck /> {item.count}{" "}
                      {coverageRoleLabel(item.role, item.count)}
                    </li>
                  ))}
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
            {number(value.includedCoverageMinutes) / 60}{" "} coverage hours
          </li>
          {resolveCoverage(value).map((item) => (
            <li key={item.role}>
              <CircleCheck /> {item.count}{" "}
              {coverageRoleLabel(item.role, item.count)}
            </li>
          ))}
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
          <Clock3 /> Version {number(schedule.version)} is current · {orderedSchedules.length - 1} earlier {orderedSchedules.length === 2 ? "version" : "versions"}{" "} preserved
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
    return <PortalPageState eyebrow="Your photographs" title="Delivery" description="Open your gallery and confirm when your download is complete." loading={deliveries.loading} error={deliveries.error} empty={!deliveries.loading && !deliveries.error ? "Your secure gallery details will appear after delivery." : undefined} area="delivery" milestones={portalProject.value?.milestones ?? null} emptyArea="delivery" eventDate={portalProject.value?.eventDate ?? null} />;
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
    return <PortalPageState eyebrow="After delivery" title="Reviews" description="Your studio may invite you to share feedback after delivery." loading={reviews.loading} error={reviews.error} empty={!reviews.loading && !reviews.error ? "A review request may appear after your gallery is delivered." : undefined} area="reviews" milestones={portalProject.value?.milestones ?? null} emptyArea="reviews" eventDate={portalProject.value?.eventDate ?? null} />;
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
