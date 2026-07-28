"use client";

import { useEffect, useState } from "react";
import { BrainCircuit, CheckCircle2, CreditCard, UsersRound } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { BillingAction } from "@/components/saas/billing-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { planCards } from "@/config/saas-plans";
import { useWorkspace } from "@/features/auth/workspace-context";
import { planEntitlements } from "@/features/subscriptions/entitlements";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

type Subscription = Record<string, unknown>;

export function LiveSubscription() {
  const workspace = useWorkspace();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId) return;
    const { firestore } = getFirebaseClient();
    const period = new Date().toISOString().slice(0, 7);
    const unsubscribeSubscription = onSnapshot(
      doc(firestore, "subscriptions", workspace.tenantId),
      (snapshot) => setSubscription(snapshot.data() ?? {}),
    );
    const unsubscribeUsage = onSnapshot(
      doc(firestore, "usageCounters", `${workspace.tenantId}_${period}`),
      (snapshot) => setUsage(snapshot.data() ?? {}),
    );
    return () => {
      unsubscribeSubscription();
      unsubscribeUsage();
    };
  }, [workspace.tenantId]);
  const plan = String(subscription?.plan ?? "solo");
  const status = String(subscription?.status ?? (dataIsLive ? "loading" : "trialing"));
  const entitlements =
    typeof subscription?.entitlements === "object" &&
    subscription.entitlements !== null
      ? (subscription.entitlements as Record<string, unknown>)
      : { ...planEntitlements.solo };
  const users = Number(subscription?.internalUserCount ?? (dataIsLive ? 0 : 1));
  const maxUsers = Number(entitlements.maxInternalUsers ?? 0);
  const aiActions = Number(usage.aiActions ?? 0);
  const maxAi = Number(entitlements.aiActionsMonthly ?? 0);
  const subcontractors = Number(subscription?.activeSubcontractorCount ?? 0);
  const maxSubcontractors = entitlements.maxActiveSubcontractors;
  return (
    <div className="saas-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Plan & usage</p>
          <h1>Subscription</h1>
          <p>Manage your plan and billing securely through Stripe.</p>
        </div>
        <StatusBadge tone={["active", "trialing"].includes(status) ? "success" : "warning"}>
          {status.replaceAll("_", " ")} · {plan.replaceAll("_", " ")}
        </StatusBadge>
      </header>
      <section className="usage-grid">
        <article className="panel usage-card">
          <span className="usage-card-icon"><UsersRound /></span>
          <span>
            <small>Internal users</small>
            <strong>{users} / {maxUsers || "—"}</strong>
            <em>Team seats in use</em>
            <i><b style={{ width: `${maxUsers ? Math.min(100, (users / maxUsers) * 100) : 0}%` }} /></i>
          </span>
        </article>
        <article className="panel usage-card">
          <span className="usage-card-icon"><BrainCircuit /></span>
          <span>
            <small>AI actions · current month</small>
            <strong>{aiActions.toLocaleString()} / {maxAi ? maxAi.toLocaleString() : "—"}</strong>
            <em>Resets each billing month</em>
            <i><b style={{ width: `${maxAi ? Math.min(100, (aiActions / maxAi) * 100) : 0}%` }} /></i>
          </span>
        </article>
        <article className="panel usage-card">
          <span className="usage-card-icon"><CheckCircle2 /></span>
          <span>
            <small>Active subcontractors</small>
            <strong>{subcontractors} · {maxSubcontractors === null ? "Unlimited" : String(maxSubcontractors ?? "—")}</strong>
            <em>Current entitlement</em>
          </span>
        </article>
      </section>
      <section className="subscription-plan-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Plans</p>
            <h2>Choose the operating capacity your studio needs</h2>
            <p>Upgrade or change cadence without contacting support.</p>
          </div>
        </div>
        <div className="plan-grid">
          {planCards.map((card) => (
            <article className={`panel plan-card plan-card-${card.key} ${card.key === plan ? "is-current" : ""}`} key={card.key}>
              <div>
                <span>
                  <small>{card.key === "studio" ? "Most popular" : "StudioCue plan"}</small>
                  <h2>{card.name}</h2>
                </span>
                {card.key === plan ? <StatusBadge tone="success">Current</StatusBadge> : null}
              </div>
              <strong>{card.monthly}<small>/month</small></strong>
              <p>or {card.yearly} annually · two months free</p>
              <ul>
                <li>{card.users}</li>
                <li>{card.ai}</li>
                {card.features.slice(0, 2).map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <div className="plan-billing-actions">
                <BillingAction plan={card.key} cadence="monthly" label={`${card.name} monthly`} />
                <BillingAction plan={card.key} cadence="yearly" label={`${card.name} annual`} />
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel billing-boundary">
        <div>
          <CreditCard />
          <span>
            <strong>Payment details stay with Stripe.</strong>
            <small>StudioCue stores customer, subscription, price, status, and period references—never card or bank credentials.</small>
          </span>
        </div>
        <BillingAction label="Open customer portal" />
      </section>
    </div>
  );
}
