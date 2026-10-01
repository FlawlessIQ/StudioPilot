"use client";

import { useEffect, useState } from "react";
import { CreditCard, Plug, ReceiptText } from "lucide-react";
import { IntegrationManager } from "@/components/integrations/integration-manager";
import { AgreementTemplate } from "@/components/integrations/agreement-template";
import { AutopaySettings } from "@/components/integrations/autopay-settings";
import { QuickBooksSettings } from "@/components/integrations/quickbooks-settings";
import { useWorkspace } from "@/features/auth/workspace-context";

type Tab = "connections" | "quickbooks" | "autopay";

/**
 * Integrations as tabs: the tools a studio connects, QuickBooks (sales tax,
 * items and a test invoice — components/integrations/quickbooks-settings.tsx),
 * and Autopay.
 *
 * They were one page stacked — every provider as a wide row, a routing table
 * repeating the same facts, then Autopay at the bottom — so reaching Autopay
 * meant scrolling past everything (docs/ui-audit-2026-09-27.md). The tab is in
 * the URL (`?tab=autopay`), and the old `#autopay-heading` link still lands
 * there.
 */
export function IntegrationsTabs({ initialTab }: { initialTab: Tab }) {
  const workspace = useWorkspace();
  const [tab, setTab] = useState<Tab>(initialTab);
  const canAutopay = ["studio_owner", "studio_admin"].includes(String(workspace.role));

  useEffect(() => {
    if (window.location.hash === "#autopay-heading" || window.location.hash === "#autopay")
      queueMicrotask(() => setTab("autopay"));
  }, []);

  const choose = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.hash = "";
    if (next === "connections") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  const showing: Tab = canAutopay ? tab : "connections";

  return (
    <>
      {canAutopay ? (
        <div className="integrations-tabs" role="tablist" aria-label="Integrations">
          <button
            aria-selected={showing === "connections"}
            onClick={() => choose("connections")}
            role="tab"
            type="button"
          >
            <Plug aria-hidden="true" size={15} /> Connections
          </button>
          <button
            aria-selected={showing === "quickbooks"}
            onClick={() => choose("quickbooks")}
            role="tab"
            type="button"
          >
            <ReceiptText aria-hidden="true" size={15} /> QuickBooks
          </button>
          <button
            aria-selected={showing === "autopay"}
            onClick={() => choose("autopay")}
            role="tab"
            type="button"
          >
            <CreditCard aria-hidden="true" size={15} /> Autopay
          </button>
        </div>
      ) : null}
      <div role="tabpanel">
        {showing === "connections" ? (
          <>
            <IntegrationManager />
            <AgreementTemplate />
          </>
        ) : showing === "quickbooks" ? (
          <QuickBooksSettings />
        ) : (
          <AutopaySettings />
        )}
      </div>
    </>
  );
}
