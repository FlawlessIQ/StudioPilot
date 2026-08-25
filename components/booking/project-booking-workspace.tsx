"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CapabilityNote } from "@/components/integrations/capability-note";
import { RecordSignedAgreement } from "@/components/booking/record-signed-agreement";
import Link from "next/link";
import {
  ArrowRight,
  Check,
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
import { bookingAutomationDrivesContract } from "@/features/booking/orchestration";
import { friendlyError as friendlySharedError } from "@/lib/ai/friendly-error";
import { formatDueDate } from "@/lib/format/event-date";
import { providerName } from "@/lib/format/provider-name";
import {
  PanelError,
  PanelLoading,
  useWorkspaceGate,
} from "@/components/ui/panel-state";
import { statusLabel } from "@/features/format/status-label";

type RecordValue = Record<string, unknown> & { id: string };

function nestedString(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : "";
}

function friendlyError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "This action could not be completed.";
  const known: Record<string, string> = {
    CONTRACT_NOT_READY:
      "The accepted proposal must be ready before a contract can be sent.",
    ACCEPTED_PROPOSAL_REQUIRED:
      "The client must accept the current proposal first.",
    CONTRACT_ALREADY_EXISTS:
      "A contract already exists for this accepted proposal.",
    RETAINER_NOT_READY:
      "The completed contract must be confirmed before creating the retainer.",
    RETAINER_INVOICE_ALREADY_EXISTS:
      "A retainer invoice already exists for this project.",
    PROJECT_VERSION_CONFLICT:
      "The project changed. Refresh and run the booking review again.",
  };
  // Domain codes win; anything else goes through the shared helper so raw
  // infrastructure text ("Firebase client configuration is incomplete: …")
  // never reaches the notice.
  return (
    known[message] ??
    friendlySharedError(error, "This action could not be completed.")
  );
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
  const [project, setProject] = useState<RecordValue | null>(null);
  const [proposal, setProposal] = useState<RecordValue | null>(null);
  const [contract, setContract] = useState<RecordValue | null>(null);
  const [invoice, setInvoice] = useState<RecordValue | null>(null);
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
  const [signingProvider, setSigningProvider] = useState<
    "docusign" | "dropbox_sign"
  >("docusign");
  const [signingTestMode, setSigningTestMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gateBlockers, setGateBlockers] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!workspace.tenantId) return;
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
      const proposalValue =
        proposals.docs
          .map((item): RecordValue => ({ id: item.id, ...item.data() }))
          .sort(
            (left, right) =>
              Number(right.version ?? 0) - Number(left.version ?? 0),
          )
          .find((item) => item.status === "accepted") ?? null;
      const contractValue =
        contracts.docs
          .map((item): RecordValue => ({ id: item.id, ...item.data() }))
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(
              String(left.createdAt ?? ""),
            ),
          )[0] ?? null;
      const invoiceValue =
        invoices.docs
          .map((item): RecordValue => ({ id: item.id, ...item.data() }))
          .filter((item) => item.kind === "retainer")
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(
              String(left.createdAt ?? ""),
            ),
          )[0] ?? null;
      const unpaid = invoices.docs
        .map((item): RecordValue => ({ id: item.id, ...item.data() }))
        .filter(
          (item) =>
            Number(item.balanceCents ?? 0) > 0 &&
            !["paid", "voided", "refunded"].includes(String(item.status)),
        );
      const todayIso = new Date().toISOString().slice(0, 10);
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
      const resolvedSigningProvider =
        signingResolution.outcome === "resolved" &&
        ["docusign", "dropbox_sign"].includes(signingResolution.provider)
          ? (signingResolution.provider as "docusign" | "dropbox_sign")
          : "docusign";
      const signingConnection = connections.docs.find(
        (item) => item.get("provider") === resolvedSigningProvider,
      );
      const configuredTemplate =
        nestedString(tenant.data()?.defaultContractSettings, "templateId") ||
        String(signingConnection?.get("selectedResourceId") ?? "");
      setProject(projectValue);
      setProposal(proposalValue);
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
    } catch (error: unknown) {
      setNotice(friendlyError(error));
    } finally {
      setLoading(false);
    }
  }, [projectId, workspace.tenantId]);

  useEffect(() => {
    if (!workspace.loading && workspace.tenantId) {
      void Promise.resolve().then(load);
    }
  }, [load, workspace.loading, workspace.tenantId]);

  const projectState = String(project?.state ?? "");
  const contractComplete = contract?.status === "completed";
  const contractFailed = contract?.status === "failed";
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
  const dueDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().slice(0, 10);
  }, []);
  const signingProviderLabel =
    signingProvider === "dropbox_sign" ? "Dropbox Sign" : "Docusign";
  const automationActive =
    orchestration?.status === "active" || orchestration?.status === "completed";
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

  /**
   * Which of the three steps is actually live.
   *
   * Each one is gated on the one before it — the retainer cannot be raised
   * until a signature is verified, and the booking cannot be confirmed until
   * the retainer clears — so at most one of them is ever actionable. The
   * page now shows that one.
   */
  const activeStep = !contractComplete ? 1 : !invoicePaid ? 2 : 3;
  const stepState = (step: number) =>
    step < activeStep ? "done" : step === activeStep ? "current" : "waiting";
  const steps = [
    {
      number: 1,
      title: "Contract",
      state: bookingComplete ? "done" : stepState(1),
      note: contractComplete
        ? "Signed"
        : contract
          ? statusLabel(String(contract.status))
          : "Not sent",
    },
    {
      number: 2,
      title: "Retainer",
      state: bookingComplete ? "done" : stepState(2),
      // "Waits for the signature" is only true while it is waiting. Once
      // this becomes the live step that sentence describes the past and
      // reads as though the step is still blocked.
      note: invoicePaid
        ? "Paid"
        : invoice
          ? statusLabel(String(invoice.status))
          : contractComplete
            ? "Ready to raise"
            : "Waits for the signature",
    },
    {
      number: 3,
      title: "Booking",
      state: bookingComplete ? "done" : stepState(3),
      note: bookingComplete
        ? "Confirmed"
        : invoicePaid
          ? "Ready to confirm"
          : "Waits for the retainer",
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
        `Booking sequence approved. The contract is queued through ${signingProviderLabel}; StudioCue will prepare the retainer after signature and confirm the booking after payment.`,
      );
      await load();
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
        "QuickBooks customer matching and retainer creation are queued.",
      );
      await load();
    } catch (error: unknown) {
      setNotice(friendlyError(error));
    } finally {
      setBusy(null);
    }
  }

  async function reviewBooking() {
    if (!project) return;
    setBusy("gate");
    setNotice(null);
    try {
      const response = await sendBookingCommand({
        type: "runBookingGate",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          expectedProjectVersion: Number(project.stateVersion ?? 0),
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
          ? "Booking confirmed. The project setup jobs are now running."
          : "Booking is still waiting on the requirements shown below.",
      );
      await load();
    } catch (error: unknown) {
      setNotice(friendlyError(error));
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
        detail="Checking proposal, signing, and QuickBooks records."
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
              {currency(outstanding.cents, invoice?.currency)} still owed
            </strong>
            <small>
              {outstanding.overdue
                ? `Overdue since ${formatDueDate(outstanding.dueDate)}`
                : outstanding.dueDate
                  ? `Due ${formatDueDate(outstanding.dueDate)}`
                  : "No due date set"}
            </small>
          </span>
          <Link className="button button-dark" href="/studio/invoices">
            Chase payment <ArrowRight size={15} />
          </Link>
        </aside>
      ) : null}
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
                <small>The agreement</small>
                <h2>Contract</h2>
              </span>
              <StatusBadge
                tone={
                  contractComplete ? "success" : contract ? "info" : "neutral"
                }
              >
                {contract ? statusLabel(contract.status) : "Not created"}
              </StatusBadge>
            </div>
            <p>
              The accepted proposal supplies the exact package and price.{" "}
              {signingProviderLabel} remains the authority for signature
              completion.
            </p>
            {contractFailed ? (
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
                      )}
                    </small>
                  </span>
                </p>
                <button
                  className="button"
                  disabled={busy !== null}
                  onClick={() => void createContract()}
                  type="button"
                >
                  {busy === "contract" ? "Sending…" : "Try again"}
                  <ArrowRight size={15} />
                </button>
                {proposal ? (
                  <RecordSignedAgreement
                    onRecorded={() => void load()}
                    projectId={projectId}
                    proposalId={String(proposal.id)}
                  />
                ) : null}
              </div>
            ) : contract ? (
              <div className="booking-evidence">
                {/* The provider's envelope id is an internal reference, not a
                    number the couple would ever quote. Who signed it and when
                    is what the studio actually needs to see. */}
                <span>
                  <small>Signed with</small>
                  <strong>
                    {providerName(
                      String(contract.provider ?? "the signing provider"),
                    )}
                  </strong>
                </span>
                <span>
                  <small>Sent</small>
                  <strong>
                    {contract.sentAt
                      ? formatDueDate(String(contract.sentAt))
                      : "Queued"}
                  </strong>
                </span>
              </div>
            ) : (
              <div className="booking-action-form">
                {templateConfigured ? (
                  // Provider internals stay out of the flow: a configured
                  // template needs no raw ID pasted mid-booking.
                  <details className="booking-template-configured">
                    <summary>
                      Using your approved {signingProviderLabel} agreement
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
                        Or paste a {signingProviderLabel} template ID
                      </summary>
                      <label>
                        {signingProviderLabel} template ID
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
                {!proposal ? (
                  <small>
                    The client’s accepted proposal is required first.
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
                <CapabilityNote capability="signing" />
                <CapabilityNote capability="invoicing" />
                {proposal ? (
                  <RecordSignedAgreement
                    onRecorded={() => void load()}
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
            {!contract ? (
              <aside className="booking-provider-migration">
                <strong>One approval completes the routine booking work</strong>
                <small>
                  Approve this sequence once. StudioCue will wait for verified
                  signature evidence, create the retainer, wait for provider
                  payment evidence, and finish project setup. It stops if an
                  exception needs you.
                </small>
              </aside>
            ) : null}
            <aside className="booking-provider-migration">
              <strong>Your approved agreement stays reusable</strong>
              <small>
                Import the current agreement once. StudioCue preserves its
                wording and signer fields, then reuses the approved{" "}
                {signingProviderLabel} template so you do not place fields for
                every client.
              </small>
            </aside>
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
                <small>The deposit</small>
                <h2>Retainer</h2>
              </span>
              <StatusBadge
                tone={invoicePaid ? "success" : invoice ? "warning" : "neutral"}
              >
                {invoice ? statusLabel(invoice.status) : "Not created"}
              </StatusBadge>
            </div>
            <p>
              StudioCue matches or creates the QuickBooks customer, then tracks
              the provider-hosted invoice without handling card details.
            </p>
            {invoice ? (
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
                {typeof invoice.hostedUrl === "string" && invoice.hostedUrl ? (
                  <Link
                    href={invoice.hostedUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open QuickBooks invoice <ArrowRight size={13} />
                  </Link>
                ) : null}
              </div>
            ) : automationAwaitingSignature ? (
              <div className="booking-complete-message">
                <LoaderCircle className="spin" size={18} />
                <span>
                  <strong>Waiting for verified signature</strong>
                  <small>
                    StudioCue will create this retainer automatically after{" "}
                    {signingProviderLabel} confirms completion.
                  </small>
                </span>
              </div>
            ) : (
              <div className="booking-action-form">
                <span>
                  <small>Retainer due</small>
                  <strong>{dueDate}</strong>
                </span>
                <button
                  className="button"
                  disabled={
                    busy !== null ||
                    projectState !== "RETAINER_PENDING" ||
                    !contractComplete
                  }
                  onClick={() => void createRetainer()}
                  type="button"
                >
                  {busy === "retainer"
                    ? "Creating…"
                    : "Create retainer invoice"}
                  <ArrowRight size={15} />
                </button>
                {!contractComplete ? (
                  <small>
                    {signingProviderLabel} completion unlocks this step.
                  </small>
                ) : null}
              </div>
            )}
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
                <h2>Confirm booking</h2>
              </span>
              <StatusBadge tone={bookingComplete ? "success" : "neutral"}>
                {bookingComplete ? "Booked" : "Waiting"}
              </StatusBadge>
            </div>
            <p>
              StudioCue confirms the booking once the agreement is signed, the
              retainer has cleared, and the date and client details check out.
              Nothing here can be talked into skipping a step.
            </p>
            {bookingComplete ? (
              <div className="booking-complete-message">
                <Check size={18} />
                <span>
                  <strong>Booking is confirmed</strong>
                  <small>
                    Portal, workflow, calendar, and project folders are being
                    prepared.
                  </small>
                </span>
              </div>
            ) : automationDriving ? (
              <div className="booking-complete-message">
                <LoaderCircle className="spin" size={18} />
                <span>
                  <strong>Automatic confirmation is active</strong>
                  <small>
                    StudioCue will run the evidence check as soon as the
                    connected provider reports the retainer paid.
                  </small>
                </span>
              </div>
            ) : automationNeedsAttention ? (
              <div className="booking-complete-message">
                <CircleAlert size={18} />
                <span>
                  <strong>StudioCue stopped safely</strong>
                  <small>
                    Resolve the exception shown in your next actions, then run
                    the booking review again.
                  </small>
                </span>
              </div>
            ) : (
              <button
                className="button booking-gate-button"
                disabled={busy !== null || projectState !== "RETAINER_PENDING"}
                onClick={() => void reviewBooking()}
                type="button"
              >
                {busy === "gate" ? "Checking…" : "Check and confirm"}
                <ShieldCheck size={16} />
              </button>
            )}
            {gateBlockers.length ? (
              <ul className="booking-blockers">
                {gateBlockers.map((blocker) => (
                  <li key={blocker}>
                    <CircleAlert size={14} />
                    {blocker.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}
      </div>
      {notice ? (
        <p className="booking-workspace-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A provider's error, in words a photographer can act on.
 *
 * `DROPBOX_SIGN_CREATE_FAILED:402:PROVIDER_ERROR` is precise and useless to
 * the person reading it. The status is the part that says what to do.
 */
function providerFailureHint(message: string, provider: string): string {
  const status = Number(message.split(":")[1] ?? 0);
  if (status === 402)
    return `${provider} needs a paid API plan to send agreements. Upgrade it, or turn on test mode in Integrations to try the booking without one.`;
  if (status === 401 || status === 403)
    return `${provider} rejected the connection. Reconnect it in Integrations and try again.`;
  if (status === 400)
    return `${provider} rejected the request — usually the agreement template's signer role does not match. Check the template, then try again.`;
  if (status === 429)
    return `${provider} is rate limiting. Wait a moment and try again.`;
  return `${provider} could not create the request. Check the connection in Integrations, then try again.`;
}
