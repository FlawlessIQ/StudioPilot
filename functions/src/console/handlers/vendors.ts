import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { consoleHandler } from "../command-kit.js";
import { PLATFORM_VENDORS } from "../../saas/platform-vendors.js";

/**
 * Console → Grow → Vendors (docs/console.md, "Vendors"): StudioCue's vendor
 * database (saas/platform-vendors.ts), with where each one stands with the
 * offer — joined from their once-ever record and their opt-out, which share
 * the database's key. The database has no browser read, so this is the only
 * way the Console sees it; an export is audited.
 */

/** Where a vendor stands with StudioCue's offer. */
export type OfferState = "none" | "invited" | "offered" | "claimed" | "signed_up" | "opted_out";

export function offerStateOf(invite: DocumentData | null, suppressed: boolean): OfferState {
  if (invite?.signedUpTenantId) return "signed_up";
  if (invite?.offerClaimedTenantId) return "claimed";
  if (suppressed) return "opted_out";
  if (invite?.offerCode) return "offered";
  if (invite) return "invited";
  return "none";
}

export type VendorRow = {
  id: string;
  email: string;
  kind: string;
  kinds: string[];
  company: string | null;
  contactName: string | null;
  phone: string | null;
  website: string | null;
  region: string | null;
  city: string | null;
  sources: string[];
  jobsSeen: number;
  studiosSeen: number;
  prospect: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  offer: OfferState;
  offerCode: string | null;
  signedUpTenantId: string | null;
  /** The studio whose job first invited or offered them. */
  invitedByTenantId: string | null;
  invitedAt: string | null;
};

const MAX_ROWS = 5000;

async function vendorRows(db: Firestore): Promise<VendorRow[]> {
  const vendors = await db.collection(PLATFORM_VENDORS).orderBy("lastSeenAt", "desc").limit(MAX_ROWS).get();
  const rows: VendorRow[] = [];
  // getAll in slices: one read per vendor for each joined record.
  for (let start = 0; start < vendors.docs.length; start += 300) {
    const slice = vendors.docs.slice(start, start + 300);
    const [invites, suppressions] = await Promise.all([
      db.getAll(...slice.map((vendor) => db.doc(`vendorInvites/${vendor.id}`))),
      db.getAll(...slice.map((vendor) => db.doc(`emailSuppressions/${vendor.id}`))),
    ]);
    slice.forEach((vendor, index) => {
      const data = vendor.data();
      const invite = invites[index]?.exists ? (invites[index]!.data() ?? null) : null;
      rows.push({
        id: vendor.id,
        email: String(data.email ?? ""),
        kind: String(data.kind ?? "other"),
        kinds: Array.isArray(data.kinds) ? data.kinds.map(String) : [],
        company: data.company ?? null,
        contactName: data.contactName ?? null,
        phone: data.phone ?? null,
        website: data.website ?? null,
        region: data.region ?? null,
        city: data.city ?? null,
        sources: Array.isArray(data.sources) ? data.sources.map(String) : [],
        jobsSeen: Number(data.jobsSeen ?? 0),
        studiosSeen: Number(data.studiosSeen ?? 0),
        prospect: String(data.prospect ?? "held"),
        firstSeenAt: data.firstSeenAt ?? null,
        lastSeenAt: data.lastSeenAt ?? null,
        offer: offerStateOf(invite, Boolean(suppressions[index]?.exists)),
        offerCode: typeof invite?.offerCode === "string" ? invite.offerCode : null,
        signedUpTenantId: typeof invite?.signedUpTenantId === "string" ? invite.signedUpTenantId : null,
        invitedByTenantId: typeof invite?.tenantId === "string" ? invite.tenantId : null,
        invitedAt: typeof invite?.createdAt === "string" ? invite.createdAt : null,
      });
    });
  }
  return rows;
}

const CSV_COLUMNS: Array<[keyof VendorRow, string]> = [
  ["company", "Company"],
  ["contactName", "Contact"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["website", "Website"],
  ["kind", "Kind"],
  ["region", "State"],
  ["city", "City"],
  ["jobsSeen", "Jobs"],
  ["studiosSeen", "Studios"],
  ["prospect", "Prospect"],
  ["offer", "Offer"],
  ["firstSeenAt", "First seen"],
  ["lastSeenAt", "Last seen"],
];

/** One CSV cell: quoted when it must be, and never a formula a spreadsheet would run. */
export function csvCell(value: unknown): string {
  let cell = Array.isArray(value) ? value.join("; ") : value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function vendorsCsv(rows: readonly VendorRow[]): string {
  const lines = [CSV_COLUMNS.map(([, label]) => label).join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map(([field]) => csvCell(row[field])).join(","));
  return `${lines.join("\n")}\n`;
}

export const vendorHandlers = {
  /** The database, newest first, with each vendor's offer state. A read: nothing is audited. */
  listPlatformVendors: consoleHandler({
    capability: "console.read",
    input: z.object({}).passthrough(),
    async run({ db }) {
      const rows = await vendorRows(db);
      return { result: { rows, truncated: rows.length >= MAX_ROWS }, audit: null };
    },
  }),

  /** Every row as CSV, for outreach outside StudioCue. Audited: it is the database leaving the Console. */
  exportPlatformVendors: consoleHandler({
    capability: "crm.write",
    input: z.object({ ids: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(MAX_ROWS).optional() }),
    async run({ db }, input) {
      const all = await vendorRows(db);
      const wanted = input.ids?.length ? new Set(input.ids) : null;
      const rows = wanted ? all.filter((row) => wanted.has(row.id)) : all;
      return {
        result: { csv: vendorsCsv(rows), count: rows.length },
        audit: { tenantId: null, entityType: "platform_vendors", entityId: "export", after: { rows: rows.length, filtered: Boolean(wanted) } },
      };
    },
  }),
};
