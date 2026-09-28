"use client";

import { useState } from "react";
import { CheckCircle2, CreditCard, LoaderCircle, TriangleAlert } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { autopayStudioState } from "@/features/billing/autopay";
import { setAutopay, startQuickBooksPaymentsConnect } from "@/lib/integrations/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { OutsideStepCard } from "@/components/outside-steps/outside-step-card";
import { outsideStepStatus, type OutsideStepRecord } from "@/features/outside-steps/registry";

/**
 * Autopay: couples save a card at the deposit and the final balance charges
 * itself on its due date. See functions/src/billing/autopay-core.ts.
 *
 * The card leads with what the studio has to do outside StudioCue, because
 * nothing here works without it: QuickBooks Payments is a merchant account
 * Intuit approves per business, and StudioCue cannot apply on anyone's behalf.
 * Both outside steps are guided and tracked by the shared outside-step card
 * (features/outside-steps): the application, which the studio tells us
 * about, and the payments permission, which StudioCue sees for itself.
 */
export function AutopaySettings() {
  const workspace = useWorkspace();
  const tenantId = workspace.tenantId;
  const { records: tenants } = useTenantDocuments("tenants");
  const { records: connections } = useTenantDocuments("integrationConnections");
  const { records: methods } = useTenantDocuments("paymentMethods");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!tenantId || !["studio_owner", "studio_admin"].includes(String(workspace.role))) return null;
  const tenant = tenants?.find((entry) => entry.id === tenantId);
  const quickbooks = connections?.find((entry) => entry.provider === "quickbooks");
  const state = autopayStudioState({
    connection: quickbooks ?? null,
    tenant: tenant ?? null,
    methods: methods ?? [],
  });
  const recorded = (tenant?.outsideSteps ?? {}) as Record<string, OutsideStepRecord>;
  const applyStatus = outsideStepStatus("quickbooks_payments_apply", {
    record: recorded.quickbooks_payments_apply,
    activeCards: state.activeCards,
    paymentsRefused: state.paymentsRefused,
  });
  const reconnectStatus = outsideStepStatus("quickbooks_payments_reconnect", {
    paymentsGranted: state.step >= 3,
  });

  async function reconnect() {
    setBusy(true);
    setNotice(null);
    try {
      window.location.assign(await startQuickBooksPaymentsConnect(tenantId!));
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "QuickBooks could not be reconnected."));
      setBusy(false);
    }
  }

  async function toggle(enabled: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await setAutopay(enabled, tenantId!);
      refreshTenantRecords("tenants");
      setNotice(
        result.persisted
          ? enabled
            ? "Autopay is on. Couples can save a card on their payments page."
            : "Autopay is off. Saved cards won't be charged."
          : "Preview mode: autopay was not saved.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Autopay could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="integration-routing autopay-settings" aria-labelledby="autopay-heading">
      <header>
        <h2 id="autopay-heading">
          <CreditCard aria-hidden="true" size={17} /> Autopay
        </h2>
        <p>
          Couples save a card when they pay their deposit, and the final balance
          charges itself on its due date. A declined card gets the invoice link
          and one retry three days later. QuickBooks records every payment.
        </p>
      </header>

      <OutsideStepCard stepId="quickbooks_payments_apply" status={applyStatus} />
      <ol className="autopay-steps">
        <li className={state.step > 1 ? "is-done" : "is-current"}>
          <span>Connect QuickBooks</span>
          {state.step === 1 ? <small>Connect QuickBooks above first.</small> : null}
        </li>
        <li className={state.step > 2 ? "is-done" : state.step === 2 ? "is-current" : ""}>
          <span>Let StudioCue take payments through QuickBooks</span>
          {state.step >= 2 ? (
            <OutsideStepCard
              action={
                state.step === 2 ? (
                  <button className="button button-dark" disabled={busy} onClick={() => void reconnect()} type="button">
                    {busy ? <LoaderCircle className="spin" size={14} /> : null}
                    Reconnect QuickBooks for payments
                  </button>
                ) : undefined
              }
              status={reconnectStatus}
              stepId="quickbooks_payments_reconnect"
            />
          ) : null}
        </li>
        <li className={state.enabled ? "is-done" : state.step === 3 ? "is-current" : ""}>
          <span>Offer autopay to couples</span>
          {state.step >= 3 ? (
            <label className="autopay-toggle">
              <input
                checked={state.enabled}
                disabled={busy}
                onChange={(event) => void toggle(event.target.checked)}
                type="checkbox"
              />
              <small>
                {state.enabled
                  ? `On${state.activeCards ? ` · ${state.activeCards} ${state.activeCards === 1 ? "card" : "cards"} saved` : ""}`
                  : "Off"}
              </small>
            </label>
          ) : null}
        </li>
      </ol>

      {state.paymentsRefused ? (
        <p className="agreement-template-state is-attention" role="alert">
          <TriangleAlert size={15} /> QuickBooks refused a couple&rsquo;s card
          because QuickBooks Payments isn&rsquo;t active on your company yet.
          Finish the application in QuickBooks, then reconnect for payments.
        </p>
      ) : state.enabled ? (
        <p className="agreement-template-state">
          <CheckCircle2 size={15} /> Couples see &ldquo;Pay your final balance
          automatically&rdquo; on their payments page.
        </p>
      ) : null}

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
