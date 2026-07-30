"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
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

type RecordValue = Record<string, unknown> & { id: string };

function nestedString(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : "";
}

function friendlyError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "This action could not be completed.";
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
  return known[message] ?? message.replaceAll("_", " ");
}

function currency(cents: unknown, code: unknown): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: typeof code === "string" ? code : "USD",
  }).format(Number(cents ?? 0) / 100);
}

export function ProjectBookingWorkspace({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const [project, setProject] = useState<RecordValue | null>(null);
  const [proposal, setProposal] = useState<RecordValue | null>(null);
  const [contract, setContract] = useState<RecordValue | null>(null);
  const [invoice, setInvoice] = useState<RecordValue | null>(null);
  const [packageSnapshot, setPackageSnapshot] = useState<RecordValue | null>(null);
  const [contact, setContact] = useState<RecordValue | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gateBlockers, setGateBlockers] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!workspace.tenantId) return;
    setLoading(true);
    const { firestore } = getFirebaseClient();
    try {
      const projectSnapshot = await getDoc(doc(firestore, "projects", projectId));
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
      const [proposals, contracts, invoices, tenant, connections] =
        await Promise.all([
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
        ]);
      const proposalValue =
        proposals.docs
          .map(
            (item): RecordValue => ({ id: item.id, ...item.data() }),
          )
          .sort(
            (left, right) =>
              Number(right.version ?? 0) - Number(left.version ?? 0),
          )
          .find((item) => item.status === "accepted") ?? null;
      const contractValue =
        contracts.docs
          .map(
            (item): RecordValue => ({ id: item.id, ...item.data() }),
          )
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(
              String(left.createdAt ?? ""),
            ),
          )[0] ?? null;
      const invoiceValue =
        invoices.docs
          .map(
            (item): RecordValue => ({ id: item.id, ...item.data() }),
          )
          .filter((item) => item.kind === "retainer")
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(
              String(left.createdAt ?? ""),
            ),
          )[0] ?? null;
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
      const docusign = connections.docs.find(
        (item) => item.get("provider") === "docusign",
      );
      const configuredTemplate =
        nestedString(tenant.data()?.defaultContractSettings, "templateId") ||
        String(docusign?.get("selectedResourceId") ?? "");
      setProject(projectValue);
      setProposal(proposalValue);
      setContract(contractValue);
      setInvoice(invoiceValue);
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

  async function createContract() {
    if (!project || !proposal || !contact || !templateId.trim()) {
      setNotice("Choose a Docusign template and confirm the client contact first.");
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
      setNotice("Contract queued for Docusign delivery.");
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
      setNotice("QuickBooks customer matching and retainer creation are queued.");
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

  if (loading) {
    return (
      <section className="panel booking-workspace-loading">
        <LoaderCircle className="spin" />
        <span>
          <strong>Loading booking evidence…</strong>
          <small>Checking proposal, Docusign, and QuickBooks records.</small>
        </span>
      </section>
    );
  }

  return (
    <section className="booking-workspace">
      <div className="booking-steps" aria-label="Booking workflow">
        <article
          className={contractComplete ? "booking-step is-complete" : "booking-step"}
        >
          <span className="booking-step-number">
            {contractComplete ? <Check size={17} /> : "1"}
          </span>
          <div className="booking-step-heading">
            <FileSignature aria-hidden="true" />
            <span><small>Agreement</small><h2>Contract</h2></span>
            <StatusBadge
              tone={contractComplete ? "success" : contract ? "info" : "neutral"}
            >
              {contract
                ? String(contract.status).replaceAll("_", " ")
                : "Not created"}
            </StatusBadge>
          </div>
          <p>
            The accepted proposal supplies the exact package and price. Docusign
            remains the authority for signature completion.
          </p>
          <aside className="booking-provider-migration">
            <strong>Coming from Dropbox Sign?</strong>
            <small>
              Import the current agreement once. StudioCue preserves its
              wording and signer fields, then maps the approved version to a
              Docusign template so you never place fields again.
            </small>
          </aside>
          {contract ? (
            <div className="booking-evidence">
              <span><small>Envelope</small><strong>{String(contract.providerEnvelopeId ?? "Creating…")}</strong></span>
              <span><small>Sent</small><strong>{contract.sentAt ? new Date(String(contract.sentAt)).toLocaleDateString() : "Queued"}</strong></span>
            </div>
          ) : (
            <div className="booking-action-form">
              <label>
                Docusign template ID
                <input
                  onChange={(event) => setTemplateId(event.target.value)}
                  placeholder="Approved agreement template"
                  value={templateId}
                />
              </label>
              <button
                className="button"
                disabled={
                  busy !== null || !proposal || projectState !== "CONTRACT_PENDING"
                }
                onClick={() => void createContract()}
                type="button"
              >
                {busy === "contract" ? "Preparing…" : "Send contract"}
                <ArrowRight size={15} />
              </button>
              {!proposal ? <small>The client’s accepted proposal is required first.</small> : null}
            </div>
          )}
        </article>

        <article className={invoicePaid ? "booking-step is-complete" : "booking-step"}>
          <span className="booking-step-number">
            {invoicePaid ? <Check size={17} /> : "2"}
          </span>
          <div className="booking-step-heading">
            <ReceiptText aria-hidden="true" />
            <span><small>Payment</small><h2>Retainer</h2></span>
            <StatusBadge tone={invoicePaid ? "success" : invoice ? "warning" : "neutral"}>
              {invoice ? String(invoice.status).replaceAll("_", " ") : "Not created"}
            </StatusBadge>
          </div>
          <p>
            StudioCue matches or creates the QuickBooks customer, then tracks
            the provider-hosted invoice without handling card details.
          </p>
          {invoice ? (
            <div className="booking-evidence">
              <span><small>Amount</small><strong>{currency(invoice.amountCents, invoice.currency)}</strong></span>
              <span><small>Balance</small><strong>{currency(invoice.balanceCents, invoice.currency)}</strong></span>
              {typeof invoice.hostedUrl === "string" && invoice.hostedUrl ? (
                <Link href={invoice.hostedUrl} rel="noreferrer" target="_blank">
                  Open QuickBooks invoice <ArrowRight size={13} />
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="booking-action-form">
              <span><small>Retainer due</small><strong>{dueDate}</strong></span>
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
                {busy === "retainer" ? "Creating…" : "Create retainer invoice"}
                <ArrowRight size={15} />
              </button>
              {!contractComplete ? <small>Docusign completion unlocks this step.</small> : null}
            </div>
          )}
        </article>

        <article
          className={bookingComplete ? "booking-step is-complete" : "booking-step"}
        >
          <span className="booking-step-number">
            {bookingComplete ? <Check size={17} /> : "3"}
          </span>
          <div className="booking-step-heading">
            <ShieldCheck aria-hidden="true" />
            <span><small>Deterministic gate</small><h2>Confirm booking</h2></span>
            <StatusBadge tone={bookingComplete ? "success" : "neutral"}>
              {bookingComplete ? "Booked" : "Waiting"}
            </StatusBadge>
          </div>
          <p>
            The server verifies the signature, invoice, cleared balance, event
            date, and required client details. The browser and AI cannot override
            these checks.
          </p>
          {bookingComplete ? (
            <div className="booking-complete-message">
              <Check size={18} />
              <span>
                <strong>Booking is confirmed</strong>
                <small>Portal, workflow, calendar, and project folders are being prepared.</small>
              </span>
            </div>
          ) : (
            <button
              className="button booking-gate-button"
              disabled={busy !== null || projectState !== "RETAINER_PENDING"}
              onClick={() => void reviewBooking()}
              type="button"
            >
              {busy === "gate" ? "Checking evidence…" : "Run booking review"}
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
      </div>
      {notice ? (
        <p className="booking-workspace-notice" role="status">{notice}</p>
      ) : null}
    </section>
  );
}
