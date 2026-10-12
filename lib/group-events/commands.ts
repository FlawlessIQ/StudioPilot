"use client";

import { runCrmCommand } from "@/lib/crm/command-client";
import type { ParticipantPaymentMethod } from "@/features/group-events/participants";
import type { EventSignupSettings } from "@/features/group-events/signup";

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
  /** The time booked on a mini-session day; left out, it stays as it was. */
  slot?: string | null;
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

/** The event's packages, payment methods and sign-up switch (features/group-events/signup.ts). */
export function setGroupEventSignup(projectId: string, settings: EventSignupSettings) {
  return runCrmCommand("setGroupEventSignup", { projectId, settings }, once());
}

/** A new sign-up link; the old link and its QR code stop working. */
export function resetGroupEventLink(projectId: string) {
  return runCrmCommand("resetGroupEventLink", { projectId }, once());
}

/** One email per parent with the sign-up link; a parent already sent this link is skipped. */
export function inviteGroupEventParents(projectId: string, emails: string[]) {
  return runCrmCommand("inviteGroupEventParents", { projectId, emails }, once());
}

/** A QuickBooks invoice for everyone still owing who isn't paying on the day. */
export function sendParticipantInvoices(projectId: string) {
  return runCrmCommand("sendParticipantInvoices", { projectId }, once());
}

/** A QuickBooks invoice for one parent, or another after one failed or was withdrawn. */
export function sendParticipantInvoice(projectId: string, participantId: string) {
  return runCrmCommand("sendParticipantInvoice", { projectId, participantId }, once());
}

/** Each place's own link after the day; a null link takes one off (group-events/delivery.ts). */
export function attachParticipantDeliveries(projectId: string, links: { participantId: string; url: string | null }[]) {
  return runCrmCommand("attachParticipantDeliveries", { projectId, links }, once());
}

/**
 * Send each place their link: everyone ready (`participantIds` null), or one
 * place — and only one place may be sent theirs while they still owe.
 */
export function releaseParticipantDeliveries(projectId: string, participantIds: string[] | null, allowUnpaid = false) {
  return runCrmCommand("releaseParticipantDeliveries", { projectId, participantIds, allowUnpaid }, once());
}
