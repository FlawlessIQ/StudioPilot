import type { Firestore } from "firebase-admin/firestore";
import { jobKindOf } from "../job-kinds/job-kinds.js";
import { readPricedSalesTax } from "../billing/sales-tax-pricing.js";
import { combineCoverage, describeCoverage, resolveCoverage } from "../packages/coverage.js";
import { packageInclusionItems } from "../packages/inclusions.js";
import {
  formatMoney,
  importedAgreementText,
  type ContractCustomField,
  type ContractSources,
  type ContractTemplateInput,
} from "./document.js";
import { retainerFromSchedule } from "../booking/agreed-retainer.js";
import { isReturned } from "../planning/questionnaire-lifecycle.js";
import { contractFormAnswers } from "./form-answers.js";
import { eventDetailsFrom } from "./event-details.js";
import { formatContractDate } from "./document.js";

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
    // A booking change's proposal is held apart until it is signed, so no
    // reader of `proposals` mistakes it for the current one
    // (./amendments.ts).
    input.proposalId.startsWith("amend_")
      ? db.doc(`amendmentProposals/${input.proposalId}`).get()
      : db.doc(`proposals/${input.proposalId}`).get(),
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
  /**
   * Every package on the proposal, each with its own total.
   *
   * A studio selling photography and video sells two things and its contract
   * says so. The pricing snapshot holds one combined total, so the per-package
   * figures come from the snapshots themselves — the primary first, in the
   * order they were sold.
   */
  const additionalSnapshotIds = Array.isArray(
    proposal.get("additionalPackageSnapshotIds"),
  )
    ? (proposal.get("additionalPackageSnapshotIds") as unknown[])
        .map((value) => String(value))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const additionalSnapshots = additionalSnapshotIds.length
    ? (
        await Promise.all(
          additionalSnapshotIds.map((id) =>
            db.doc(`packageSnapshots/${id}`).get(),
          ),
        )
      ).filter(
        (document) =>
          document.exists && document.get("tenantId") === input.tenantId,
      )
    : [];
  const packages = [
    ...(snapshot?.exists && snapshot.get("tenantId") === input.tenantId
      ? [snapshot]
      : []),
    ...additionalSnapshots,
  ]
    .map((document) => ({
      name: text(document.get("packageName")),
      totalCents: Number(document.get("totalCents") ?? 0),
    }))
    .filter((entry) => entry.name);
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

  /**
   * The couple's own answers to the details form, for printing into the
   * agreement they sign.
   *
   * "I need the wedding venue form sent to them and on the contract" — and,
   * asked whether the answers should travel alongside or be printed in: "They
   * should be on the signed contract document itself." Venue, timings and
   * access are what the studio is agreeing to work around.
   *
   * Only a submitted response counts. A half-filled draft would put answers
   * the couple has not stood behind into a document they are about to sign.
   */
  const questionnaires = await db
    .collection("questionnaireResponses")
    .where("tenantId", "==", project.get("tenantId"))
    .where("projectId", "==", project.id)
    .get();
  // Sent back counts: `submitted`, and `locked` once the studio has locked it.
  const submitted = questionnaires.docs
    .filter((document) => isReturned(document.get("status")))
    .sort((left, right) =>
      text(left.get("submittedAt")).localeCompare(text(right.get("submittedAt"))),
    )
    .at(-1);
  const formAnswers = submitted
    ? contractFormAnswers({
        sections: record(submitted.get("templateSnapshot")).sections,
        answers: submitted.get("answers"),
      })
    : [];
  const client = record(proposal.get("clientSnapshot"));
  const event = record(proposal.get("eventSnapshot"));
  const pricing = record(proposal.get("pricingSnapshot"));
  const schedule = Array.isArray(proposal.get("paymentSchedule"))
    ? (proposal.get("paymentSchedule") as unknown[]).map(record)
    : [];
  const clientName = text(client.displayName);
  const clientEmail = text(client.email).toLowerCase();
  /**
   * Every package on the proposal, not only the first. GR's photo + video
   * agreement said "2 photographers, 8 hours" and listed only the photo
   * package's inclusions (2026-09-30): the videographer and the whole video
   * package were missing from what the couple signed.
   */
  const soldSnapshots = [
    ...(snapshot?.exists && snapshot.get("tenantId") === input.tenantId ? [snapshot] : []),
    ...additionalSnapshots,
  ].map((document) => record(document.data()));
  const allSnapshots = soldSnapshots.length ? soldSnapshots : [snapshotData];
  const coverageRoles = describeCoverage(
    combineCoverage(allSnapshots.map((data) => resolveCoverage(data))),
  );
  const hours = hoursPhrase(
    Math.max(0, ...allSnapshots.map((data) => Number(data.includedCoverageMinutes) || 0)),
  );
  const coverage = [coverageRoles, hours].filter(Boolean).join(", ");
  // "What's included", the words the studio edits and the proposal shows, so
  // the agreement and the proposal list the same things. The older
  // deliverables list only when there's no description.
  const included = (data: Record<string, unknown>) => {
    const written = packageInclusionItems(data.description);
    if (written.length) return written;
    return Array.isArray(data.includedDeliverables)
      ? (data.includedDeliverables as unknown[]).map(text).filter(Boolean)
      : [];
  };
  /**
   * The extras the couple is paying for, under the package they were added
   * to. GR's agreement totalled $9,098 — a $500 engagement shoot included —
   * while its Services named only the two packages (2026-10-01): the couple
   * signed for a price the document didn't account for.
   */
  const currency = text(pricing.currency) || text(tenant.get("currency")) || "USD";
  const includedFor = (data: Record<string, unknown>) => [
    ...included(data),
    ...contractExtras(data.addOns, currency),
  ];
  // One package reads as its list; several each start with their name.
  const deliverables =
    allSnapshots.length > 1
      ? allSnapshots.flatMap((data) => {
          const items = includedFor(data);
          return items.length ? [`${text(data.packageName) || "Package"}:`, ...items] : [];
        })
      : includedFor(allSnapshots[0]!);

  // Schedule A: the couple's own answers sorted into the parts of the day,
  // with the date, venue and coverage from the records (./event-details.ts).
  const eventDate = text(event.eventDate) || text(project.get("eventDate")).slice(0, 10);
  const eventDetails = eventDetailsFrom({
    eventType: text(event.eventType) || text(project.get("eventType")),
    eventKind: jobKindOf(project.data()),
    date: /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? formatContractDate(eventDate) : null,
    venue: text(event.venue) || text(project.get("venueName")) || null,
    coverage: coverage || null,
    answers: formAnswers,
  });

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
        deliverableGroups: allSnapshots.map((data) => ({
          name: text(data.packageName) || "Package",
          items: includedFor(data),
        })),
      },
      pricing: {
        currency,
        totalCents: cents(pricing.totalCents),
        // Said beside the total, so the fee reconciles with the packages and
        // extras listed above it.
        discountCents: cents(pricing.discountCents),
        // The schedule's retainer, as the invoice bills it. A fixed retainer
        // lives only in the schedule, so the snapshot's percentage put
        // "Retainer: $1,079.70" above a table saying $1,000.00 in the same
        // agreement (walked 2026-09-30).
        retainerCents: retainerFromSchedule(proposal.get("paymentSchedule"), cents(pricing.retainerCents)),
        // Pre-tax "plus sales tax" when QuickBooks works the tax out; a
        // booking priced the old way has none and reads exactly as before.
        ...(readPricedSalesTax(pricing.salesTax) ? { salesTax: readPricedSalesTax(pricing.salesTax) } : {}),
      },
      packages,
      formAnswers,
      eventDetails,
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
        /**
         * The letterhead, from the same branding record the emails use, so a
         * studio sets its address once and every document it sends carries it.
         */
        address: text(record(tenant.get("emailBranding")).postalAddress) || null,
        phone: text(record(tenant.get("emailBranding")).phone) || null,
        email:
          text(record(tenant.get("emailBranding")).replyTo) ||
          text(tenant.get("contactEmail")) ||
          null,
        website: text(record(tenant.get("emailBranding")).websiteUrl) || null,
      },
      contractDate: input.today,
    },
  };
}

/** "Engagement shoot (extra, $500.00)"; "Album spreads ×2 (extra, $300.00)". */
export function contractExtras(addOns: unknown, currency: string): string[] {
  if (!Array.isArray(addOns)) return [];
  return addOns
    .map(record)
    .map((item) => {
      const name = text(item.name);
      if (!name) return "";
      const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
      const lineCents = cents(item.lineTotalCents ?? cents(item.unitPriceCents) * quantity);
      return `${name}${quantity > 1 ? ` ×${quantity}` : ""} (extra, ${formatMoney(lineCents, currency)})`;
    })
    .filter(Boolean)
    .slice(0, 20);
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
