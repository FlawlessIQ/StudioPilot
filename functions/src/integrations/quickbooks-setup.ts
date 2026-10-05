import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheckOrAppHostingProxy, requireIdentity } from "../crm/security.js";
import { requireActiveSubscription } from "../saas/entitlement-guard.js";
import { studioHubCors } from "../security/cors.js";
import { connection, providerJson } from "../operations/provider-runtime.js";
import { quickBooksApiBaseUrl } from "./provider-config.js";
import { hasPaymentsScope } from "../billing/autopay-core.js";
import { normaliseBillingSettings, type BillingSettings } from "../billing/sales-tax-settings.js";
import {
  ensureStudioCueItems,
  quickBooksCompany,
  storeStudioCueItemIds,
  verifiedStoredItemIds,
  type QuickBooksCompany,
} from "./quickbooks-items.js";
import {
  STUDIOCUE_QUICKBOOKS_ITEMS,
  TAX_RATE_QUERY,
  itemByNameQuery,
  mockTestInvoiceResult,
  quickBooksCompanyStatus,
  usableItem,
  type QuickBooksCompanyStatus,
  type TestInvoiceResult,
} from "./quickbooks-setup-core.js";
import { readQuickBooksCompany, runQuickBooksTestInvoice } from "./quickbooks-test-invoice.js";

/**
 * Settings → Integrations → QuickBooks, server side.
 *
 *   status          read-only: the company, its sales tax, QuickBooks
 *                   Payments, StudioCue's items, and the saved settings.
 *   setUpItems      find-or-create the Retainer and Photography package items.
 *   sendTestInvoice a $1.00 invoice to "StudioCue test (you)", read back for
 *                   its pay link, then voided. Nothing is emailed to anyone.
 *
 * Owner/admin, subscription-gated, like integrationsCommand. Its own Function
 * because it calls QuickBooks and may refresh the connection, which needs the
 * QuickBooks client credentials bound (tests/provider-refresh-configured.test.ts).
 * The settings themselves are saved by integrationsCommand `setBillingSettings`.
 */

const allowedRoles = ["studio_owner", "studio_admin"];

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), tenantId: z.string().min(1) }),
  z.object({
    action: z.literal("setUpItems"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
  }),
  z.object({
    action: z.literal("sendTestInvoice"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
  }),
]);

export type QuickBooksItemState = { id: string; name: string } | null;

export type QuickBooksSetupStatus = {
  connected: boolean;
  mock: boolean;
  /** Why it isn't connected, or why QuickBooks couldn't be read. */
  error: string | null;
  company: QuickBooksCompanyStatus | null;
  paymentsScope: boolean;
  items: { retainer: QuickBooksItemState; package: QuickBooksItemState; stored: boolean };
  settings: BillingSettings;
  /** False when the studio has never saved its sales tax choice (the mode shown is a suggestion). */
  settingsSaved: boolean;
  lastTest: TestInvoiceResult | null;
};

type Link = Awaited<ReturnType<typeof connection>>;

function companyFor(link: Link): { company: QuickBooksCompany; realmId: string } {
  const credential = link.credential;
  const realmId = credential?.realmId ?? String(link.document.get("providerAccountId") ?? "");
  if (!credential || !realmId) throw new Error("QUICKBOOKS_REALM_MISSING");
  return {
    realmId,
    company: quickBooksCompany({
      apiBaseUrl: quickBooksApiBaseUrl(credential.baseUrl),
      realmId,
      accessToken: credential.accessToken,
      request: providerJson,
    }),
  };
}

async function readSettings(tenantId: string) {
  const snapshot = await getFirestore().doc(`billingSettings/${tenantId}`).get();
  const raw = snapshot.exists ? snapshot.data() : null;
  const saved = Boolean(raw && typeof raw.salesTax === "object" && raw.salesTax && "mode" in raw.salesTax);
  return { raw, saved };
}

const optional = async <T>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work();
  } catch {
    return null;
  }
};

/**
 * What QuickBooks just said about sales tax, kept on the connection so the
 * "Turn on Automated Sales Tax" step (features/outside-steps/registry.ts) can
 * tick itself off without reading QuickBooks again. Best effort: a failed
 * write never fails the status read.
 */
function rememberCompanySalesTax(link: Link, salesTax: string) {
  if (link.document.get("companySalesTax") === salesTax) return;
  void link.document.ref
    .set({ companySalesTax: salesTax, companySalesTaxCheckedAt: new Date().toISOString() }, { merge: true })
    .catch(() => undefined);
}

