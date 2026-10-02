"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { todayLocalIso } from "@/lib/format/event-date";
import {
  getClientPortalProject,
  getClientPortalRecords,
  type ClientPortalCollection,
  type ClientPortalProject,
} from "@/lib/client/portal-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { bookingSteps, type BookingStepsView } from "@/features/client/booking-steps";
import { friendlyError } from "@/lib/ai/friendly-error";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { MOCK_CLIENT_PROJECT } from "@/features/client/mock-project";
import { bookingGateNeeds, journeyProfile, jobKindOf, isPaymentShape } from "@/features/job-kinds/job-kinds";

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
      // One crew-only item and one with no start: neither is the couple's to see.
      items: [
        { id: "arrival", startAt: "2027-06-12T13:00:00-04:00", endAt: "2027-06-12T13:30:00-04:00", title: "Photographer arrives", location: "Bridal suite, The Garden Conservatory", visibility: "shared" },
        { id: "details", startAt: "2027-06-12T13:30:00-04:00", endAt: "2027-06-12T14:30:00-04:00", title: "Getting ready and details", location: "Bridal suite", visibility: "client" },
        { id: "first-look", startAt: "2027-06-12T15:00:00-04:00", endAt: "2027-06-12T15:30:00-04:00", title: "First look", location: "Rose garden", visibility: "client" },
        { id: "crew-meal", startAt: "2027-06-12T16:00:00-04:00", endAt: "2027-06-12T16:20:00-04:00", title: "Crew meal break", location: "Staff room", visibility: "crew" },
        { id: "ceremony", startAt: "2027-06-12T17:00:00-04:00", endAt: "2027-06-12T17:30:00-04:00", title: "Ceremony", location: "Garden ceremony space", visibility: "client" },
        { id: "family", startAt: "2027-06-12T17:35:00-04:00", endAt: "2027-06-12T18:05:00-04:00", title: "Family formals", location: "Conservatory steps", visibility: "client" },
        { id: "entrance", startAt: "2027-06-12T19:00:00-04:00", title: "Grand entrance", location: "Glass hall", visibility: "shared" },
        { id: "tbc", title: "Sparkler exit", visibility: "client" },
      ],
    }],
    messages: [
      {
        id: "demo-studio-welcome",
        subject: "Welcome aboard",
        body: "So happy to be photographing your day! Your planning questionnaire is ready whenever you are.",
        direction: "outbound",
        visibility: "shared",
        status: "delivered",
        createdAt: "2026-08-12T14:00:00.000Z",
        clientReadAt: "2026-08-12T15:00:00.000Z",
      },
      {
        id: "demo-client-question",
        subject: "Re: Welcome aboard",
        body: "Thank you! Quick one: can my sister come to the engagement shoot?",
        direction: "inbound",
        visibility: "shared",
        status: "received",
        createdAt: "2026-08-12T16:20:00.000Z",
      },
      {
        id: "demo-studio-message",
        subject: "Your planning timeline",
        body: "Of course she can. We also prepared the first timeline for your review. Tap Plan, then Timeline.",
        bodyPreview: "We prepared the first schedule for your review.",
        context: "Event schedule",
        direction: "outbound",
        visibility: "shared",
        status: "delivered",
        createdAt: "2026-08-14T15:00:00.000Z",
        clientReadAt: null,
        attachmentReferences: [{ name: "Timeline notes.pdf" }],
      },
    ],
    documents: [{
      id: "demo-shared-photo",
      name: "Venue walkthrough.jpg",
      category: "reference",
      contentType: "image/jpeg",
      status: "available",
      downloadUrl: "/og.png",
      updatedAt: "2027-05-20T12:00:00.000Z",
    }, {
      id: "demo-shared-file",
      name: "Venue certificate of insurance",
      category: "coi",
      status: "available",
      downloadUrl: "https://example.com/shared-document.pdf",
      updatedAt: "2027-06-01T12:00:00.000Z",
    }],
    // A photo gallery and a Vimeo film, as a studio pastes them today (no
    // mediaType yet: the link's host decides), and a sneak peek as H4 will
    // record it.
    deliveryRecords: [{
      id: "demo-delivery",
      projectId: "demo-project",
      provider: "pixieset",
      galleryUrl: "https://example.pixieset.com/riverawedding",
      accessCode: "RIVERA27",
      expirationDate: "2027-08-01",
      deliveryDate: "2027-07-01",
      status: "delivered",
    }, {
      id: "demo-film",
      projectId: "demo-project",
      provider: "manual",
      galleryUrl: "https://vimeo.com/123456789",
      accessCode: "garden-june",
      deliveryDate: "2027-08-10",
      status: "delivered",
      kind: "highlight_film",
    }, {
      id: "demo-sneak-peek",
      projectId: "demo-project",
      mediaType: "photo",
      kind: "sneak_peek",
      galleryUrl: "https://example.pixieset.com/riverasneakpeek",
      deliveryDate: "2027-06-15",
      status: "delivered",
    }],
    albumWorkflows: [{
      id: "demo-album",
      projectId: "demo-project",
      status: "design_sent",
      instructionsUrl: "https://example.com/album-instructions",
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
    // Never the demo records in live mode: they were the starting value while
    // loading, and the kit screens show what they hold, so a real couple saw
    // "Highlight film · RIVERA27" flash before their own delivery (found by
    // the local UAT run, 2026-09-29).
    value: dataIsLive ? [] : mockClientRecords(collectionName),
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

/**
 * What this client's job needs to book: an agreement, a payment, and whether
 * that payment is the whole price (features/job-kinds). Both, as for a
 * wedding, until the project has loaded.
 */
export function useBookingNeeds(): { agreement: boolean; payment: boolean; paidInFull: boolean } {
  const project = useProject().value;
  if (!project) return { agreement: true, payment: true, paidInFull: false };
  const profile = journeyProfile(jobKindOf(project), {
    payment: isPaymentShape(project.paymentShape) ? project.paymentShape : undefined,
  });
  return { ...bookingGateNeeds(profile), paidInFull: profile.payment === "paid_in_full" };
}

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
  const needs = useBookingNeeds();
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
                atProvider: retainer.atProvider === true,
              }
            : null,
          needs,
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

/**
 * A proposal refusal in the couple's words. Any code without its own line
 * gets a humane one rather than the code itself — couples were being shown
 * strings like PROJECT_STATE_CONFLICT.
 */
export const PROPOSAL_ERROR_FALLBACK =
  "This couldn't be saved just now. Please message your studio and they'll sort it out.";

export function proposalErrorMessage(error: string) {
  const messages: Record<string, string> = {
    PROJECT_ON_HOLD:
      "Your booking is on hold with your studio right now, so this proposal can't be accepted. Message your studio to pick it back up.",
    PROJECT_NOT_ACTIVE:
      "This booking is no longer active, so this proposal can't be accepted. Message your studio if you'd like to talk about it.",
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
  if (messages[error]) return messages[error];
  // A code-shaped string is plumbing; a sentence is already for a person.
  return /^[A-Z0-9_:]+$/.test(error) ? PROPOSAL_ERROR_FALLBACK : error;
}
