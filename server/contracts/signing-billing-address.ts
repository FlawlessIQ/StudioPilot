import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import type { BillingAddress } from "@/features/contacts/schema";
import {
  billingAddressRequirement,
  billingAddressStepFor,
  coupleBillingAddressProvenance,
  type BillingAddressRequirement,
  type SigningKind,
} from "@/features/contacts/billing-address-signing";
import { normaliseEmail } from "@/features/contracts/signing-policy";
import type { RequestEvidence, SignerIdentity } from "@/server/contracts/client-signing";

/**
 * The billing-address step of a couple's signature, server side.
 *
 * What is asked comes from the studio's records — billingSettings (sales tax
 * by QuickBooks), the QuickBooks connection, and the job's tax exemption —
 * never from the page. Where it is saved is the signer's own contact: one of
 * the job's client contacts whose email is the verified email they signed in
 * with. The browser sends an address and nothing else; no tenant, contact or
 * project id it sends decides whose record changes.
 *
 * Rules in features/contacts/billing-address-signing.ts.
 */

type Getter = (reference: DocumentReference) => Promise<DocumentSnapshot>;

export type SigningBillingAddressContext = {
  /** What the studio's settings ask of any signature. */
  requirement: BillingAddressRequirement;
  /** What this signature asks (a booking change skips it when one is on file). */
  step: BillingAddressRequirement;
  /** The signer's own address, as stored. */
  onFile: BillingAddress | null;
  /** The signer's own contact, or null when none of the job's contacts is them. */
  contact: DocumentReference | null;
};

/** A stored address worth showing, or null. */
export function storedBillingAddress(value: unknown): BillingAddress | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const str = (key: string) => (typeof record[key] === "string" ? String(record[key]).trim() : "");
  if (!str("line1") || !str("city")) return null;
  return {
    line1: str("line1"),
    line2: str("line2") || null,
    city: str("city"),
    region: str("region") || null,
    postalCode: str("postalCode") || null,
    country: (str("country") || "US").toUpperCase(),
  };
}

/**
 * Read everything the step needs. Inside a signing transaction pass
 * `transaction.get`, so these are reads before any write.
 */
export async function readSigningBillingAddress(
  db: Firestore,
  get: Getter,
  input: { tenantId: string; projectId: string; signerEmail: string | null; kind: SigningKind },
): Promise<SigningBillingAddressContext> {
  const [settings, connection, project] = await Promise.all([
    get(db.doc(`billingSettings/${input.tenantId}`)),
    get(db.doc(`integrationConnections/${input.tenantId}_quickbooks`)),
    get(db.doc(`projects/${input.projectId}`)),
  ]);
  const sameTenant = (snapshot: DocumentSnapshot) =>
    snapshot.exists && snapshot.get("tenantId") === input.tenantId;
  const projectValid = sameTenant(project);
  const quickBooksConnected =
    sameTenant(connection) && connection.get("status") === "connected" && !connection.get("archivedAt");
  // Another agent's billingSettings may not exist yet: a missing doc is "none".
  const salesTax = sameTenant(settings) ? (settings.get("salesTax") as Record<string, unknown> | undefined) : undefined;
  const requirement = billingAddressRequirement({
    salesTaxMode: salesTax?.mode ?? "none",
    salesTaxExempt: projectValid ? project.get("salesTaxExempt") : undefined,
    quickBooksConnected,
  });

  const email = normaliseEmail(input.signerEmail);
  const contactIds = projectValid && Array.isArray(project.get("clientContactIds"))
    ? (project.get("clientContactIds") as unknown[])
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .slice(0, 4)
    : [];
  const contacts = email ? await Promise.all(contactIds.map((id) => get(db.doc(`contacts/${id}`)))) : [];
  // Only the signer's own contact: the one on this job, in this studio, with
  // the email they signed in with — never a partner's or anyone else's.
  const own =
    contacts.find(
      (contact) =>
        sameTenant(contact) &&
        !contact.get("archivedAt") &&
        normaliseEmail(contact.get("normalizedEmail") ?? contact.get("email")) === email,
    ) ?? null;
  const onFile = own ? storedBillingAddress(own.get("billingAddress")) : null;
  return {
    requirement,
    step: billingAddressStepFor({ requirement, onFile, kind: input.kind }),
    onFile,
    contact: own?.ref ?? null,
  };
}

/**
 * Save the address the couple confirmed or typed, in the signing transaction.
 *
 * On their contact, marked as theirs (fieldProvenance.billingAddress), with
 * an audit event of its own. The signature records are untouched: the
 * address is not part of what was signed. With no contact of theirs on the
 * job, the audit event still keeps what they typed so the studio can add it.
 */
export function writeSigningBillingAddress(
  db: Firestore,
  transaction: Transaction,
  input: {
    context: SigningBillingAddressContext;
    address: BillingAddress | null;
    tenantId: string;
    projectId: string;
    via: "contract_signing" | "amendment_signing";
    recordId: string;
    auditId: string;
    now: string;
    signer: SignerIdentity;
    evidence: RequestEvidence;
  },
): boolean {
  if (!input.address) return false;
  const contact = input.context.contact;
  if (contact) {
    transaction.update(contact, {
      billingAddress: input.address,
      "fieldProvenance.billingAddress": coupleBillingAddressProvenance({
        at: input.now,
        via: input.via,
        recordId: input.recordId,
      }),
      updatedAt: input.now,
      updatedBy: input.signer.uid,
    });
  }
  transaction.create(db.doc(`auditEvents/${input.auditId}`), {
    id: input.auditId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    actorId: input.signer.uid,
    actorType: "client",
    action: "contact.billing_address_confirmed_by_client",
    entityType: "contact",
    entityId: contact?.id ?? null,
    timestamp: input.now,
    before: { billingAddress: input.context.onFile },
    after: {
      billingAddress: input.address,
      via: input.via,
      recordId: input.recordId,
      saved: Boolean(contact),
    },
    ipAddress: input.evidence.ipAddress,
    userAgent: input.evidence.userAgent,
    correlationId: input.auditId,
    automationRunId: null,
    providerEventId: null,
  });
  return Boolean(contact);
}

/** For the signing sheet: what to ask, and the signer's own address to prefill. */
export async function signingBillingAddressStep(
  db: Firestore,
  input: { tenantId: string; projectId: string; signerEmail: string | null; kind: SigningKind },
): Promise<{ step: BillingAddressRequirement; onFile: BillingAddress | null }> {
  const context = await readSigningBillingAddress(db, (reference) => reference.get(), input);
  return { step: context.step, onFile: context.step === "hidden" ? null : context.onFile };
}