async function status(tenantId: string): Promise<QuickBooksSetupStatus> {
  const { raw, saved } = await readSettings(tenantId);
  const base = (hint: boolean) => normaliseBillingSettings(raw, tenantId, { quickBooksSalesTax: hint });
  const notConnected = (error: string | null): QuickBooksSetupStatus => ({
    connected: false,
    mock: false,
    error,
    company: null,
    paymentsScope: false,
    items: { retainer: null, package: null, stored: false },
    settings: base(false),
    settingsSaved: saved,
    lastTest: null,
  });
  let link: Link;
  try {
    link = await connection(tenantId, "quickbooks");
  } catch (caught: unknown) {
    const code = caught instanceof Error ? caught.message : "QUICKBOOKS_NOT_CONNECTED";
    return notConnected(code === "QUICKBOOKS_NOT_CONNECTED" ? null : code);
  }
  const lastTestRaw = link.document.get("lastTestInvoice") as (TestInvoiceResult & { payLink?: boolean }) | undefined;
  const lastTest = lastTestRaw && typeof lastTestRaw.at === "string" ? lastTestRaw : null;
  const lastTestPay = lastTest
    ? { payLink: lastTest.checks?.some((check) => check.key === "pay_link" && check.ok === true) ?? false, at: lastTest.at }
    : null;
  const paymentsScope = link.mock || hasPaymentsScope(link.document.get("scopes"));
  const stored = normaliseBillingSettings(raw, tenantId).quickbooksItems;
  if (link.mock) {
    const company = quickBooksCompanyStatus({
      companyInfo: { CompanyInfo: { CompanyName: "Mock QuickBooks company", Country: "US" } },
      preferences: { TaxPrefs: { UsingSalesTax: true, PartnerTaxEnabled: true } },
      taxRates: null,
      lastTest: lastTestPay,
    });
    rememberCompanySalesTax(link, company.salesTax);
    return {
      connected: true,
      mock: true,
      error: null,
      company,
      paymentsScope,
      items: {
        retainer: stored.retainerItemId ? { id: stored.retainerItemId, name: STUDIOCUE_QUICKBOOKS_ITEMS.retainer.name } : null,
        package: stored.packageItemId ? { id: stored.packageItemId, name: STUDIOCUE_QUICKBOOKS_ITEMS.package.name } : null,
        stored: Boolean(stored.retainerItemId && stored.packageItemId),
      },
      settings: base(company.salesTax !== "off"),
      settingsSaved: saved,
      lastTest,
    };
  }
  try {
    const { company, realmId } = companyFor(link);
    const { companyInfo, preferences } = await readQuickBooksCompany(company, realmId);
    const salesTaxSetup = quickBooksCompanyStatus({ companyInfo, preferences, taxRates: null, lastTest: lastTestPay }).salesTax;
    const taxRates = salesTaxSetup === "manual" ? await optional(() => company.query(TAX_RATE_QUERY, "QUICKBOOKS_TAX_RATE_READ_FAILED")) : null;
    const companyStatus = quickBooksCompanyStatus({ companyInfo, preferences, taxRates, lastTest: lastTestPay });
    rememberCompanySalesTax(link, companyStatus.salesTax);
    // Items: the stored ones if still live, else whatever already carries the
    // names — read only; nothing is created by looking.
    const verified = await optional(() => verifiedStoredItemIds(company, stored));
    const byName = async (key: "retainer" | "package") => {
      const item = await optional(async () =>
        usableItem(await company.query(itemByNameQuery(STUDIOCUE_QUICKBOOKS_ITEMS[key].name), "QUICKBOOKS_ITEM_SEARCH_FAILED")),
      );
      return item ? { id: item.id, name: item.name } : null;
    };
    const items = verified
      ? {
          retainer: { id: verified.retainerItemId!, name: STUDIOCUE_QUICKBOOKS_ITEMS.retainer.name },
          package: { id: verified.packageItemId!, name: STUDIOCUE_QUICKBOOKS_ITEMS.package.name },
          stored: true,
        }
      : { retainer: await byName("retainer"), package: await byName("package"), stored: false };
    return {
      connected: true,
      mock: false,
      error: null,
      company: companyStatus,
      paymentsScope,
      items,
      settings: base(companyStatus.salesTax !== "off"),
      settingsSaved: saved,
      lastTest,
    };
  } catch (caught: unknown) {
    return {
      ...notConnected(caught instanceof Error ? caught.message : "QUICKBOOKS_READ_FAILED"),
      connected: true,
      paymentsScope,
      lastTest,
    };
  }
}

async function setUpItems(tenantId: string, idempotencyKey: string) {
  const link = await connection(tenantId, "quickbooks");
  if (link.mock) {
    const ids = { retainerItemId: "mock_qbo_item_retainer", packageItemId: "mock_qbo_item_package" };
    await storeStudioCueItemIds(tenantId, ids);
    return { ids, created: [], mock: true };
  }
  const { company } = companyFor(link);
  const result = await ensureStudioCueItems(company, idempotencyKey);
  await storeStudioCueItemIds(tenantId, result.ids);
  return { ...result, mock: false };
}

