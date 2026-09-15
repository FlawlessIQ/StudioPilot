"use client";

import Link from "next/link";
import { CreditCard } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { autopayStudioState } from "@/features/billing/autopay";

/**
 * One line on Invoices pointing at autopay until it is on. The requirement is
 * named here too, because "turn on autopay" with no mention of the Intuit
 * application sends a studio to a setting it cannot finish.
 */
export function AutopayHint() {
  const workspace = useWorkspace();
  const { records: tenants } = useTenantDocuments("tenants");
  const { records: connections } = useTenantDocuments("integrationConnections");
  if (!["studio_owner", "studio_admin"].includes(String(workspace.role))) return null;
  const state = autopayStudioState({
    connection: connections?.find((entry) => entry.provider === "quickbooks") ?? null,
    tenant: tenants?.find((entry) => entry.id === workspace.tenantId) ?? null,
    methods: [],
  });
  if (state.enabled) return null;
  return (
    <p className="autopay-hint">
      <CreditCard aria-hidden="true" size={15} />
      <span>
        Stop chasing final balances: with autopay, couples save a card and it
        charges on the due date. It needs a QuickBooks Payments account, which
        you apply for in QuickBooks.{" "}
        <Link href="/studio/integrations#autopay-heading">Set up autopay</Link>
      </span>
    </p>
  );
}
