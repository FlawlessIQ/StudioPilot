"use client";

import { getOptionalAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";
import type { StudioInvoiceSettings } from "@/features/billing/studio-invoice-settings";

/**
 * Settings → Invoices, browser side: saves what goes on the invoices the
 * studio issues itself, through integrationsCommand `setStudioInvoiceSettings`
 * (owner/admin, audited; functions/src/integrations/commands.ts). With no
 * Functions URL (preview) nothing is saved, and the panel says so.
 */
export function studioInvoiceSettingsAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL);
}

export async function saveStudioInvoiceSettings(
  tenantId: string,
  input: StudioInvoiceSettings,
): Promise<{ persisted: boolean; settings: StudioInvoiceSettings | null }> {
  const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
  if (!endpoint) return { persisted: false, settings: null };
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("AUTHENTICATION_REQUIRED");
  const appCheckToken = await getOptionalAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/integrationsCommand`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify({
      type: "setStudioInvoiceSettings",
      tenantId,
      idempotencyKey: `invoice_settings_${crypto.randomUUID()}`,
      input,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? "COMMAND_FAILED"));
  markTenantRecordsWritten();
  return { persisted: true, settings: payload as unknown as StudioInvoiceSettings };
}
