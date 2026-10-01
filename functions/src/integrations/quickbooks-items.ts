import { getFirestore } from "firebase-admin/firestore";
import type { InvoiceLine } from "../operations/quickbooks-invoice-lines.js";
import { normaliseBillingSettings } from "../billing/sales-tax-settings.js";
import {
  INCOME_ACCOUNT_QUERY,
  STUDIOCUE_QUICKBOOKS_ITEMS,
  activeItemIds,
  itemByNameQuery,
  itemCreateBody,
  itemKeyForLine,
  itemsByIdQuery,
  usableItem,
  type StudioCueItemIds,
  type StudioCueItemKey,
} from "./quickbooks-setup-core.js";

/**
 * A QuickBooks company, for the setup code: one place that builds the URL,
 * the headers and the error code. `request` is provider-runtime's
 * providerJson, passed in so this module never imports the runtime (the
 * runtime imports this one).
 */
export type QuickBooksRequest = (url: string, init: RequestInit, code: string) => Promise<Record<string, unknown>>;

export type QuickBooksCompany = {
  query(sql: string, code: string): Promise<Record<string, unknown>>;
  get(path: string, code: string): Promise<Record<string, unknown>>;
  post(path: string, body: unknown, code: string, requestId?: string): Promise<Record<string, unknown>>;
};

export function quickBooksCompany(input: {
  apiBaseUrl: string;
  realmId: string;
  accessToken: string;
  request: QuickBooksRequest;
}): QuickBooksCompany {
  const root = `${input.apiBaseUrl.replace(/\/$/, "")}/v3/company/${encodeURIComponent(input.realmId)}`;
  const headers = { authorization: `Bearer ${input.accessToken}`, accept: "application/json" };
  const join = (path: string) => `${root}/${path}${path.includes("?") ? "&" : "?"}minorversion=75`;
  return {
    query: (sql, code) => input.request(join(`query?query=${encodeURIComponent(sql)}`), { headers }, code),
    get: (path, code) => input.request(join(path), { headers }, code),
    post: (path, body, code, requestId) =>
      input.request(
        join(path),
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            ...(requestId ? { "request-id": requestId.slice(0, 50) } : {}),
          },
          body: JSON.stringify(body),
        },
        code,
      ),
  };
}

const refused = (caught: unknown) => /^[A-Z_]+:400:/.test(caught instanceof Error ? caught.message : "");

/**
 * The Retainer and Photography package items: found by name, else made.
 *
 * Found first, so a studio that already sells a "Retainer" keeps its own item
 * (and its income account). A new one posts to the company's first income
 * account; `Taxable` is asked for, and dropped if the company refuses it.
 */
export async function ensureStudioCueItems(
  company: QuickBooksCompany,
  idempotencyKey: string,
): Promise<{ ids: StudioCueItemIds; created: StudioCueItemKey[] }> {
  const created: StudioCueItemKey[] = [];
  let incomeAccountId: string | null = null;
  const ids: Record<StudioCueItemKey, string | null> = { retainer: null, package: null };
  for (const key of ["retainer", "package"] as const) {
    const name = STUDIOCUE_QUICKBOOKS_ITEMS[key].name;
    const found = usableItem(await company.query(itemByNameQuery(name), "QUICKBOOKS_ITEM_SEARCH_FAILED"));
    if (found) {
      ids[key] = found.id;
      continue;
    }
    if (!incomeAccountId) {
      const accounts = await company.query(INCOME_ACCOUNT_QUERY, "QUICKBOOKS_ACCOUNT_SEARCH_FAILED");
      const list = (accounts.QueryResponse as { Account?: Array<{ Id?: unknown }> } | undefined)?.Account;
      incomeAccountId = Array.isArray(list) && typeof list[0]?.Id === "string" ? list[0].Id : null;
      if (!incomeAccountId) throw new Error("QUICKBOOKS_INCOME_ACCOUNT_MISSING");
    }
    const account = incomeAccountId;
    const make = (withTaxable: boolean, suffix: string) =>
      company.post("item", itemCreateBody(key, account, { withTaxable }), "QUICKBOOKS_ITEM_CREATE_FAILED", `${idempotencyKey}-${key}${suffix}`);
    const response = await make(true, "").catch((caught: unknown) => {
      if (refused(caught)) return make(false, "-plain");
      throw caught;
    });
    const id = String((response.Item as { Id?: unknown } | undefined)?.Id ?? "");
    if (!id) throw new Error("QUICKBOOKS_ITEM_ID_MISSING");
    ids[key] = id;
    created.push(key);
  }
  return { ids: { retainerItemId: ids.retainer, packageItemId: ids.package }, created };
}

/** Keep the item ids on the studio's billing settings (server-only field). */
export async function storeStudioCueItemIds(tenantId: string, ids: StudioCueItemIds): Promise<void> {
  await getFirestore()
    .doc(`billingSettings/${tenantId}`)
    .set({ tenantId, quickbooksItems: { retainerItemId: ids.retainerItemId, packageItemId: ids.packageItemId } }, { merge: true });
}

/** The stored ids, if both still exist and are active in QuickBooks. */
export async function verifiedStoredItemIds(
  company: QuickBooksCompany,
  stored: StudioCueItemIds,
): Promise<StudioCueItemIds | null> {
  if (!stored.retainerItemId || !stored.packageItemId) return null;
  const active = activeItemIds(
    await company.query(itemsByIdQuery([stored.retainerItemId, stored.packageItemId]), "QUICKBOOKS_ITEM_SEARCH_FAILED"),
  );
  return active.has(stored.retainerItemId) && active.has(stored.packageItemId) ? stored : null;
}

export type ItemRef = { value: string; name?: string };

/**
 * The item each line of an invoice is sold as, for the invoice worker.
 *
 * Uses the ids on billingSettings when they are still live in QuickBooks;
 * otherwise sets the items up (the first invoice after connecting does this)
 * and stores them. Null when that cannot be done — the worker then falls back
 * to the single service item it always used, so an item problem never stops
 * an invoice.
 */
export async function studioCueInvoiceItemRefs(input: {
  tenantId: string;
  company: QuickBooksCompany;
  idempotencyKey: string;
}): Promise<((line: InvoiceLine) => ItemRef) | null> {
  try {
    const snapshot = await getFirestore().doc(`billingSettings/${input.tenantId}`).get();
    const settings = normaliseBillingSettings(snapshot.exists ? snapshot.data() : null, input.tenantId);
    let ids = await verifiedStoredItemIds(input.company, settings.quickbooksItems);
    if (!ids) {
      ids = (await ensureStudioCueItems(input.company, `${input.idempotencyKey}-items`)).ids;
      await storeStudioCueItemIds(input.tenantId, ids);
    }
    const refs: Record<StudioCueItemKey, ItemRef> = {
      retainer: { value: ids.retainerItemId!, name: STUDIOCUE_QUICKBOOKS_ITEMS.retainer.name },
      package: { value: ids.packageItemId!, name: STUDIOCUE_QUICKBOOKS_ITEMS.package.name },
    };
    return (line) => refs[itemKeyForLine(line.kind)];
  } catch (caught: unknown) {
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        event: "quickbooks.items_unavailable",
        tenantId: input.tenantId,
        reason: caught instanceof Error ? caught.message : String(caught),
      }),
    );
    return null;
  }
}