async function sendTestInvoice(tenantId: string, idempotencyKey: string, email: string): Promise<TestInvoiceResult> {
  const { raw } = await readSettings(tenantId);
  const link = await connection(tenantId, "quickbooks");
  // Kept on the connection itself, so the page (and its Payments line)
  // remember the last run. Only owners and admins read connection documents.
  const remember = async (result: TestInvoiceResult) => {
    await link.document.ref.set({ lastTestInvoice: result }, { merge: true });
    return result;
  };
  if (link.mock) return remember(mockTestInvoiceResult(new Date().toISOString(), normaliseBillingSettings(raw, tenantId).salesTax.mode));
  const { company, realmId } = companyFor(link);
  const { companyInfo, preferences } = await readQuickBooksCompany(company, realmId);
  const companySalesTax = quickBooksCompanyStatus({ companyInfo, preferences, taxRates: null, lastTest: null }).salesTax;
  const settings = normaliseBillingSettings(raw, tenantId, { quickBooksSalesTax: companySalesTax !== "off" });
  const run = await runQuickBooksTestInvoice({
    company,
    realmId,
    salesTax: settings.salesTax.mode,
    storedItems: settings.quickbooksItems,
    email,
    idempotencyKey,
  });
  if (run.itemsChanged) await storeStudioCueItemIds(tenantId, run.items);
  return remember(run.result);
}

export const quickbooksSetupCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    timeoutSeconds: 120,
    // Reading QuickBooks may refresh the studio's connection, which needs the
    // client credentials (see provider-runtime.ts connection()).
    secrets: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    let identity;
    try {
      await requireAppCheckOrAppHostingProxy(request);
      identity = await requireIdentity(request);
    } catch {
      response.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
      return;
    }
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }
    const command = parsed.data;
    const db = getFirestore();
    const membership = (await db.doc(`memberships/${command.tenantId}_${identity.uid}`).get()).data() as
      | { role: string; status: string }
      | undefined;
    if (!membership || membership.status !== "active" || !allowedRoles.includes(membership.role)) {
      response.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    try {
      await requireActiveSubscription(db, command.tenantId);
    } catch (caught: unknown) {
      // The guard's own code: read-only and suspended studios are told so.
      response.status(402).json({ error: caught instanceof Error ? caught.message : "ACTIVE_SUBSCRIPTION_REQUIRED" });
      return;
    }

    try {
      if (command.action === "status") {
        response.status(200).json(await status(command.tenantId));
        return;
      }
      const executionReference = db.doc(`commandExecutions/${command.tenantId}_${command.idempotencyKey}`);
      const prior = await executionReference.get();
      if (prior.exists) {
        response.status(200).json(prior.data()?.result);
        return;
      }
      const timestamp = new Date().toISOString();
      const result: Record<string, unknown> =
        command.action === "setUpItems"
          ? await setUpItems(command.tenantId, command.idempotencyKey)
          : await sendTestInvoice(command.tenantId, command.idempotencyKey, typeof identity.email === "string" ? identity.email : "");
      const batch = db.batch();
      const auditId = randomUUID();
      batch.create(db.doc(`auditEvents/${auditId}`), {
        id: auditId,
        tenantId: command.tenantId,
        projectId: null,
        actorId: identity.uid,
        actorType: "user",
        action: command.action === "setUpItems" ? "billing.quickbooks_items_set_up" : "billing.quickbooks_test_invoice",
        entityType: "integrationConnection",
        entityId: `${command.tenantId}_quickbooks`,
        timestamp,
        before: null,
        after:
          command.action === "setUpItems"
            ? { ids: result.ids ?? null, created: result.created ?? [] }
            : { passed: result.passed ?? false, invoiceId: result.invoiceId ?? null },
        ipAddress: request.ip ?? null,
        userAgent: request.header("user-agent") ?? null,
        correlationId: request.header("x-correlation-id") ?? randomUUID(),
        automationRunId: null,
        providerEventId: null,
      });
      batch.create(executionReference, {
        tenantId: command.tenantId,
        idempotencyKey: command.idempotencyKey,
        result,
        createdAt: timestamp,
      });
      await batch.commit();
      response.status(200).json(result);
    } catch (caught: unknown) {
      const code = caught instanceof Error ? caught.message : "QUICKBOOKS_SETUP_FAILED";
      response.status(code.endsWith("_NOT_CONNECTED") ? 422 : 400).json({ error: code });
    }
  },
);
