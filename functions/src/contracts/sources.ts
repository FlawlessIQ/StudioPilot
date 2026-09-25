import type { Firestore } from "firebase-admin/firestore";
import { describeCoverage, resolveCoverage } from "../packages/coverage.js";
import {
  importedAgreementText,
  type ContractCustomField,
  type ContractSources,
  type ContractTemplateInput,
} from "./document.js";

/**
 * Everything a StudioCue contract is resolved from, read from records.
 *
 * The accepted proposal is the authority for money, dates and the event: it is
 * the version the couple said yes to, and its snapshots are immutable. Nothing
 * here is taken from the request — a studio's typed values arrive separately,
 * as overrides the resolver only accepts for fields the records cannot answer.
 */

type Data = Record<string, unknown>;

const record = (value: unknown): Data =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const cents = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

function hoursPhrase(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** "Emma Hart & James Cole", from the project's client contacts when both exist. */
export function coupleNames(contacts: Data[], fallback: string): string {
  const names = contacts
    .map((contact) =>
      text(contact.displayName) ||
      [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(" "),
    )
    .filter(Boolean);
  if (names.length === 0) return fallback;
  // One contact is usually the couple filed as one person ("Priya & Jordan").
  // The accepted proposal's name is what they agreed to, and fuller.
  if (names.length === 1) return fallback || names[0]!;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export async function loadContractSources(
  db: Firestore,
  input: { tenantId: string; projectId: string; proposalId: string; today: string },
): Promise<{ sources: ContractSources; clientEmail: string; clientName: string }> {
  const [proposal, project, tenant] = await Promise.all([
    db.doc(`proposals/${input.proposalId}`).get(),
    db.doc(`projects/${input.projectId}`).get(),
    db.doc(`tenants/${input.tenantId}`).get(),
  ]);
  if (
    !proposal.exists ||
    proposal.get("tenantId") !== input.tenantId ||
    proposal.get("projectId") !== input.projectId
  )
    throw new Error("PROPOSAL_NOT_FOUND");
  if (!project.exists || project.get("tenantId") !== input.tenantId)
    throw new Error("PROJECT_NOT_FOUND");
  const snapshotId = text(proposal.get("packageSnapshotId"));
  const snapshot = snapshotId
    ? await db.doc(`packageSnapshots/${snapshotId}`).get()
    : null;
  const snapshotData =
    snapshot?.exists && snapshot.get("tenantId") === input.tenantId
      ? (snapshot.data() ?? {})
      : {};
  const clientContactIds = Array.isArray(project.get("clientContactIds"))
    ? (project.get("clientContactIds") as unknown[]).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ).slice(0, 2)
    : [];
  const contacts = (
    await Promise.all(clientContactIds.map((id) => db.doc(`contacts/${id}`).get()))
  )
    .filter((contact) => contact.exists && contact.get("tenantId") === input.tenantId)
    .map((contact) => contact.data() ?? {});

  const client = record(proposal.get("clientSnapshot"));
  const event = record(proposal.get("eventSnapshot"));
  const pricing = record(proposal.get("pricingSnapshot"));
  const schedule = Array.isArray(proposal.get("paymentSchedule"))
    ? (proposal.get("paymentSchedule") as unknown[]).map(record)
    : [];
  const clientName = text(client.displayName);
  const clientEmail = text(client.email).toLowerCase();
  const coverageRoles = describeCoverage(resolveCoverage(snapshotData));
  const hours = hoursPhrase(Number(snapshotData.includedCoverageMinutes));
  const coverage = [coverageRoles, hours].filter(Boolean).join(", ");
  const deliverables = Array.isArray(snapshotData.includedDeliverables)
    ? (snapshotData.includedDeliverables as unknown[]).map(text).filter(Boolean)
    : [];

  return {
    clientEmail,
    clientName,
    sources: {
      client: { names: coupleNames(contacts, clientName), email: clientEmail },
      event: {
        name: text(event.name) || text(project.get("name")),
        type: text(event.eventType) || text(project.get("eventType")),
        date: text(event.eventDate) || text(project.get("eventDate")).slice(0, 10),
        venue: text(event.venue) || text(project.get("venueName")) || null,
      },
      package: {
        name: text(pricing.packageName) || text(snapshotData.packageName),
        coverage: coverage || null,
        deliverables,
      },
      pricing: {
        currency: text(pricing.currency) || text(tenant.get("currency")) || "USD",
        totalCents: cents(pricing.totalCents),
        retainerCents: cents(pricing.retainerCents),
      },
      paymentSchedule: schedule.map((row) => ({
        label: text(row.label) || "Payment",
        amountCents: cents(row.amountCents),
        dueDate: text(row.dueDate).slice(0, 10) || null,
      })),
      studio: {
        name:
          text(tenant.get("brandName")) ||
          text(tenant.get("businessName")) ||
          text(tenant.get("legalName")),
        legalName: text(tenant.get("legalName")) || null,
      },
      contractDate: input.today,
    },
  };
}

export type LoadedTemplate = {
  templateId: string;
  versionId: string;
  version: number;
  template: ContractTemplateInput;
};

export function customFieldsFrom(value: unknown): ContractCustomField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(record)
    .map((field) => ({ key: text(field.key), label: text(field.label) }))
    .filter((field) => /^custom\.[a-z0-9_]+$/.test(field.key) && field.label);
}

/**
 * The studio's agreement to write a contract from: the named template, or the
 * tenant's default. Only a saved version counts — an imported agreement the
 * studio has not reviewed and saved is a draft, not their contract.
 */
export async function loadAgreementTemplate(
  db: Firestore,
  tenantId: string,
  templateId?: string | null,
): Promise<LoadedTemplate | null> {
  let id = templateId ?? "";
  if (!id) {
    const tenant = await db.doc(`tenants/${tenantId}`).get();
    id = text(record(tenant.get("defaultContractSettings")).agreementTemplateId);
  }
  if (!id) return null;
  const head = await db.doc(`agreementTemplates/${id}`).get();
  if (!head.exists || head.get("tenantId") !== tenantId) return null;
  if (head.get("status") === "archived") return null;
  const versionId = text(head.get("currentVersionId"));
  if (!versionId) return null;
  const version = await db.doc(`agreementTemplateVersions/${versionId}`).get();
  if (!version.exists || version.get("tenantId") !== tenantId) return null;
  return {
    templateId: id,
    versionId,
    version: Number(version.get("version") ?? 1),
    template: {
      title: text(version.get("title")) || text(head.get("name")) || "Agreement",
      body: text(version.get("body")),
      customFields: customFieldsFrom(version.get("customFields")),
    },
  };
}

export { importedAgreementText };
