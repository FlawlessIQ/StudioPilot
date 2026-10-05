import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { writeContractVoid } from "../contracts/void-writes.js";
import { stoppedBillingTask } from "./stopped-billing.js";

/**
 * What cancelling a job does to an agreement the couple has not signed.
 *
 * Found in the go-back audit of 2026-09-30: cancelling left a StudioCue
 * agreement `sent`, so the couple could still open their portal and sign a
 * booking for a wedding that was off — and the signature would have driven
 * the booking plan. Stopped billing (stopped-billing.ts) closed the money;
 * nothing closed the paper.
 *
 * A StudioCue agreement out for signature is withdrawn in the cancel's own
 * transaction. One out through a signing app cannot be withdrawn from here,
 * so it becomes a task, the same way an invoice at the provider does. A signed
 * agreement is never touched: it is the record of what two parties agreed.
 */

/** Out with the couple: sent to them and not yet finished or withdrawn. */
export const AGREEMENT_OUT_STATUSES = ["queued", "sent", "delivered", "viewed", "partially_signed", "completed"];

type ContractLike = { id: string; status: unknown; provider: unknown };

const isStudioCue = (contract: ContractLike) =>
  contract.provider === "studiocue" || contract.provider == null || contract.provider === "";

/** Pure. Which agreements a cancel withdraws, and which need a person. */
export function planStoppedAgreements(contracts: readonly ContractLike[]): {
  voidIds: string[];
  outsideIds: string[];
} {
  const unsigned = contracts.filter(
    (contract) =>
      AGREEMENT_OUT_STATUSES.includes(String(contract.status)) && String(contract.status) !== "completed",
  );
  return {
    voidIds: unsigned
      .filter((contract) => contract.provider === "studiocue" && ["sent", "viewed"].includes(String(contract.status)))
      .map((contract) => contract.id),
    outsideIds: unsigned.filter((contract) => !isStudioCue(contract)).map((contract) => contract.id),
  };
}

/**
 * Pure. Why a job at CONTRACT_PENDING can't be moved back to PROPOSAL by hand,
 * or null. Moving it back with the agreement still out left the agreement
 * signable, and the revise that the move was for then refused with
 * AGREEMENT_ALREADY_SENT — the job was stuck between the two.
 */
export function agreementOutRefusal(contracts: readonly ContractLike[]): "signed" | "provider" | "studiocue" | null {
  const out = contracts.filter((contract) => AGREEMENT_OUT_STATUSES.includes(String(contract.status)));
  if (!out.length) return null;
  if (out.some((contract) => contract.status === "completed")) return "signed";
  if (out.some((contract) => !isStudioCue(contract))) return "provider";
  return "studiocue";
}

function providerName(provider: unknown): string {
  return provider === "docusign" ? "DocuSign" : provider === "dropbox_sign" ? "Dropbox Sign" : "your signing app";
}

/** Withdraw what can be withdrawn; task the rest. In the caller's transaction. */
export function writeStoppedAgreements(
  db: Firestore,
  transaction: Transaction,
  input: {
    contracts: readonly DocumentSnapshot[];
    tenantId: string;
    projectId: string;
    now: string;
    actor: string;
    correlationId: string;
  },
): { voidedContractIds: string[]; cancelTaskIds: string[] } {
  const plan = planStoppedAgreements(
    input.contracts.map((contract) => ({
      id: contract.id,
      status: contract.get("status"),
      provider: contract.get("provider"),
    })),
  );
  for (const contract of input.contracts) {
    if (!plan.voidIds.includes(contract.id)) continue;
    // No "agreement withdrawn — a new one is on its way" email: the wedding is
    // off, and whether the couple hears so is the studio's choice on the
    // cancel form.
    writeContractVoid(db, transaction, contract, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      reason: "The job was canceled.",
      actorId: input.actor,
      actorType: "user",
      timestamp: input.now,
      correlationId: input.correlationId,
      auditId: `audit_contract_voided_on_cancel_${contract.id}`,
    });
  }
  const cancelTaskIds: string[] = [];
  for (const contract of input.contracts) {
    if (!plan.outsideIds.includes(contract.id)) continue;
    const provider = providerName(contract.get("provider"));
    const task = stoppedBillingTask({
      id: `agreement_cancel_${contract.id}`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      title: `Cancel the agreement in ${provider}`,
      description: `The job was canceled while its agreement was still out for signature in ${provider}. StudioCue can't withdraw it there — cancel it in ${provider} so the couple can't sign it.`,
      now: input.now,
      actor: input.actor,
    });
    transaction.set(db.doc(`tasks/${task.id}`), task);
    cancelTaskIds.push(task.id);
  }
  return { voidedContractIds: plan.voidIds, cancelTaskIds };
}
