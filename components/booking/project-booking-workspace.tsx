"use client";

import { bookingBlockerLabel } from "@/features/booking/blocker-label";
import { bookingGateNeeds, projectProfile, bookedOnceClause } from "@/features/job-kinds/job-kinds";
import { SignedCopySharing } from "@/components/contracts/signed-copy-sharing";
import { useCallback, useEffect, useMemo, useState } from "react";
import { offeredSigningProvider } from "@/features/integrations/schema";
import { CapabilityNote } from "@/components/integrations/capability-note";
import { InfoHint } from "@/components/ui/info-hint";
import { AttachSignedCopy } from "@/components/booking/attach-signed-copy";
import { RecordSignedAgreement } from "@/components/booking/record-signed-agreement";
import { NativeContractStep } from "@/components/contracts/native-contract-step";
import { useNativeSigning } from "@/components/contracts/use-native-signing";
import { BookWithoutRetainer } from "@/components/booking/book-without-retainer";
import { RecordRetainerPayment } from "@/components/booking/record-retainer-payment";
import { RecordProposalAcceptance } from "@/components/booking/record-proposal-acceptance";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clock3,
  FlaskConical,
  CircleAlert,
  FileSignature,
  LoaderCircle,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { resolveActiveProvider } from "@/features/integrations/routing";
import { providerFailureHint } from "@/features/booking/provider-failure-hint";
import {
  bookingAutomationAwaitsProvider,
  bookingAutomationDrivesContract,
} from "@/features/booking/orchestration";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { paidInFullFromSchedule, retainerFromSchedule } from "@/features/booking/agreed-retainer";
import { CorrectPayment, RecordInvoicePayment, VoidInvoice } from "@/components/booking/invoice-corrections";
import { ProviderInvoiceLines } from "@/components/booking/provider-invoice-lines";
import { HeldInvoiceReview } from "@/components/booking/held-invoice-review";
import { invoicePaymentRefusal } from "@/features/booking/invoice-payments";
import {
  QUICKBOOKS_NO_PAY_LINK_NOTE,
  quickBooksInvoiceWithoutPayLink,
} from "@/features/client/invoice-pay-route";
import {
  friendlyError as friendlySharedError,
  isVersionConflict,
} from "@/lib/ai/friendly-error";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import {
  addCalendarDays,
  formatDueDate,
  formatEventDate,
  todayLocalIso,
} from "@/lib/format/event-date";
import { providerName } from "@/lib/format/provider-name";
import {
  PanelError,
  PanelLoading,
  useWorkspaceGate,
} from "@/components/ui/panel-state";
import { statusLabel } from "@/features/format/status-label";
import { canCreateProposalForProject } from "@/features/proposals/eligibility";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { CombinedAgreementSend } from "@/components/contracts/combined-agreement-send";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { JobSalesTax } from "@/components/booking/job-sales-tax";
import { JobBillingChoice } from "@/components/booking/job-billing-choice";
import { useJobBilling } from "@/components/booking/use-job-billing";
import { StudioDepositPanel } from "@/components/booking/studio-invoice-actions";
import { BillingAddressSummary } from "@/components/clients/billing-address-summary";

type RecordValue = Record<string, unknown> & { id: string };

function nestedString(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : "";
}

/**
 * The shared copy, with this page's fallback. A local map used to sit here,
 * looked up by the already-translated sentence — so it never matched, and its
 * copy (some of it wrong) was dead. The codes live in lib/ai/friendly-error.ts.
 */
function friendlyError(error: unknown): string {
  return friendlySharedError(error, "This action could not be completed.");
}

function currency(cents: unknown, code: unknown): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: typeof code === "string" ? code : "USD",
  }).format(Number(cents ?? 0) / 100);
}

