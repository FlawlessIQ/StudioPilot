"use client";

import { getOptionalAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";
import type { BillingSettings, SalesTaxMode } from "@/features/billing/sales-tax-settings";

/**
 * Settings → Integrations → QuickBooks, browser side.
 *
 * The status, item setup and test invoice go to quickbooksSetupCommand
 * (functions/src/integrations/quickbooks-setup.ts), which reads and writes
 * QuickBooks; the settings themselves to integrationsCommand
 * `setBillingSettings`. Both are owner/admin. With no Functions URL (preview)
 * nothing is read or saved, and the page says so.
 *
 * The types mirror the Function's responses; functions/ cannot be imported
 * from app code (tests/app-build-boundary.test.ts).
 */

export type QuickBooksSalesTaxSetup = "automatic" | "manual" | "off";
export type QuickBooksPaymentsState = "on" | "off" | "unknown";

export type QuickBooksTestCheck = {
  key: "customer" | "invoice" | "tax" | "pay_link" | "void";
  label: string;
  ok: boolean | null;
  detail: string;
};

export type QuickBooksTestResult = {
  passed: boolean;
  at: string;
  mock: boolean;
  invoiceId: string | null;
  docNumber: string | null;
  checks: QuickBooksTestCheck[];
};

export type QuickBooksSetupStatus = {
  connected: boolean;
  mock: boolean;
  error: string | null;
  company: {
    companyName: string | null;
    country: string | null;
    salesTax: QuickBooksSalesTaxSetup;
    suggestedEstimateRateBasisPoints: number | null;
    payments: { state: QuickBooksPaymentsState; source: "test_invoice" | "preferences" | null };
  } | null;
  paymentsScope: boolean;
  items: {
    retainer: { id: string; name: string } | null;
    package: { id: string; name: string } | null;
    stored: boolean;
  };
  settings: BillingSettings;
  settingsSaved: boolean;
  lastTest: QuickBooksTestResult | null;
};

/** The Functions base URL; PREVIEW_MODE when this environment has none. */
function functionsEndpoint(): string {
  const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
  if (!endpoint) throw new Error("PREVIEW_MODE");
  return endpoint.replace(/\/$/, "");
}

async function post(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to manage QuickBooks.");
  const appCheckToken = await getOptionalAppCheckToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? "QuickBooks couldn't be reached."));
  return payload;
}

export function quickBooksSetupAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL);
}

/** What QuickBooks says about the connected company, read now. */
export async function readQuickBooksSetup(tenantId: string): Promise<QuickBooksSetupStatus> {
  const endpoint = functionsEndpoint();
  return (await post(`${endpoint}/quickbooksSetupCommand`, { action: "status", tenantId })) as unknown as QuickBooksSetupStatus;
}

/** Find or make the Retainer and Photography package items. */
export async function setUpQuickBooksItems(tenantId: string) {
  const endpoint = functionsEndpoint();
  const result = await post(`${endpoint}/quickbooksSetupCommand`, {
    action: "setUpItems",
    tenantId,
    idempotencyKey: `qbo_items_${crypto.randomUUID()}`,
  });
  markTenantRecordsWritten();
  return result as { ids: { retainerItemId: string | null; packageItemId: string | null }; created: string[]; mock: boolean };
}

/** The $1.00 test invoice, voided straight away. */
export async function sendQuickBooksTestInvoice(tenantId: string): Promise<QuickBooksTestResult> {
  const endpoint = functionsEndpoint();
  const result = await post(`${endpoint}/quickbooksSetupCommand`, {
    action: "sendTestInvoice",
    tenantId,
    idempotencyKey: `qbo_test_${crypto.randomUUID()}`,
  });
  markTenantRecordsWritten();
  return result as unknown as QuickBooksTestResult;
}

/** Save the sales tax choice, the estimate rate and retainer review. */
export async function saveBillingSettings(
  tenantId: string,
  input: { salesTax: { mode: SalesTaxMode; estimateRateBasisPoints: number | null }; holdRetainerForReview: boolean },
): Promise<{ persisted: boolean }> {
  if (!quickBooksSetupAvailable()) return { persisted: false };
  const endpoint = functionsEndpoint();
  await post(`${endpoint}/integrationsCommand`, {
    type: "setBillingSettings",
    tenantId,
    idempotencyKey: `billing_settings_${crypto.randomUUID()}`,
    input,
  });
  markTenantRecordsWritten();
  return { persisted: true };
}
