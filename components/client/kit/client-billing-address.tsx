"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MapPin } from "lucide-react";
import { Button, ButtonRow, Card } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { dataIsLive } from "@/lib/runtime-mode";
import { confirmBillingAddress, getBillingAddressRequest } from "@/lib/client/portal-client";
import { BillingAddressStep, useBillingAddressStep } from "@/components/client/billing-address-step";

/**
 * "Could you confirm your billing address?" — on the couple's home page.
 *
 * Shown only while the studio needs it and the couple's own contact has
 * none (server/billing/billing-address-request.ts): couples who signed
 * before the studio charged QuickBooks sales tax, or whose booking was
 * imported. The email that asks (functions/src/billing/billing-address-
 * request.ts) links here with ?billing-address=1, which brings the card into
 * view. The same form as at signing.
 */
export function ClientBillingAddress() {
  const workspace = useWorkspace();
  const [needed, setNeeded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const billing = useBillingAddressStep({
    tenantId: workspace.tenantId,
    projectId: workspace.projectId,
    kind: "contract",
    active: needed,
    missingMessage: "Add your street address and city.",
  });

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !workspace.projectId) return;
    let live = true;
    void getBillingAddressRequest(workspace.tenantId, workspace.projectId)
      .then((result) => live && setNeeded(result.needed))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [workspace.tenantId, workspace.projectId]);

  // Arrived from the email: bring the card into view once it's there.
  useEffect(() => {
    if (!needed || !billing.ready || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).has("billing-address"))
      card.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [billing.ready, needed]);

  if (saved)
    return (
      <Card tone="accent">
        <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
          <CheckCircle2 aria-hidden size={14} /> Billing address saved
        </p>
        <p className="kit-body">Thank you — it&rsquo;s on your record, and nothing else is needed.</p>
      </Card>
    );
  if (!needed || !billing.ready || billing.step !== "required") return null;
  const studio = workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "Your studio";

  async function save() {
    if (!workspace.tenantId || !workspace.projectId) return;
    const answer = billing.answer();
    if (!answer.ok) return setError(answer.message);
    if (!answer.address) return setError("Add your street address and city.");
    setBusy(true);
    setError(null);
    try {
      await confirmBillingAddress(workspace.tenantId, workspace.projectId, answer.address);
      setSaved(true);
    } catch (caught) {
      // The form checks the address the way the server does, so this is
      // nearly always the connection.
      setError(
        caught instanceof Error && caught.message === "BILLING_ADDRESS_INVALID"
          ? "Check the state and ZIP code, then save again."
          : "Your address didn't save. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={card}>
      <Card tone="accent">
        <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
          <MapPin aria-hidden size={14} /> {`${studio} asked for this`}
        </p>
        <BillingAddressStep billing={billing} />
        {error ? (
          <p className="kit-error" role="alert">
            {error}
          </p>
        ) : null}
        <ButtonRow>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save my billing address"}
          </Button>
        </ButtonRow>
      </Card>
    </div>
  );
}