export function ProjectBookingWorkspace({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const gate = useWorkspaceGate();
  // A makeup artist or hair stylist sends a quote, not a proposal (trades.ts).
  const offer = tradeVocab(workspace.tenantTrade).proposal.toLowerCase();
  // The payment that books the date: a photographer's retainer, a vendor's
  // deposit (trades.ts `deposit`; vendor wording sweep, 2026-10-10).
  const depositWord = tradeVocab(workspace.tenantTrade).deposit;
  const DepositWord = `${depositWord.charAt(0).toUpperCase()}${depositWord.slice(1)}`;
  const [project, setProject] = useState<RecordValue | null>(null);
  const [proposal, setProposal] = useState<RecordValue | null>(null);
  /**
   * The proposal still out with the client, when none is accepted yet.
   *
   * Only the accepted one used to be read, so a job at "Proposal out" showed a
   * contract step with nothing to do and nothing to say about why — no link to
   * the proposal it was waiting on, and no way to record a yes given by email.
   */
  const [openProposal, setOpenProposal] = useState<RecordValue | null>(null);
  const [contract, setContract] = useState<RecordValue | null>(null);
  const [invoice, setInvoice] = useState<RecordValue | null>(null);
  // The last retainer voided, when nothing stands: said once above the form
  // that raises its replacement, so the step doesn't look as if it forgot.
  const [voidedRetainer, setVoidedRetainer] = useState<RecordValue | null>(null);
  // The retainer is only one of a job's invoices. The final balance lives
  // here too, and it is the number that actually needs chasing — leaving it
  // off the money screen was the sharpest finding of the audit.
  const [outstanding, setOutstanding] = useState<{
    cents: number;
    overdue: boolean;
    dueDate: string | null;
  } | null>(null);
  const [orchestration, setOrchestration] = useState<RecordValue | null>(null);
  const [packageSnapshot, setPackageSnapshot] = useState<RecordValue | null>(
    null,
  );
  const [contact, setContact] = useState<RecordValue | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [templateConfigured, setTemplateConfigured] = useState(false);
  /**
   * Seeded from what the product offers, not from a name.
   *
   * This began at "docusign" — a provider StudioCue does not offer, whose card
   * is hidden and which the server will not resolve to. See
   * features/integrations/schema.ts.
   */
  const [signingProvider, setSigningProvider] = useState<
    "docusign" | "dropbox_sign" | null
  >(() => (offeredSigningProvider() as "docusign" | "dropbox_sign" | null));
  const [signingTestMode, setSigningTestMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The last refusal was the job's version guard. Every booking action can
   * hit it, and the page is still holding the old job, so pressing the same
   * button again is refused again: the notice offers Refresh (wave 3).
   */
  const [staleJob, setStaleJob] = useState(false);
  /**
   * The invoicing app that raises this job's bills, by name. The retainer
   * step said "QuickBooks" to every studio, Stripe ones included (wave 3).
   */
  const [invoicingProvider, setInvoicingProvider] = useState<string | null>(null);
  const jobBillingState = useJobBilling(projectId);
  /**
   * The email that carries the retainer invoice, when it has not reached the
   * couple ("awaiting_delivery"). A failed one can be sent again from here
   * (communicationsCommand retryEmailJob, owner/admin) — the warning used to
   * say "try again" with no button to try with.
   */
  const [invoiceEmailJob, setInvoiceEmailJob] = useState<{ id: string; status: string } | null>(null);
  /** "create" or "retry": the retainer invoice waiting on its confirm step. */
  const [confirmingRetainer, setConfirmingRetainer] = useState<"create" | "retry" | null>(null);
  const [gateBlockers, setGateBlockers] = useState<string[]>([]);
  /**
   * A studio that writes its agreement in StudioCue sends from here: prepare,
   * read, sign for the studio, send. The signing-app and record-it paths
   * below stay for studios that do not — and "signed somewhere else?" stays
   * available to everyone.
   */
  const nativeSigning = useNativeSigning();

  const load = useCallback(async () => {
    if (!workspace.tenantId) return;
    // Re-read: whatever changed under the last action is now in hand.
    setStaleJob(false);
    setLoading(true);
    try {
      // See booking-autopilot-workspace: constructing the client outside the
      // try turned a config error into a permanent spinner.
      const { firestore } = getFirebaseClient();
      const projectSnapshot = await getDoc(
        doc(firestore, "projects", projectId),
      );
      if (
        !projectSnapshot.exists() ||
        projectSnapshot.get("tenantId") !== workspace.tenantId
      ) {
        throw new Error("Project not found in this workspace.");
      }
      const projectValue: RecordValue = {
        id: projectSnapshot.id,
        ...projectSnapshot.data(),
      };
      const [
        proposals,
        contracts,
        invoices,
        tenant,
        connections,
        routing,
        bookingPlan,
      ] = await Promise.all([
        getDocs(
          query(
            collection(firestore, "proposals"),
            where("tenantId", "==", workspace.tenantId),
            where("projectId", "==", projectId),
          ),
        ),
        getDocs(
          query(
            collection(firestore, "contracts"),
            where("tenantId", "==", workspace.tenantId),
            where("projectId", "==", projectId),
          ),
        ),
        getDocs(
          query(
            collection(firestore, "invoiceReferences"),
            where("tenantId", "==", workspace.tenantId),
            where("projectId", "==", projectId),
          ),
        ),
        getDoc(doc(firestore, "tenants", workspace.tenantId)),
        getDocs(
          query(
            collection(firestore, "integrationConnections"),
            where("tenantId", "==", workspace.tenantId),
          ),
        ),
        // These docs may not exist yet (fresh project / unconfigured
        // routing) and are role-restricted; a denied or failed read must
        // not take down the whole workspace load with it.
        getDoc(doc(firestore, "integrationRouting", workspace.tenantId)).catch(
          () => null,
        ),
        getDoc(doc(firestore, "bookingOrchestrations", projectId)).catch(
          () => null,
        ),
      ]);
      const proposalsByVersion = proposals.docs
        .map((item): RecordValue => ({ id: item.id, ...item.data() }))
        .sort(
          (left, right) =>
            Number(right.version ?? 0) - Number(left.version ?? 0),
        );
      const proposalValue =
        proposalsByVersion.find((item) => item.status === "accepted") ?? null;
      const openProposalValue = proposalValue
        ? null
        : (proposalsByVersion.find((item) =>
            ["draft", "internal_review", "approved", "sent", "viewed"].includes(
              String(item.status),
            ),
          ) ?? null);
      const contractValue =
        contracts.docs
          .map((item): RecordValue => ({ id: item.id, ...item.data() }))
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(
              String(left.createdAt ?? ""),
            ),
          )[0] ?? null;
      /**
       * The retainer that stands, not merely the newest.
       *
       * Picking the newest regardless meant a voided (or superseded) retainer
       * sat on this step for good: its branch shows the bill and has no way
       * to raise another, so a studio that voided a wrong retainer could
       * never raise the right one here. A refused attempt is still shown when
       * nothing stands, because "Try again" re-drives that same invoice.
       */
      const retainersByAge = invoices.docs
        .map((item): RecordValue => ({ id: item.id, ...item.data() }))
        .filter((item) => item.kind === "retainer")
        .sort((left, right) =>
          String(right.createdAt ?? "").localeCompare(
            String(left.createdAt ?? ""),
          ),
        );
      const invoiceValue =
        retainersByAge.find((item) => isStandingInvoice(item.status)) ??
        retainersByAge.find((item) => item.status === "failed") ??
        null;
      setVoidedRetainer(
        invoiceValue
          ? null
          : (retainersByAge.find((item) => item.status === "voided") ?? null),
      );
      const unpaid = invoices.docs
        .map((item): RecordValue => ({ id: item.id, ...item.data() }))
        .filter(
          (item) =>
            Number(item.balanceCents ?? 0) > 0 &&
            // "failed" belongs with the settled states here for the
            // opposite reason: nothing is owed on an invoice the provider
            // refused to create, because the client was never asked. It
            // was counted as outstanding, so a refused retainer showed as
            // a balance with a button offering to chase the couple for it.
            // A refused or replaced attempt is owed by nobody: the
            // client was never asked. Left in, a retry after a provider
            // refusal added the dead invoice's $569.70 to the live $1.00
            // and announced $570.70 outstanding.
            isStandingInvoice(item.status) &&
            !["paid", "refunded"].includes(String(item.status)),
        );
      const todayIso = todayLocalIso();
      setOutstanding(
        unpaid.length
          ? {
              cents: unpaid.reduce(
                (sum, item) => sum + Number(item.balanceCents ?? 0),
                0,
              ),
              overdue: unpaid.some((item) => {
                const due = String(item.dueDate ?? "").slice(0, 10);
                return Boolean(due) && due < todayIso;
              }),
              dueDate:
                unpaid
                  .map((item) => String(item.dueDate ?? "").slice(0, 10))
                  .filter(Boolean)
                  .sort()[0] ?? null,
            }
          : null,
      );
      const packageSnapshotId =
        typeof projectValue.packageSnapshotId === "string"
          ? projectValue.packageSnapshotId
          : null;
      const contactIds = Array.isArray(projectValue.clientContactIds)
        ? projectValue.clientContactIds
        : [];
      const [snapshotValue, contactValue] = await Promise.all([
        packageSnapshotId
          ? getDoc(doc(firestore, "packageSnapshots", packageSnapshotId))
          : null,
        typeof contactIds[0] === "string"
          ? getDoc(doc(firestore, "contacts", contactIds[0]))
          : null,
      ]);
      const signingResolution = resolveActiveProvider({
        capability: "signing",
        routing: routing?.exists()
          ? {
              selections:
                (routing.get("selections") as Record<
                  string,
                  "docusign" | "dropbox_sign" | null
                >) ?? {},
            }
          : null,
        connections: connections.docs.map((item) => ({
          provider: item.get("provider"),
          status: item.get("status"),
          archivedAt: item.get("archivedAt") ?? null,
        })),
      });
      // Unresolved means unresolved. Falling back to a fixed provider is how
      // the workspace came to name DocuSign at a studio that has none.
      const resolvedSigningProvider =
        signingResolution.outcome === "resolved" &&
        ["docusign", "dropbox_sign"].includes(signingResolution.provider)
          ? (signingResolution.provider as "docusign" | "dropbox_sign")
          : (offeredSigningProvider() as "docusign" | "dropbox_sign" | null);
      const signingConnection = connections.docs.find(
        (item) => item.get("provider") === resolvedSigningProvider,
      );
      const configuredTemplate =
        nestedString(tenant.data()?.defaultContractSettings, "templateId") ||
        String(signingConnection?.get("selectedResourceId") ?? "");
      setProject(projectValue);
      setProposal(proposalValue);
      setOpenProposal(openProposalValue);
      setContract(contractValue);
      setInvoice(invoiceValue);
      setOrchestration(
        bookingPlan?.exists()
          ? { id: bookingPlan.id, ...bookingPlan.data() }
          : null,
      );
      setPackageSnapshot(
        snapshotValue?.exists()
          ? { id: snapshotValue.id, ...snapshotValue.data() }
          : null,
      );
      setContact(
        contactValue?.exists()
          ? { id: contactValue.id, ...contactValue.data() }
          : null,
      );
      setTemplateId((current) => current || configuredTemplate);
      setTemplateConfigured(Boolean(configuredTemplate));
      setSigningProvider(resolvedSigningProvider);
      setSigningTestMode(signingConnection?.get("testMode") === true);
      const invoicingResolution = resolveActiveProvider({
        capability: "invoicing",
        routing: routing?.exists()
          ? {
              selections:
                (routing.get("selections") as Record<string, "quickbooks" | "stripe" | null>) ?? {},
            }
          : null,
        connections: connections.docs.map((item) => ({
          provider: item.get("provider"),
          status: item.get("status"),
          archivedAt: item.get("archivedAt") ?? null,
        })),
      });
      // The invoice's own provider first: it is what actually raised it.
      setInvoicingProvider(
        typeof invoiceValue?.provider === "string" && invoiceValue.provider
          ? invoiceValue.provider
          : invoicingResolution.outcome === "resolved"
            ? invoicingResolution.provider
            : null,
      );
      // Email jobs are readable by owners and admins (firestore.rules); a
      // coordinator's read would be refused, and couldn't retry it anyway.
      if (
        invoiceValue?.status === "awaiting_delivery" &&
        ["studio_owner", "studio_admin"].includes(workspace.role ?? "")
      ) {
        const jobs = await getDocs(
          query(
            collection(firestore, "emailJobs"),
            where("tenantId", "==", workspace.tenantId),
            where("invoiceId", "==", invoiceValue.id),
          ),
        ).catch(() => null);
        const newest = (jobs?.docs ?? [])
          .map((item) => ({
            id: item.id,
            status: String(item.get("status") ?? ""),
            at: String(item.get("updatedAt") ?? item.get("createdAt") ?? ""),
          }))
          .sort((left, right) => right.at.localeCompare(left.at))[0];
        setInvoiceEmailJob(newest ? { id: newest.id, status: newest.status } : null);
      } else {
        setInvoiceEmailJob(null);
      }
    } catch (error: unknown) {
      setNotice(friendlyError(error));
    } finally {
      setLoading(false);
    }
  }, [projectId, workspace.role, workspace.tenantId]);
  /**
   * A recorded retainer books the job a few seconds later, in a trigger
   * (booking-orchestration), so the refresh right after recording catches it
   * still "Awaiting deposit" and offering "Check and confirm" for a job that
   * had already booked (prod walk, 2026-10-06). Read once more after it lands.
   */
  const settleAfterRetainer = () => {
    window.setTimeout(() => {
      refreshTenantRecords("projects", "contracts", "invoiceReferences", "checkpoints", "readinessAssessments");
      void load().catch(() => {});
    }, 9000);
  };

  useEffect(() => {
    if (!workspace.loading && workspace.tenantId) {
      void Promise.resolve().then(load);
    }
  }, [load, workspace.loading, workspace.tenantId]);

  const projectState = String(project?.state ?? "");
  /**
   * A booking that arrived from somewhere else, with no paper on file.
   *
   * `attachImportedSignedCopy` was reachable only during an import, from the
   * single-booking form's optional file field — so a studio that imported in
   * bulk had signed contracts on disk and nowhere to put them. Offered
   * wherever the agreement is discussed, for as long as the slot is empty.
   */
  const importedContract =
    String(contract?.completionAuthority ?? "") === "imported";
  const canAttachSignedCopy =
    importedContract && !String(contract?.signedDocumentId ?? "");
  const contractComplete = contract?.status === "completed";
  const contractFailed = contract?.status === "failed";
  const invoiceFailed = invoice?.status === "failed";
  const invoicePaid =
    invoice?.status === "paid" && Number(invoice.balanceCents ?? 0) === 0;
  const bookingComplete = [
    "BOOKED",
    "PLANNING",
    "READY",
    "EVENT_COMPLETE",
    "POST_PRODUCTION",
    "DELIVERED",
    "REVIEW_REQUESTED",
    "CLOSED",
  ].includes(projectState);
  const bookedOn =
    typeof project?.bookingCompletedAt === "string" && project.bookingCompletedAt
      ? project.bookingCompletedAt.slice(0, 10)
      : null;
  // Setup runs in the minutes after booking: say so on the day it booked,
  // and that it happened on any day after.
  const bookedRecently = bookedOn !== null && bookedOn >= todayLocalIso();
  /**
   * When the retainer is due.
   *
   * The proposal the couple accepted says so — it is on their portal in
   * writing, above a line about reserving the date. This used to ignore it and
   * bill seven days from whenever the studio happened to click, so a couple who
   * agreed "due 1 October" was invoiced for 24 September. Found by walking a
   * real booking: the portal and the QuickBooks invoice disagreed, and the
   * invoice was the one with money attached.
   *
   * Seven days out remains the fallback for a booking with no proposal behind
   * it. `toISOString().slice(0, 10)` after a local `setDate` re-reads the date
   * in UTC, which put that a day late every evening west of Greenwich, so it
   * goes through the calendar helpers.
   */
  const agreedRetainerDueDate = useMemo(() => {
    const schedule = Array.isArray(proposal?.paymentSchedule)
      ? (proposal.paymentSchedule as Array<Record<string, unknown>>)
      : [];
    const retainer =
      schedule.find((item) => String(item.label ?? "").toLowerCase().includes("retainer")) ??
      schedule[0];
    const due = String(retainer?.dueDate ?? "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
  }, [proposal]);
  const dueDate = useMemo(
    () => agreedRetainerDueDate ?? addCalendarDays(todayLocalIso(), 7),
    [agreedRetainerDueDate],
  );
  /**
   * The retainer the couple agreed, as "Paid another way" will record it.
   *
   * The form's "Records $X" read the package's retainer while the server
   * records the accepted proposal's (agreed-retainer.ts) — so a studio that
   * overrode the retainer on the proposal was shown one figure and had
   * another written against its name.
   */
  const agreedRetainerCents = useMemo(
    () =>
      // Paid in full to book: the whole agreed price, whatever split an
      // older proposal wrote (agreed-retainer.ts).
      projectProfile(project).payment === "paid_in_full"
        ? paidInFullFromSchedule(proposal?.paymentSchedule, Number(packageSnapshot?.totalCents ?? 0))
        : retainerFromSchedule(
            proposal?.paymentSchedule,
            Number(packageSnapshot?.retainerCents ?? 0),
          ),
    [project, proposal, packageSnapshot],
  );
  /**
   * Whether there is a signing app to send through at all.
   *
   * `offeredProviders` carries no signing app — both are deferred on
   * subscription cost — so this is false for every studio today, and the whole
   * choose-a-template / paste-an-ID / approve-and-send block below was inert
   * UI leading the page. A new studio arriving from "Send contract" was told to
   * pick an agreement in Integrations, where there is nothing to pick, while
   * the one working path sat underneath as a grey note and a folded
   * `<details>`.
   *
   * When it is false, recording the signature the studio took themselves *is*
   * the workflow, and gets the primary treatment. Restore the send path the day
   * a signing app is offered — nothing here is deleted, only branched.
   */
  const signingOffered = signingProvider !== null;
  /**
   * A booking agreement (H2) goes out while the proposal is still only sent,
   * and the contract step waited for an accepted one — so the studio had no
   * way to withdraw it, though every screen sent them here to do so (walked
   * 2026-09-30).
   */
  const combinedOut = Boolean(
    contract?.mode === "combined" &&
      ["sent", "viewed"].includes(String(contract.status)) &&
      openProposal,
  );
  // A withdrawn agreement before any acceptance is not where the booking
  // stands: the proposal is, with its own next moves (walked 2026-09-30 —
  // "Contract · Cancelled · Signed with StudioCue" replaced "open the
  // proposal" and "record their yes").
  const shownContract =
    contract && (proposal || !["voided", "superseded", "declined"].includes(String(contract.status)))
      ? contract
      : null;
  const nativeActive =
    nativeSigning.enabled &&
    (Boolean(nativeSigning.agreementTemplateId) || contract?.provider === "studiocue");
  // "your invoicing app" when none resolves, rather than naming one the
  // studio may not have.
  const invoicingName = invoicingProvider ? providerName(invoicingProvider) : "your invoicing app";
  // How this job is billed (features/billing/job-billing.ts). A job the
  // studio bills itself gets no QuickBooks invoice button: the server
  // refuses it (BILLING_STUDIO_JOB), and the studio records the payment.
  const studioBilled = jobBillingState?.method === "studio";
  const recipient =
    typeof contact?.email === "string" && contact.email.includes("@")
      ? typeof contact.displayName === "string" && contact.displayName
        ? `${contact.displayName} (${contact.email})`
        : contact.email
      : null;
  const signingProviderLabel =
    signingProvider === "dropbox_sign"
      ? "Dropbox Sign"
      : signingProvider === "docusign"
        ? "Docusign"
        : // No signing app is offered or connected. Naming one would send the
          // studio looking for an account they do not have. Only reached in
          // copy that survives a lowercase noun phrase mid-sentence.
          "your signing app";
  /**
   * The same label where a sentence begins.
   *
   * The fallback is a lowercase noun phrase, so "The accepted proposal
   * supplies the exact package and price. your signing app remains the
   * authority…" shipped with a sentence starting in lowercase. Every other
   * insertion site is now inside the `signingOffered` branch, where the label
   * is a real provider name and reads correctly either way.
   */
  const signingProviderSentence =
    signingProviderLabel.charAt(0).toUpperCase() +
    signingProviderLabel.slice(1);
  // Superseded by bookingAutomationDrivesContract, which asks the sharper
  // question: not "is a plan running" but "is it running on this contract".
  const automationNeedsAttention = orchestration?.status === "needs_attention";
  const automationDriving = bookingAutomationDrivesContract({
    status: typeof orchestration?.status === "string" ? orchestration.status : null,
    planContractId:
      typeof orchestration?.contractId === "string"
        ? orchestration.contractId
        : null,
    contractId: contract?.id ?? null,
  });
  // Only *waiting* for a signature while there isn't one.
  const automationAwaitingSignature = automationDriving && !contractComplete;
  const automationHasOutstandingWork = bookingAutomationAwaitsProvider({
    driving: automationDriving,
    contractComplete,
    retainerPaid: invoicePaid,
  });

  /**
   * Which of the three steps is actually live.
   *
   * Each one is gated on the one before it — the retainer cannot be raised
   * until a signature is verified, and the booking cannot be confirmed until
   * the retainer clears — so at most one of them is ever actionable. The
   * page now shows that one.
   */
  // What this kind of job needs to book (job-kinds.ts): a family session has
  // no agreement; a sports day pays nothing to book.
  const kindProfile = projectProfile(project);
  const kindNeeds = bookingGateNeeds(kindProfile);
  /**
   * A DJ, makeup artist or hair stylist books in one link (trades.ts, read
   * with the job's kind as journeyFor does): the client signs the booking
   * link, then pays the deposit in the same visit. So the steps read as one
   * booking — sent, signed, paid — not a contract chore and a retainer chore.
   * A photographer's read exactly as before.
   */
  const oneLink = kindNeeds.agreement && tradeProfile(workspace.tenantTrade).journey.oneLinkBooking;
  const agreementSettled = contractComplete || !kindNeeds.agreement;
  // A family session paid in full takes the whole price to book: there is no
  // "retainer" or "deposit" to speak of, and nothing waits for a signature.
  const paidInFull = kindProfile.payment === "paid_in_full";
  const paymentSettled = invoicePaid || !kindNeeds.payment;
  const activeStep = !agreementSettled ? 1 : !paymentSettled ? 2 : 3;
  const stepState = (step: number) =>
    step < activeStep ? "done" : step === activeStep ? "current" : "waiting";
  const steps = [
    {
      number: 1,
      title: kindNeeds.agreement ? (oneLink ? "Booking link" : "Contract") : "Agreement",
      state: bookingComplete ? "done" : stepState(1),
      /**
       * A booked job with no contract document here.
       *
       * The step was marked done — the stage says the job is booked — and the
       * note underneath still said "Not sent", directly contradicting the
       * journey on the same job, which ticked "Contract signed". The booking
       * gate is the authority for the transition; what this page knows is
       * whether the paperwork is in StudioCue.
       */
      note: contractComplete
        ? oneLink && kindNeeds.payment
          ? invoicePaid
            ? "Signed and paid"
            : "Signed — deposit due"
          : "Signed"
        : !kindNeeds.agreement
          ? "Not needed for this kind of job"
          : shownContract
          ? oneLink && ["sent", "viewed"].includes(String(shownContract.status))
            ? "Sent — waiting to sign"
            : statusLabel(String(shownContract.status))
          : bookingComplete
            ? "Not recorded here"
            : proposal
              // Not "Ready to send": this can't see the draft's blanks, and it
              // said so beside "1 to fill in" on the same page (prod walk,
              // 2026-10-06). The agreement card below says what's missing.
              ? "Not sent yet"
              : `Waits for the ${offer}`,
    },
    {
      number: 2,
      title: kindNeeds.payment && kindProfile.payment !== "paid_in_full" ? DepositWord : "Payment",
      state: bookingComplete ? "done" : stepState(2),
      // "Waits for the signature" is only true while it is waiting. Once
      // this becomes the live step that sentence describes the past and
      // reads as though the step is still blocked.
      note: invoicePaid
        ? "Paid"
        : !kindNeeds.payment
          ? kindProfile.payment === "on_the_day"
            ? "Paid on the day"
            : "Invoiced after the event"
          : invoice
          ? statusLabel(String(invoice.status))
          : bookingComplete
            ? "Not recorded here"
            : agreementSettled
              ? "Ready to raise"
              : oneLink
                ? "Paid after signing"
                : "Waits for the signature",
    },
    {
      number: 3,
      title: "Booking",
      state: bookingComplete ? "done" : stepState(3),
      note: bookingComplete
        ? "Confirmed"
        : invoicePaid || !kindNeeds.payment
          ? "Ready to confirm"
          : paidInFull
            ? "Waits for the payment"
            : `Waits for the ${depositWord}`,
    },
  ];

  async function createContract() {
    if (!project || !proposal || !contact || !templateId.trim()) {
      setNotice(
        `Choose a ${signingProviderLabel} template and confirm the client contact first.`,
      );
      return;
    }
    setBusy("contract");
    setNotice(null);
    try {
      await sendBookingCommand({
        type: "createEnvelope",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          proposalId: proposal.id,
          templateId: templateId.trim(),
          activateBookingAutomation: true,
          retainerDueDays: 7,
          signers: [
            {
              name: String(contact.displayName ?? contact.email ?? "Client"),
              email: String(contact.email ?? ""),
              role: "Client",
              order: 1,
            },
          ],
        },
      });
      setNotice(
        `Booking sequence approved. The contract is queued through ${signingProviderLabel}; StudioCue will prepare the ${depositWord} after signature and confirm the booking after payment.`,
      );
      // Refresh the shared tenant store too, so the project badge in the
      // context bar, the autopilot hero, and the readiness gauge reflect the
      // new state — without this, confirming a booking left them reading
      // "Awaiting deposit" until a manual reload.
      refreshTenantRecords(
        "projects",
        "contracts",
        "invoiceReferences",
        "checkpoints",
        "readinessAssessments",
      );
      await load();
    } catch (error: unknown) {
      setNotice(friendlyError(error));
      setStaleJob(isVersionConflict(error));
    } finally {
      setBusy(null);
    }
  }

  /** Send the retainer email again after it failed (see `invoiceEmailJob`). */
  async function resendInvoiceEmail() {
    if (!invoiceEmailJob) return;
    setBusy("invoice_email");
    setNotice(null);
    try {
      const result = await sendCommunicationsCommand({
        type: "retryEmailJob",
        idempotencyKey: `retryEmailJob_${invoiceEmailJob.id}_${Date.now()}`,
        input: { emailJobId: invoiceEmailJob.id },
      });
      setNotice(
        result.mode === "preview"
          ? "Preview mode — nothing was sent."
          : `The invoice email is on its way to ${recipient ?? "the couple"} again.`,
      );
      setInvoiceEmailJob({ ...invoiceEmailJob, status: "queued" });
    } catch (error: unknown) {
      setNotice(friendlyError(error));
    } finally {
      setBusy(null);
    }
  }

  async function createRetainer() {
    if (!project || !packageSnapshot) return;
    setBusy("retainer");
    setNotice(null);
    try {
      await sendBookingCommand({
        type: "createRetainerInvoice",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          packageSnapshotId: packageSnapshot.id,
          customerId: null,
          dueDate,
        },
      });
      setNotice(
        `The ${depositWord} invoice is being raised in ${invoicingName}; ${
          recipient ?? "the couple"
        } gets it by email.`,
      );
      // Refresh the shared tenant store too, so the project badge in the
      // context bar, the autopilot hero, and the readiness gauge reflect the
      // new state — without this, confirming a booking left them reading
      // "Awaiting deposit" until a manual reload.
      refreshTenantRecords(
        "projects",
        "contracts",
        "invoiceReferences",
        "checkpoints",
        "readinessAssessments",
      );
      await load();
    } catch (error: unknown) {
      setNotice(friendlyError(error));
      setStaleJob(isVersionConflict(error));
    } finally {
      setBusy(null);
    }
  }

  async function reviewBooking() {
    if (!project) return;
    setBusy("gate");
    setNotice(null);
    try {
      /**
       * The version, read at the moment of asking.
       *
       * Recording a retainer calls `load()`, but the project's own state moves
       * a beat later — so the page was left holding the version from before
       * the transition, and confirming the booking failed every time with
       * PROJECT_VERSION_CONFLICT, surfaced as "This action could not be
       * completed." Reproduced twice on production: record the retainer,
       * confirm, fail; reload the page, confirm, booked. It is the last click
       * of getting a job booked, and the manual-attestation path is the one a
       * studio without a signing provider always takes.
       *
       * The guard still does its job — it exists to stop a decision made
       * against a project that has since changed — but the decision here is
       * "confirm this booking", and what it must be current with is the state
       * the server holds now, not the one this component last rendered.
       */
      const { firestore: liveFirestore } = getFirebaseClient();
      const current = await getDoc(doc(liveFirestore, "projects", projectId));
      const expectedProjectVersion = current.exists()
        ? Number(current.get("stateVersion") ?? 0)
        : Number(project.stateVersion ?? 0);
      const response = await sendBookingCommand({
        type: "runBookingGate",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          expectedProjectVersion,
          approvedRetainerExceptionId: null,
        },
      });
      const payload =
        response.mode === "live" &&
        response.payload &&
        typeof response.payload === "object"
          ? (response.payload as Record<string, unknown>)
          : {};
      const blockers = Array.isArray(payload.blockers)
        ? payload.blockers.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      setGateBlockers(blockers);
      setNotice(
        payload.passed === true
          ? "Booking confirmed. We're setting the job up now."
          : "Booking is still waiting on the requirements shown below.",
      );
      // Refresh the shared tenant store too, so the project badge in the
      // context bar, the autopilot hero, and the readiness gauge reflect the
      // new state — without this, confirming a booking left them reading
      // "Awaiting deposit" until a manual reload.
      refreshTenantRecords(
        "projects",
        "contracts",
        "invoiceReferences",
        "checkpoints",
        "readinessAssessments",
      );
      await load();
    } catch (error: unknown) {
      setNotice(friendlyError(error));
      setStaleJob(isVersionConflict(error));
    } finally {
      setBusy(null);
    }
  }

  if (gate.status === "error") {
    return (
      <PanelError
        detail={gate.message}
        onRetry={gate.retry}
        title="Booking evidence could not be loaded"
      />
    );
  }
  if (gate.status === "loading" || loading) {
    return (
      <PanelLoading
        detail={`Checking ${offer}, signing, and payment records.`}
        label="Loading booking evidence…"
      />
    );
  }

  return (
    <section className="booking-workspace">
      {/* Money still owed leads, because it is the only thing on this screen
          that needs doing. The three steps below are a record of a booking
          that, by the time a balance is outstanding, already happened. */}
      {outstanding ? (
        <aside
          className={`booking-outstanding${outstanding.overdue ? " is-overdue" : ""}`}
        >
          <ReceiptText aria-hidden="true" size={18} />
          <span>
            <strong>
              {currency(outstanding.cents, invoice?.currency)}{" "} still owed
            </strong>
            <small>
              {outstanding.overdue
                ? `Overdue since ${formatDueDate(outstanding.dueDate)}`
                : outstanding.dueDate
                  ? `Due ${formatDueDate(outstanding.dueDate)}`
                  : "No due date set"}
            </small>
          </span>
          {/* This job's invoices, where the final bill can be sent or
              recorded — not the whole studio's list (wave 3). */}
          <Link className="button button-dark" href={`/studio/invoices?project=${projectId}`}>
            Follow up on payment <ArrowRight size={15} />
          </Link>
        </aside>
      ) : null}
      {/* Where they are billed, and whether the couple confirmed it at signing. */}
      <BillingAddressSummary
        contact={contact}
        showMissing={invoicingProvider === "quickbooks" && !studioBilled && kindProfile.billingAddressRequest}
        signsAgreement={kindNeeds.agreement}
      />
      {/* One step at a time.

          Three equal columns gave the same weight to the step you can act on
          and the two you cannot, so two thirds of the page was prose about
          things that were not yet possible — which read as a list of things
          to do and left a studio arriving from "Send contract" unsure which
          of them was theirs. The strip keeps the shape of the sequence
          visible; only the live step gets the room to explain itself. */}
      <ol className="booking-progress" aria-label="Booking sequence">
        {steps.map((step) => (
          <li
            className={`booking-progress-step is-${step.state}`}
            key={step.number}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <span className="booking-progress-mark">
              {step.state === "done" ? <Check size={14} /> : step.number}
            </span>
            <span className="booking-progress-copy">
              <strong>{step.title}</strong>
              <small>{step.note}</small>
            </span>
          </li>
        ))}
      </ol>
      <div className="booking-steps" aria-label="Booking workflow">
        {activeStep === 1 ? (
          <article
            className={
              contractComplete ? "booking-step is-complete" : "booking-step"
            }
          >
            <span className="booking-step-number">
              {contractComplete ? <Check size={17} /> : "1"}
            </span>
            <div className="booking-step-heading">
              <FileSignature aria-hidden="true" />
              <span>
                <small>{oneLink ? "Sign, then pay the deposit" : "The agreement"}</small>
                <h2>{oneLink ? "Booking link" : "Contract"}</h2>
              </span>
              <StatusBadge
                tone={
                  contractComplete ? "success" : shownContract ? "info" : "neutral"
                }
              >
                {shownContract
                  ? statusLabel(shownContract.status)
                  : proposal
                    ? nativeActive
                      ? // A StudioCue contract may already be prepared and
                        // waiting; "Not created" sat beside "Ready to send".
                        "Not sent yet"
                      : "Not created"
                    : "Waiting"}
              </StatusBadge>
            </div>
            {contractComplete && contract ? (
              <SignedCopySharing contract={contract} showFiles={!(nativeActive && proposal)} />
            ) : null}
            {canAttachSignedCopy ? (
              <AttachSignedCopy
                onAttached={(message) => {
                  setNotice(message);
                  refreshTenantRecords("projects", "contracts");
                  void load();
                }}
                projectId={projectId}
              />
            ) : null}
            {!nativeActive && (proposal || contract) ? (
            <p>
              {`Built from the accepted ${offer}, so the package and price are already set.`}
              {" "}{signingOffered
                ? ` ${signingProviderSentence} remains the authority for signature completion.`
                : null}
            </p>
            ) : null}
            {nativeActive && (proposal || combinedOut) ? (
              <>
                <NativeContractStep
                  contract={contract}
                  jobKind={kindProfile.kind}
                  onChanged={(message) => {
                    if (message) setNotice(message);
                    refreshTenantRecords(
                      "projects",
                      "contracts",
                      "checkpoints",
                      "readinessAssessments",
                    );
                    void load();
                  }}
                  projectId={projectId}
                  proposal={(proposal ?? openProposal)!}
                />
                {/* A booking agreement is signed in the portal or withdrawn;
                    a hand-recorded signature would skip the acceptance it
                    carries. */}
                {proposal && contract?.status !== "completed" ? (
                  <RecordSignedAgreement
                    primary={false}
                    supersedes={Boolean(
                      contract &&
                        contract.provider === "studiocue" &&
                        ["sent", "viewed"].includes(String(contract.status)),
                    )}
                    onRecorded={(message) => {
                      setNotice(message);
                      refreshTenantRecords(
                        "projects",
                        "contracts",
                        "invoiceReferences",
                        "checkpoints",
                        "readinessAssessments",
                      );
                      void load();
                    }}
                    projectId={projectId}
                    proposalId={String(proposal.id)}
                  />
                ) : null}
              </>
            ) : contractFailed ? (
              // A refused contract is not evidence of anything, and hiding
              // the send form behind "a contract exists" left the booking
              // with nowhere to go. Say what the provider said, and offer
              // the one thing that helps.
              <div className="booking-contract-failed">
                <p role="alert">
                  <CircleAlert aria-hidden="true" size={15} />
                  <span>
                    <strong>{signingProviderLabel} refused this request</strong>
                    <small>
                      {providerFailureHint(
                        String(
                          (contract?.providerError as { message?: string })
                            ?.message ?? "",
                        ),
                        signingProviderLabel,
                        signingTestMode,
                      )}
                    </small>
                  </span>
                </p>
                {/**
                  * "Try again" is only an answer when there is something to
                  * try again with.
                  *
                  * With no signing app connected the send cannot succeed, so
                  * offering a retry as the prominent control sends a studio
                  * round a loop that cannot end — the reference studio sat on
                  * exactly this screen and told us "never got a contract to
                  * sign, so couldn't complete the run through". Recording the
                  * signature they took themselves is the path, and below it
                  * `primary` opens it rather than folding it shut.
                  */}
                {signingOffered ? (
                  <button
                    className="button"
                    disabled={busy !== null}
                    onClick={() => void createContract()}
                    type="button"
                  >
                    {busy === "contract" ? "Sending…" : "Try again"}
                    <ArrowRight size={15} />
                  </button>
                ) : (
                  <p className="booking-contract-manual-hint">
                    No signing app is connected, so StudioCue cannot send this
                    for signature. Send your agreement the way you do today,
                    then record the signature below.
                  </p>
                )}
                {proposal ? (
                  <RecordSignedAgreement
                    primary={!signingOffered}
                    onRecorded={(message) => {
                      // The branch this control lives in unmounts as soon as
                      // the contract exists, taking any notice inside it with
                      // it — which is why recording a signature used to say
                      // nothing at all. The workspace keeps it.
                      setNotice(message);
                      // `load()` refreshes this workspace's own reads. The
                      // project badge, the readiness evidence and the records
                      // panels come from the shared tenant store, which is
                      // fetch-once — so recording a signature said "Signature
                      // recorded against your name" while the badge above it
                      // still read "Awaiting signature" and the evidence panel
                      // still read "No contracts yet", until a manual reload.
                      refreshTenantRecords(
                        "projects",
                        "contracts",
                        "invoiceReferences",
                        "checkpoints",
                        "readinessAssessments",
                      );
                      void load();
                    }}
                    projectId={projectId}
                    proposalId={String(proposal.id)}
                  />
                ) : null}
              </div>
            ) : shownContract ? (
              <div className="booking-evidence">
                {/* The provider's envelope id is an internal reference, not a
                    number the couple would ever quote. Who signed it and when
                    is what the studio actually needs to see. */}
                <span>
                  <small>Signed with</small>
                  <strong>
                    {providerName(
                      String(shownContract.provider ?? "the signing provider"),
                    )}
                  </strong>
                </span>
                <span>
                  <small>Sent</small>
                  <strong>
                    {/* A timestamp, not a calendar date: read as a date it
                        showed the UTC day ("Sep 30" for 10:25 PM on the 29th). */}
                    {shownContract.sentAt
                      ? new Date(String(shownContract.sentAt)).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Queued"}
                  </strong>
                </span>
              </div>
            ) : !proposal && !bookingComplete ? (
              /**
               * Waiting on the proposal, said as that.
               *
               * This branch used to render the send form regardless: a paragraph
               * about having no signing app, two provider notes and, in faint
               * type at the bottom, "The client's accepted proposal is required
               * first". Nothing on it could be pressed. A job at "Proposal out"
               * is waiting on the couple, and the studio's moves are to look at
               * the proposal or record a yes they already have.
               */
              <div className="booking-waiting-proposal">
                <div className="booking-complete-message">
                  <Clock3 aria-hidden="true" size={18} />
                  <span>
                    <strong>
                      {!openProposal
                        ? `There is no ${offer} for this job yet`
                        : ["sent", "viewed"].includes(String(openProposal.status))
                          ? `Waiting for the client to accept the ${offer}`
                          : openProposal.status === "approved"
                            ? `The ${offer} is approved but not sent yet`
                            : `The ${offer} is still a draft`}
                    </strong>
                    <small>
                      {oneLink && openProposal && ["approved", "sent", "viewed"].includes(String(openProposal.status))
                        ? openProposal.status === "approved"
                          ? "Send the booking link: the client signs, then pays the deposit, in one visit."
                          : "Send the booking link instead, and they sign and pay the deposit in one go."
                        : !openProposal
                        ? `The agreement is built from an accepted ${offer}, so that comes first.`
                        : openProposal.status === "viewed"
                          ? "They have opened it. The agreement is next once they accept."
                          : openProposal.status === "sent"
                            ? "The agreement is next once they accept."
                            : openProposal.status === "approved"
                              ? `Send it from the ${offer}, or record the yes if they have already agreed.`
                              : "Finish and send it — the agreement is next once they accept."}
                    </small>
                  </span>
                </div>
                <div className="booking-waiting-actions">
                  {/* Without a proposal the only offer is to prepare one, and
                      the command only takes that at consultation or proposal
                      stage. A job at CONTRACT_PENDING with no proposal record
                      was still offered it, and the composer had no way to
                      refuse out loud. */}
                  {openProposal ||
                  canCreateProposalForProject(projectState, project, workspace.tenantTrade) ? (
                    <Link
                      className="button button-dark"
                      href={
                        openProposal
                          ? `/studio/proposals/${openProposal.id}`
                          : `/studio/proposals/new?project=${projectId}`
                      }
                    >
                      {openProposal
                        ? `Open the ${offer}`
                        : `Prepare the ${offer}`}
                      <ArrowRight size={15} />
                    </Link>
                  ) : (
                    <Link className="button button-light" href={`/studio/projects/${projectId}`}>
                      Open the job <ArrowRight size={15} />
                    </Link>
                  )}
                </div>
                {openProposal &&
                ["approved", "sent", "viewed"].includes(
                  String(openProposal.status),
                ) ? (
                  <RecordProposalAcceptance
                    next={kindNeeds.agreement ? "the agreement" : kindNeeds.payment ? "payment" : "booking"}
                    onRecorded={(message) => {
                      setNotice(message);
                      refreshTenantRecords(
                        "projects",
                        "proposals",
                        "checkpoints",
                        "readinessAssessments",
                      );
                      void load();
                    }}
                    proposalId={String(openProposal.id)}
                  />
                ) : null}
                {/* Booking in one link: a quote that went on its own can
                    still go out as the booking link — the same quote, signed
                    and paid for in one visit. The component hides itself
                    where it's off or the user can't sign for the studio. */}
                {oneLink &&
                openProposal &&
                ["approved", "sent", "viewed"].includes(String(openProposal.status)) ? (
                  <CombinedAgreementSend
                    onSent={() => {
                      setNotice("Booking link sent. The client signs, then pays the deposit.");
                      refreshTenantRecords("projects", "proposals", "contracts");
                      void load();
                    }}
                    projectId={projectId}
                    proposalId={String(openProposal.id)}
                  />
                ) : null}
              </div>
            ) : (
              <div className="booking-action-form">
                {!signingOffered ? (
                  /* No signing app to send through. Say what happens instead,
                     and let the record control below be the action. */
                  <p className="booking-signing-absent">
                    {`Send your agreement the way you usually do — by email or in person — then record the signature below. The ${depositWord} follows, exactly as it would through a signing app.`}
                  </p>
                ) : templateConfigured ? (
                  // Provider internals stay out of the flow: a configured
                  // template needs no raw ID pasted mid-booking.
                  <details className="booking-template-configured">
                    <summary>
                      Using your approved {signingProviderLabel}{" "} agreement
                      template.
                    </summary>
                    <label>
                      Use a different template ID for this client only
                      <input
                        onChange={(event) => setTemplateId(event.target.value)}
                        placeholder="Approved agreement template"
                        value={templateId}
                      />
                    </label>
                    <small>
                      Set the studio default in{" "}
                      <Link href="/studio/integrations">Integrations</Link>.
                    </small>
                  </details>
                ) : (
                  // No studio default yet. An empty box labelled with a
                  // provider's internal ID is not an instruction — a studio
                  // arriving here from "Send contract" has no idea a GUID is
                  // wanted, or where to get one. Name the missing thing and
                  // point at the one screen that sets it.
                  <div className="booking-template-missing">
                    <strong>Choose your agreement first</strong>
                    <small>
                      StudioCue sends the agreement you pick once in{" "}
                      <Link href="/studio/integrations">Integrations</Link>, and
                      reuses it for every booking.
                    </small>
                    <details>
                      <summary>
                        Or paste a {signingProviderLabel}{" "} template ID
                      </summary>
                      <label>
                        {signingProviderLabel}{" "} template ID
                        <input
                          onChange={(event) =>
                            setTemplateId(event.target.value)
                          }
                          placeholder="Approved agreement template"
                          value={templateId}
                        />
                      </label>
                    </details>
                  </div>
                )}
                {signingOffered ? (
                  <button
                    className="button"
                    disabled={
                      busy !== null ||
                      !proposal ||
                      projectState !== "CONTRACT_PENDING"
                    }
                    onClick={() => void createContract()}
                    type="button"
                  >
                    {busy === "contract"
                      ? "Preparing…"
                      : "Approve sequence & send"}
                    <ArrowRight size={15} />
                  </button>
                ) : null}
                {!proposal ? (
                  <small>
                    {`The client’s accepted ${offer} is required first.`}
                  </small>
                ) : null}
                {/* This button is where signing actually fires, and the
                    retainer follows it. The workspace names the provider in
                    its copy but never said whether it is connected — it only
                    read the connection to guess a default template. */}
                {signingTestMode ? (
                  <p className="booking-test-mode" role="alert">
                    <FlaskConical aria-hidden="true" size={14} />
                    <span>
                      Dropbox Sign is in <strong>test mode</strong>. This
                      agreement will be watermarked and the signature will not
                      be legally binding.
                    </span>
                  </p>
                ) : null}
                {/* Said once. With no signing app offered, the paragraph above
                    already describes the path, and this note repeated it. */}
                {signingOffered ? <CapabilityNote capability="signing" /> : null}
                {proposal ? (
                  <RecordSignedAgreement
                    onRecorded={(message) => {
                      // The branch this control lives in unmounts as soon as
                      // the contract exists, taking any notice inside it with
                      // it — which is why recording a signature used to say
                      // nothing at all. The workspace keeps it.
                      setNotice(message);
                      // `load()` refreshes this workspace's own reads. The
                      // project badge, the readiness evidence and the records
                      // panels come from the shared tenant store, which is
                      // fetch-once — so recording a signature said "Signature
                      // recorded against your name" while the badge above it
                      // still read "Awaiting signature" and the evidence panel
                      // still read "No contracts yet", until a manual reload.
                      refreshTenantRecords(
                        "projects",
                        "contracts",
                        "invoiceReferences",
                        "checkpoints",
                        "readinessAssessments",
                      );
                      void load();
                    }}
                    primary={!signingOffered}
                    projectId={projectId}
                    proposalId={String(proposal.id)}
                  />
                ) : null}
              </div>
            )}
            {/* Background, deliberately after the action. This card used to
                open with two explanatory panels, so the one control on it sat
                below a screen of prose and a studio arriving from "Send
                contract" could not see what it was being asked to do. */}
            {!contract && signingOffered ? (
              <aside className="booking-provider-migration">
                <strong>One approval completes the routine booking work</strong>
                <small>
                  {`Approve this sequence once. StudioCue will wait for verified signature evidence, create the ${depositWord}, wait for provider payment evidence, and finish project setup. It stops if an exception needs you.`}
                </small>
              </aside>
            ) : null}
            {signingOffered ? (
              <aside className="booking-provider-migration">
                <strong>Your approved agreement stays reusable</strong>
                <small>
                  Import the current agreement once. StudioCue preserves its
                  wording and signer fields, then reuses the approved{" "}
                  {signingProviderLabel}{" "} template so you do not place fields
                  for every client.
                </small>
              </aside>
            ) : null}
          </article>
        ) : null}
        {activeStep === 2 ? (
          <article
            className={
              invoicePaid ? "booking-step is-complete" : "booking-step"
            }
          >
            <span className="booking-step-number">
              {invoicePaid ? <Check size={17} /> : "2"}
            </span>
            <div className="booking-step-heading">
              <ReceiptText aria-hidden="true" />
              <span>
                <small>{paidInFull ? "Paid in full" : oneLink ? "Paid after signing" : "The deposit"}</small>
                <h2>{paidInFull ? "Payment" : DepositWord}</h2>
              </span>
              <StatusBadge
                tone={invoicePaid ? "success" : invoice ? "warning" : "neutral"}
              >
                {invoice ? statusLabel(invoice.status) : "Not created"}
              </StatusBadge>
            </div>
            <p>
              {studioBilled
                ? "You bill this job yourself: StudioCue numbers the invoice, makes its PDF and keeps track of what's paid. Nothing goes to QuickBooks."
                : `StudioCue matches or creates the customer in ${invoicingName}, then tracks the invoice there without handling card details.`}
            </p>
            {studioBilled && invoice ? (
              // The invoice the studio issued: its number, its PDF, and email it (again).
              <StudioDepositPanel canCreate={false} onDone={(message) => setNotice(message)} projectId={projectId} />
            ) : null}
            {invoiceFailed ? (
              // A refused invoice is not a retainer waiting to be paid, and
              // showing it as one left the studio watching for an email
              // that was never sent. Say what the provider said, and offer
              // both ways forward.
              <div className="booking-contract-failed">
                <p role="alert">
                  <CircleAlert aria-hidden="true" size={15} />
                  <span>
                    <strong>{`${invoicingName} refused this invoice`}</strong>
                    <small>
                      {providerFailureHint(
                        String(
                          (invoice?.providerError as { message?: string })
                            ?.message ?? "",
                        ),
                        invoicingName,
                        false,
                        "billing",
                      )}
                    </small>
                  </span>
                </p>
                {confirmingRetainer === "retry" ? (
                  <ConfirmStep
                    busy={busy === "retainer"}
                    cancelLabel="Not now"
                    confirmLabel={`Send the ${currency(agreedRetainerCents, packageSnapshot?.currency)} invoice`}
                    label={`Send the ${depositWord} invoice again?`}
                    onCancel={() => setConfirmingRetainer(null)}
                    onConfirm={() => void createRetainer().then(() => setConfirmingRetainer(null))}
                  >
                    {`${invoicingName} raises a ${currency(agreedRetainerCents, packageSnapshot?.currency)} ${paidInFull ? "invoice for the full price" : `${depositWord} invoice`}, due ${formatDueDate(dueDate)}, and ${recipient ?? "the client"} is emailed it. Once it's out it can only be voided, not unsent.`}
                  </ConfirmStep>
                ) : (
                  <button
                    className="button"
                    disabled={busy !== null}
                    onClick={() => setConfirmingRetainer("retry")}
                    type="button"
                  >
                    {`Try again · ${currency(agreedRetainerCents, packageSnapshot?.currency)}`}
                    <ArrowRight size={15} />
                  </button>
                )}
                {packageSnapshot ? (
                  <RecordRetainerPayment
                    paidInFull={paidInFull}
                    onRecorded={(message) => {
                      // The branch this control lives in unmounts as soon as
                      // the contract exists, taking any notice inside it with
                      // it — which is why recording a signature used to say
                      // nothing at all. The workspace keeps it.
                      setNotice(message);
                      // `load()` refreshes this workspace's own reads. The
                      // project badge, the readiness evidence and the records
                      // panels come from the shared tenant store, which is
                      // fetch-once — so recording a signature said "Signature
                      // recorded against your name" while the badge above it
                      // still read "Awaiting signature" and the evidence panel
                      // still read "No contracts yet", until a manual reload.
                      refreshTenantRecords(
                        "projects",
                        "contracts",
                        "invoiceReferences",
                        "checkpoints",
                        "readinessAssessments",
                      );
                      void load();
                      settleAfterRetainer();
                    }}
                    packageSnapshotId={String(packageSnapshot.id)}
                    projectId={projectId}
                    // A refused invoice is not settled by this: the server
                    // records the agreed retainer afresh, so show that.
                    retainerLabel={currency(
                      agreedRetainerCents,
                      packageSnapshot.currency,
                    )}
                  />
                ) : null}
              </div>
            ) : invoice ? (
              <div className="booking-evidence">
                <span>
                  <small>Amount</small>
                  <strong>
                    {currency(invoice.amountCents, invoice.currency)}
                  </strong>
                </span>
                <span>
                  <small>Balance</small>
                  <strong>
                    {currency(invoice.balanceCents, invoice.currency)}
                  </strong>
                </span>
                {/*
                  The number the client sees and the studio reconciles
                  against. Worth showing precisely because it is the one
                  identifier shared with QuickBooks and the client's copy.
                */}
                {typeof invoice.providerDocNumber === "string" &&
                invoice.providerDocNumber ? (
                  <span>
                    <small>Invoice no.</small>
                    <strong>{invoice.providerDocNumber}</strong>
                  </span>
                ) : null}
                {typeof invoice.hostedUrl === "string" && invoice.hostedUrl ? (
                  <Link
                    href={invoice.hostedUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {`Open the ${providerName(
                      typeof invoice.provider === "string" && invoice.provider ? invoice.provider : invoicingProvider ?? "quickbooks",
                    )} invoice`}{" "}
                    <ArrowRight size={13} />
                  </Link>
                ) : null}
                {/*
                  In QuickBooks with no pay link: the company has no online
                  payments, so the couple's portal tells them to pay the
                  studio directly. The studio needs to know why, and that
                  "Record a payment" below is how the money gets in.
                */}
                {/* The lines QuickBooks received — crew × the per-crew
                    retainer, then the packages at $0 — and a warning when
                    QuickBooks billed something else. */}
                <ProviderInvoiceLines invoice={invoice} />
                {/* Held in QuickBooks for the studio (billingSettings
                    .holdRetainerForReview): "Check and send the retainer". */}
                <HeldInvoiceReview invoice={invoice} onDone={() => void load()} />
                {/* Held: its pay link is fetched when it is sent, not missing. */}
                {quickBooksInvoiceWithoutPayLink(invoice) &&
                invoice.status !== "review_required" &&
                invoicePaymentRefusal(invoice) === null ? (
                  <p className="booking-delivery-warning" role="status">
                    <CircleAlert aria-hidden="true" size={14} />
                    <span>{QUICKBOOKS_NO_PAY_LINK_NOTE}</span>
                  </p>
                ) : null}
                {/*
                  Raised but not delivered. QuickBooks only emails an
                  invoice when asked, and the difference between an invoice
                  the client has and one sitting in the studio's books is
                  the whole question when someone asks why no email came.
                */}
                {invoice.status === "awaiting_delivery" ? (
                  <p className="booking-delivery-warning" role="status">
                    <CircleAlert aria-hidden="true" size={14} />
                    <span>
                      {`The invoice exists in ${invoicingName} but ${recipient ?? "the client"} hasn't been emailed it`}
                      {invoice.deliveryError === "NO_CLIENT_EMAIL"
                        ? " \u2014 this job has no client email address. Add one to the client, then send it from here."
                        : invoiceEmailJob?.status === "held_billing"
                          ? " yet \u2014 it's held until the studio's billing is updated, and goes as soon as it is."
                        : invoiceEmailJob && ["queued", "running", "retry_scheduled"].includes(invoiceEmailJob.status)
                          ? " yet \u2014 the email is on its way."
                          : invoiceEmailJob && ["failed", "dead_letter"].includes(invoiceEmailJob.status)
                            ? " \u2014 the email didn't go through."
                            : `. Send it from ${invoicingName}.`}
                    </span>
                    {invoiceEmailJob && ["failed", "dead_letter"].includes(invoiceEmailJob.status) ? (
                      <button
                        className="button button-light button-sm"
                        disabled={busy !== null}
                        onClick={() => void resendInvoiceEmail()}
                        type="button"
                      >
                        {busy === "invoice_email" ? "Sending\u2026" : "Send the email again"}
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {/*
                  The way through when the couple pays another way. This used to
                  be absent here, so a studio that raised the invoice and then
                  took a bank transfer had no path at all: the server refused a
                  second attestation and the only alternative was a QuickBooks
                  webhook for money that never went through QuickBooks. It
                  settles the standing invoice rather than raising a second one.
                */}
                {/*
                  An invoice out with the couple takes a payment of any size
                  up to its balance, and QuickBooks or Stripe is told too.
                  The whole-retainer form stays for an invoice not yet out
                  (still being created), which has no provider balance to
                  update.
                */}
                {invoicePaymentRefusal(invoice) === null ? (
                  <RecordInvoicePayment
                    invoice={invoice}
                    onDone={(message) => {
                      setNotice(message);
                      refreshTenantRecords(
                        "projects",
                        "invoiceReferences",
                        "checkpoints",
                        "readinessAssessments",
                      );
                      void load();
                    }}
                  />
                ) : packageSnapshot && Number(invoice.balanceCents ?? 0) > 0 ? (
                  <RecordRetainerPayment
                    paidInFull={paidInFull}
                    onRecorded={(message) => {
                      // The branch this control lives in unmounts as soon as
                      // the contract exists, taking any notice inside it with
                      // it — which is why recording a signature used to say
                      // nothing at all. The workspace keeps it.
                      setNotice(message);
                      // `load()` refreshes this workspace's own reads. The
                      // project badge, the readiness evidence and the records
                      // panels come from the shared tenant store, which is
                      // fetch-once — so recording a signature said "Signature
                      // recorded against your name" while the badge above it
                      // still read "Awaiting signature" and the evidence panel
                      // still read "No contracts yet", until a manual reload.
                      refreshTenantRecords(
                        "projects",
                        "contracts",
                        "invoiceReferences",
                        "checkpoints",
                        "readinessAssessments",
                      );
                      void load();
                      settleAfterRetainer();
                    }}
                    packageSnapshotId={String(packageSnapshot.id)}
                    projectId={projectId}
                    providerLabel={
                      typeof invoice.provider === "string" && invoice.provider
                        ? invoice.provider === "quickbooks"
                          ? "QuickBooks"
                          : invoice.provider.replaceAll("_", " ")
                        : "QuickBooks"
                    }
                    retainerLabel={currency(
                      invoice.amountCents,
                      invoice.currency,
                    )}
                    standingInvoice
                  />
                ) : null}
                {/* A wrong retainer is voided here and raised again below;
                    a payment recorded by mistake is corrected. Each shows
                    only where the server would allow it. */}
                <VoidInvoice
                  invoice={invoice}
                  onDone={(message) => {
                    setNotice(`${message} Raise the corrected ${depositWord} below.`);
                    void load();
                  }}
                />
                <CorrectPayment
                  invoice={invoice}
                  onDone={(message) => {
                    setNotice(message);
                    void load();
                  }}
                />
              </div>
            ) : automationAwaitingSignature ? (
              <div className="booking-complete-message">
                <LoaderCircle className="spin" size={18} />
                <span>
                  <strong>Waiting for verified signature</strong>
                  <small>
                    {`StudioCue will create this ${depositWord} automatically after ${signingProviderLabel} confirms completion.`}
                  </small>
                </span>
              </div>
            ) : (
              <div className="booking-action-form">
                {voidedRetainer ? (
                  <small>
                    {`The last ${depositWord} invoice (${currency(
                      voidedRetainer.amountCents,
                      voidedRetainer.currency,
                    )}) was voided${
                      typeof voidedRetainer.voidReason === "string" && voidedRetainer.voidReason
                        ? `: ${voidedRetainer.voidReason}`
                        : ""
                    }. Raise the replacement here.`}
                  </small>
                ) : null}
                <span>
                  <small>
                    {paidInFull
                      ? "Payment due"
                      : agreedRetainerDueDate
                        ? `${DepositWord} due, as the client agreed`
                        : `${DepositWord} due`}
                  </small>
                  <strong>{formatDueDate(dueDate)}</strong>
                </span>
                {/* Moved from the contract step, where it described a step
                    that had not started. */}
                {studioBilled ? (
                  <>
                    <small>
                      {`You're billing this job yourself, so nothing goes to QuickBooks. Send the invoice from here, then record the ${paidInFull ? "payment" : depositWord} below once it's paid.`}
                    </small>
                    <StudioDepositPanel
                      canCreate={projectState === "RETAINER_PENDING" && agreementSettled}
                      onDone={(message) => setNotice(message)}
                      projectId={projectId}
                    />
                  </>
                ) : (
                  <CapabilityNote capability="invoicing" />
                )}
                {studioBilled ? null : confirmingRetainer === "create" && projectState === "RETAINER_PENDING" && agreementSettled ? (
                  <ConfirmStep
                    busy={busy === "retainer"}
                    cancelLabel="Not now"
                    confirmLabel={`Send the ${currency(agreedRetainerCents, packageSnapshot?.currency)} invoice`}
                    label={paidInFull ? "Send the invoice?" : `Send the ${depositWord} invoice?`}
                    onCancel={() => setConfirmingRetainer(null)}
                    onConfirm={() => void createRetainer().then(() => setConfirmingRetainer(null))}
                  >
                    {`${invoicingName} raises a ${currency(agreedRetainerCents, packageSnapshot?.currency)} ${depositWord} invoice, due ${formatDueDate(dueDate)}, and ${recipient ?? "the couple"} is emailed it. Once it's out it can only be voided, not unsent.`}
                  </ConfirmStep>
                ) : (
                  <button
                    className="button"
                    disabled={
                      busy !== null ||
                      projectState !== "RETAINER_PENDING" ||
                      !agreementSettled
                    }
                    onClick={() => setConfirmingRetainer("create")}
                    type="button"
                  >
                    {`${paidInFull ? "Send the invoice" : `Create ${depositWord} invoice`} · ${currency(agreedRetainerCents, packageSnapshot?.currency)}`}
                    <ArrowRight size={15} />
                  </button>
                )}
                {!agreementSettled ? (
                  <small>
                    This unlocks once the signature is confirmed.
                  </small>
                ) : null}
                {/*
                  The way through when no invoicing provider is connected.
                  The button above refuses in that case rather than invoice
                  through an account nobody connected, which left the gate
                  short of both a created retainer and a paid one — a
                  studio taking bank transfers could not book at all.
                */}
                {agreementSettled && packageSnapshot ? (
                  <RecordRetainerPayment
                    paidInFull={paidInFull}
                    onRecorded={(message) => {
                      // The branch this control lives in unmounts as soon as
                      // the contract exists, taking any notice inside it with
                      // it — which is why recording a signature used to say
                      // nothing at all. The workspace keeps it.
                      setNotice(message);
                      // `load()` refreshes this workspace's own reads. The
                      // project badge, the readiness evidence and the records
                      // panels come from the shared tenant store, which is
                      // fetch-once — so recording a signature said "Signature
                      // recorded against your name" while the badge above it
                      // still read "Awaiting signature" and the evidence panel
                      // still read "No contracts yet", until a manual reload.
                      refreshTenantRecords(
                        "projects",
                        "contracts",
                        "invoiceReferences",
                        "checkpoints",
                        "readinessAssessments",
                      );
                      void load();
                      settleAfterRetainer();
                    }}
                    packageSnapshotId={String(packageSnapshot.id)}
                    projectId={projectId}
                    retainerLabel={currency(
                      agreedRetainerCents,
                      packageSnapshot.currency,
                    )}
                  />
                ) : null}
              </div>
            )}
            {!invoicePaid &&
            ["RETAINER_PENDING", "POSTPONED"].includes(String(project?.state)) ? (
              <BookWithoutRetainer
                onBooked={(message) => {
                  setNotice(message);
                  refreshTenantRecords(
                    "projects",
                    "invoiceReferences",
                    "checkpoints",
                    "readinessAssessments",
                  );
                  void load();
                }}
                projectId={projectId}
                projectVersion={Number(project?.stateVersion ?? 0)}
              />
            ) : null}
          </article>
        ) : null}
        {activeStep === 3 ? (
          <article
            className={
              bookingComplete ? "booking-step is-complete" : "booking-step"
            }
          >
            <span className="booking-step-number">
              {bookingComplete ? <Check size={17} /> : "3"}
            </span>
            <div className="booking-step-heading">
              <ShieldCheck aria-hidden="true" />
              <span>
                <small>The final check</small>
                <h2>
                  Confirm booking
                  <InfoHint term="booking-gate" />
                </h2>
              </span>
              <StatusBadge tone={bookingComplete ? "success" : "neutral"}>
                {bookingComplete ? "Booked" : "Waiting"}
              </StatusBadge>
            </div>
            <p>
              {kindNeeds.agreement || kindNeeds.payment
                ? `StudioCue confirms the booking once ${bookedOnceClause(kindProfile, tradeVocab(workspace.tenantTrade).deposit)}, and the date and client details check out.`
                : "StudioCue confirms the booking once the date and client details check out."}{" "}
              Nothing here can be talked into skipping a step.
            </p>
            {bookingComplete ? (
              <div className="booking-complete-message">
                <Check size={18} />
                <span>
                  <strong>
                    {bookedOn ? `Booked on ${formatEventDate(bookedOn)}` : "Booking is confirmed"}
                  </strong>
                  {/* "This takes a minute" was still shown months later
                      (UI audit, 2026-10-02): only while it is true. */}
                  <small>
                    {bookedRecently
                      ? "We’re setting up the client portal, the planning checklist, the calendar entry and the job folder — this takes a minute. Nothing else is needed from you."
                      : "The client portal, planning checklist, calendar entry and job folder were set up when it booked."}
                  </small>
                </span>
              </div>
            ) : automationHasOutstandingWork ? (
              <div className="booking-complete-message">
                <LoaderCircle className="spin" size={18} />
                <span>
                  <strong>Automatic confirmation is active</strong>
                  <small>
                    {`StudioCue will run the evidence check as soon as the connected provider reports the ${depositWord} paid.`}
                  </small>
                </span>
              </div>
            ) : (
              <>
                {/*
                  * The message and the control together.
                  *
                  * This branch used to render the notice *instead* of the
                  * button, while telling the studio to "run the booking review
                  * again" — the one thing the screen then gave them no way to
                  * do. A stopped plan is exactly when a person needs the
                  * control most.
                  */}
                {automationNeedsAttention ? (
                  <div className="booking-complete-message">
                    <CircleAlert size={18} />
                    <span>
                      <strong>Cue stopped safely</strong>
                      <small>
                        Resolve anything listed below, then run the booking
                        review again.
                      </small>
                    </span>
                  </div>
                ) : null}
                <button
                  className="button booking-gate-button"
                  disabled={busy !== null || projectState !== "RETAINER_PENDING"}
                  onClick={() => void reviewBooking()}
                  type="button"
                >
                  {busy === "gate" ? "Checking…" : "Check and confirm"}
                  <ShieldCheck size={16} />
                </button>
              </>
            )}
            {gateBlockers.length ? (
              <ul className="booking-blockers">
                {gateBlockers.map((blocker) => (
                  <li key={blocker}>
                    <CircleAlert size={14} />
                    {bookingBlockerLabel(blocker, workspace.tenantTrade)}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}
      </div>
      {project ? (
        <JobBillingChoice
          billing={jobBillingState}
          onChanged={(message) => {
            setNotice(message);
            refreshTenantRecords("projects", "billingSettings");
            void load();
          }}
          projectId={projectId}
        />
      ) : null}
      {project ? (
        <JobSalesTax
          exempt={project.salesTaxExempt === true}
          onChanged={(message) => {
            setNotice(message);
            refreshTenantRecords("projects");
            void load();
          }}
          projectId={projectId}
        />
      ) : null}
      {notice ? (
        <p className="booking-workspace-notice" role="status">
          {notice}
          {staleJob ? (
            <>
              {" "}
              <button
                className="button button-light button-sm"
                disabled={loading}
                onClick={() => {
                  setStaleJob(false);
                  setNotice(null);
                  refreshTenantRecords("projects", "contracts", "invoiceReferences");
                  void load();
                }}
                type="button"
              >
                Refresh
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

