"use client";

import { connectStorageEmulator, getDownloadURL, getStorage, ref } from "firebase/storage";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import type { ContractCustomField } from "@/features/contracts/document";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";

/**
 * The studio's side of StudioCue contracts. Every call goes through
 * bookingCommand (functions/src/contracts/commands.ts), which does the
 * authority checks; nothing here decides anything.
 */

function key() {
  return crypto.randomUUID();
}

/**
 * sendBookingCommand already marks a persisted write; this makes it explicit
 * for the contract commands too, so a page that navigates after sending a
 * contract never renders the records it read before.
 */
async function persisted<T extends { mode: string }>(result: Promise<T>): Promise<T> {
  const value = await result;
  if (value.mode === "live") markTenantRecordsWritten();
  return value;
}

export type AgreementDraft = {
  templateId: string;
  name: string;
  title: string | null;
  body: string;
  customFields: ContractCustomField[];
  mapped: Array<{ placeholder: string; key: string }>;
  signatureLinesRemoved: number;
  detailsAdded: boolean;
  clausesRestored: number;
};

export async function agreementDraftFromImport(templateId: string) {
  const result = await sendBookingCommand({
    type: "agreementDraftFromImport",
    idempotencyKey: key(),
    input: { templateId },
  });
  return result.mode === "live" ? (result.payload as unknown as AgreementDraft) : null;
}

export async function saveAgreementTemplate(input: {
  templateId: string | null;
  name: string;
  title: string;
  body: string;
  customFields: ContractCustomField[];
  makeDefault: boolean;
}) {
  return persisted(sendBookingCommand({ type: "saveAgreementTemplate", idempotencyKey: key(), input }));
}

export async function prepareContract(input: {
  projectId: string;
  proposalId: string;
  overrides: Record<string, string>;
}) {
  return persisted(sendBookingCommand({ type: "prepareContract", idempotencyKey: key(), input }));
}

export async function sendContract(input: {
  projectId: string;
  documentHash: string;
  studioSignerName: string;
}) {
  return persisted(
    sendBookingCommand({
      type: "sendContract",
      idempotencyKey: key(),
      input: { ...input, consent: true },
    }),
  );
}

export async function voidContract(input: {
  projectId: string;
  contractId: string;
  reason: string;
}) {
  return persisted(sendBookingCommand({ type: "voidContract", idempotencyKey: key(), input }));
}

export async function setContractAutoSend(input: {
  enabled: boolean;
  signerName: string | null;
  consent: boolean;
}) {
  return persisted(sendBookingCommand({ type: "setContractAutoSend", idempotencyKey: key(), input }));
}

let emulatorConnected = false;

/** A link to a sealed contract, read through the Storage rules as whoever is signed in. */
export async function signedCopyUrl(path: string): Promise<string> {
  const client = getFirebaseClient();
  const storage = getStorage(client.app);
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && !emulatorConnected) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    emulatorConnected = true;
  }
  return getDownloadURL(ref(storage, path));
}
