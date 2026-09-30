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
import { InfoHint } from "@/components/ui/info-hint";

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
    <section className="autopay-settings" aria-labelledby="autopay-heading">
      <header className="autopay-head">
        <div>
          <h2 id="autopay-heading">
            <CreditCard aria-hidden="true" size={17} /> Autopay <InfoHint term="autopay" />
          </h2>
          <p>
            Couples save a card when they pay their deposit, and the final
            balance charges itself on its due date. A declined card gets the
            invoice link and one retry three days later. QuickBooks records
            every payment.
          </p>
        </div>
        <span className={state.enabled ? "autopay-state is-on" : "autopay-state"}>
          {state.enabled
            ? `On${state.activeCards ? ` · ${state.activeCards} ${state.activeCards === 1 ? "card" : "cards"} saved` : ""}`
            : "Off"}
        </span>
      </header>

      {/* Three steps across, in order. The first two happen in QuickBooks and
          open a guide; the third is the switch here. They used to stack as a
          warning box, a list, and a card nested in the list repeating its
          own title. */}
      <ol className="autopay-stepper">
        <li>
          <OutsideStepCard number={1} status={applyStatus} stepId="quickbooks_payments_apply" />
        </li>
        <li>
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
              number={2}
              status={reconnectStatus}
              stepId="quickbooks_payments_reconnect"
            />
          ) : (
            <div className="autopay-step-local is-blocked">
              <span className="outside-step-tile-number">2</span>
              <strong>Let StudioCue take payments through QuickBooks</strong>
              <em>Connect QuickBooks first, on the Connections tab.</em>
            </div>
          )}
        </li>
        <li>
          <div className={state.enabled ? "autopay-step-local is-done" : state.step >= 3 ? "autopay-step-local" : "autopay-step-local is-blocked"}>
            <span className="outside-step-tile-number">
              {state.enabled ? <CheckCircle2 aria-hidden="true" size={15} /> : 3}
            </span>
            <strong>
              Offer autopay to couples
              <InfoHint label="Offer autopay to couples">
                Couples can then save a card on their payments page. It’s charged on the final invoice’s due date, 14
                days before the event, with one retry after a decline.
              </InfoHint>
            </strong>
            {state.step >= 3 ? (
              <label className="autopay-toggle">
                <input
                  checked={state.enabled}
                  disabled={busy}
                  onChange={(event) => void toggle(event.target.checked)}
                  type="checkbox"
                />
                <span>{state.enabled ? "On — couples can save a card" : "Off — switch on to offer it"}</span>
              </label>
            ) : (
              <em>Available once step 2 is done.</em>
            )}
          </div>
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
