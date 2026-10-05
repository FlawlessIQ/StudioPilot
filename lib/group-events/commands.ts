"use client";

import { runCrmCommand } from "@/lib/crm/command-client";
import type { ParticipantPaymentMethod } from "@/features/group-events/participants";

/**
 * The group-event commands (functions/src/crm/commands.ts), through
 * crmCommand. Each call carries one idempotency key across its retries.
 */

export type ParticipantInput = {
  parentName: string;
  email: string | null;
  phone: string | null;
  athleteName: string;
  team: string | null;
  packageName: string | null;
  amountCents: number;
  status: "unpaid" | "pay_on_day";
};

const once = () => ({ idempotencyKey: crypto.randomUUID() });

export function setGroupEvent(projectId: string, enabled: boolean) {
  return runCrmCommand("setGroupEvent", { projectId, enabled }, once());
}

export function addParticipant(projectId: string, input: ParticipantInput) {
  return runCrmCommand("addParticipant", { projectId, ...input }, once());
}

export function updateParticipant(projectId: string, participantId: string, input: ParticipantInput) {
  return runCrmCommand("updateParticipant", { projectId, participantId, ...input }, once());
}

export function cancelParticipant(projectId: string, participantId: string, restore = false) {
  return runCrmCommand("cancelParticipant", { projectId, participantId, restore }, once());
}

export function recordParticipantPayment(
  projectId: string,
  participantId: string,
  input: { amountCents: number; method: ParticipantPaymentMethod; sendReceipt: boolean },
) {
  return runCrmCommand("recordParticipantPayment", { projectId, participantId, ...input }, once());
}
