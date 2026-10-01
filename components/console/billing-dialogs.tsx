"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { PLAN_LABELS, PLAN_LIST_PRICE_CENTS, type ConsoleStudio } from "@/features/console/model";
import { money, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { useNow } from "@/lib/console/use-now";
import { stripeCustomerUrl } from "@/lib/console/studio-display";
import { useConsole } from "./console-context";
import type { MenuItem } from "./menu";
import { ConfirmDialog } from "./overlay";
import { Notice } from "./ui";
import { useCommand } from "./use-command";

/**
 * Billing actions on a studio (docs/console.md, "Billing"). Each is a
 * confirmation that says what will happen in Stripe and in StudioCue, takes a
 * reason for the audit log, and runs one Console command.
 */

type Kind = "extend" | "comp" | "uncomp" | "plan" | "discount" | "removeDiscount" | "cancel" | "resume" | "card";
type State = { kind: Kind; studios: ConsoleStudio[] } | null;

export type BillingDialogState = ReturnType<typeof useBillingDialogs>;

const DAY = 86_400_000;
const hasStripe = (studio: ConsoleStudio) =>
  Boolean(studio.stripeSubscriptionId) && ["trialing", "active", "past_due", "paused"].includes(studio.subscriptionStatus ?? "");

export function useBillingDialogs() {
  const { can } = useConsole();
  const [state, setState] = useState<State>(null);
  const open = useCallback((kind: Kind, studios: ConsoleStudio[]) => setState({ kind, studios }), []);
  const close = useCallback(() => setState(null), []);

  const menuItems = useCallback(
    (studio: ConsoleStudio): MenuItem[] => {
      const items: MenuItem[] = [];
      const stripe = stripeCustomerUrl(studio.stripeCustomerId);
      if (can("billing.write")) {
        items.push({ kind: "separator" });
        if (!studio.comped && ["trialing", "incomplete", "active"].includes(studio.subscriptionStatus ?? ""))
          items.push({ label: studio.subscriptionStatus === "active" ? "Give free time…" : "Extend trial…", onSelect: () => open("extend", [studio]) });
        items.push({ label: "Change plan…", onSelect: () => open("plan", [studio]) });
        if (!studio.comped) items.push({ label: studio.discount ? "Replace discount…" : "Apply discount…", onSelect: () => open("discount", [studio]) });
        if (studio.discount && !studio.comped) items.push({ label: "Remove discount…", onSelect: () => open("removeDiscount", [studio]) });
        items.push(studio.comped ? { label: "End comp…", onSelect: () => open("uncomp", [studio]), danger: true } : { label: "Comp this studio…", onSelect: () => open("comp", [studio]) });
        if (hasStripe(studio))
          items.push(
            studio.cancelAtPeriodEnd
              ? { label: "Resume subscription…", onSelect: () => open("resume", [studio]) }
              : { label: "Cancel at period end…", onSelect: () => open("cancel", [studio]), danger: true },
          );
        if (studio.ownerEmail && hasStripe(studio)) items.push({ label: "Send card-update link…", onSelect: () => open("card", [studio]) });
      }
      if (stripe) {
        items.push({ kind: "separator" });
        items.push({ label: "Open in Stripe", hint: "↗", onSelect: () => window.open(stripe, "_blank", "noopener") });
      }
      return items;
    },
    [can, open],
  );

  const bulkButton = useCallback(
    (studios: ConsoleStudio[]) => {
      if (!can("billing.write") || !studios.length) return null;
      const extendable = studios.every((studio) => !studio.comped && ["trialing", "incomplete"].includes(studio.subscriptionStatus ?? ""));
      return extendable ? (
        <button className="cx-btn" onClick={() => open("extend", studios)} type="button">
          Extend trials
        </button>
      ) : null;
    },
    [can, open],
  );

  return { state, open, close, menuItems, bulkButton };
}

type Coupon = { id: string; kind?: string; code?: string; couponId?: string; summary?: string; label?: string | null; active?: boolean; percentOff?: number | null; amountOffCents?: number | null; duration?: string; durationMonths?: number | null };

function dayInput(iso: string | null | undefined, plusDays: number, now: number): string {
  const base = iso && Date.parse(iso) > now ? Date.parse(iso) : now;
  return new Date(base + plusDays * DAY).toISOString().slice(0, 10);
}

function endOfDay(day: string): string | null {
  if (!day) return null;
  const at = new Date(`${day}T23:59:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function BillingDialogs({ state: billing }: { state: BillingDialogState }) {
  const state = billing.state;
  if (!state || !state.studios[0]) return null;
  // Keyed by what was opened, so each dialog starts from that studio's values.
  return <BillingDialogBody billing={billing} key={`${state.kind}:${state.studios.map((studio) => studio.tenantId).join(",")}`} state={state} />;
}

function BillingDialogBody({ billing, state }: { billing: BillingDialogState; state: NonNullable<BillingDialogState["state"]> }) {
  const { run, busy } = useCommand();
  const { toast } = useConsole();
  const now = useNow();
  const studios = state.studios;
  const studio = studios[0]!;
  const [day, setDay] = useState(() => (state.kind === "comp" ? dayInput(null, 90, now) : dayInput(studio.trialEndsAt ?? studio.currentPeriodEnd, 7, now)));
  const [noEnd, setNoEnd] = useState(true);
  const [plan, setPlan] = useState(studio.plan ?? "studio");
  const [cadence, setCadence] = useState<string>(studio.cadence ?? "monthly");
  const [couponId, setCouponId] = useState("");
  const dayId = useId();
  const planId = useId();
  const cadenceId = useId();
  const couponFieldId = useId();
  const coupons = useLiveQuery<Coupon>(state.kind === "discount" ? "coupons:active" : null, (firestore) =>
    query(collection(firestore, "saasDiscounts"), where("kind", "==", "promotion_code"), where("active", "==", true)),
  );
  const couponOptions = useMemo(() => {
    const byCoupon = new Map<string, Coupon>();
    for (const code of coupons.rows ?? []) if (code.couponId && !byCoupon.has(code.couponId)) byCoupon.set(code.couponId, code);
    return [...byCoupon.values()];
  }, [coupons.rows]);

  const close = billing.close;
  const name = studios.length === 1 ? studio.name : `${studios.length} studios`;
  const busyNow = Boolean(busy);

  if (state.kind === "extend") {
    const until = endOfDay(day);
    return (
      <ConfirmDialog
        busy={busyNow}
        confirmLabel={studios.length > 1 ? `Extend ${studios.length} trials` : studio.subscriptionStatus === "active" ? "Give free time" : "Extend trial"}
        description={
          studio.subscriptionStatus === "active"
            ? `${name} won't be charged again until the date you pick. Stripe moves the subscription into a trial until then.`
            : studios.length > 1
              ? "Each studio's trial ends on the date you pick. Studios with a card on file have Stripe's trial moved; the rest get it at their first checkout."
              : hasStripe(studio)
                ? `Stripe moves ${studio.name}'s trial end. Their card isn't charged until then.`
                : `${studio.name} hasn't added a card yet. Their trial will run to this date from their first checkout, instead of the usual 14 days.`
        }
        onClose={close}
        onConfirm={async ({ reason }) => {
          if (!until) return;
          let done = 0;
          for (const item of studios) {
            const result = await run("extendTrial", { tenantId: item.tenantId, until, reason }, { quiet: studios.length > 1, done: `Trial extended to ${shortDate(until)}.` });
            if (result) done += 1;
          }
          if (studios.length > 1) toast(`${done} of ${studios.length} trials extended to ${shortDate(until)}.`, done === studios.length ? "ok" : "bad");
          if (done) close();
        }}
        open
        title={studio.subscriptionStatus === "active" ? "Give free time" : studios.length > 1 ? `Extend ${studios.length} trials` : "Extend trial"}
      >
        <div className="cx-field">
          <label className="cx-label" htmlFor={dayId}>
            New end date
          </label>
          <input className="cx-input" id={dayId} min={new Date(now + DAY).toISOString().slice(0, 10)} onChange={(event) => setDay(event.target.value)} type="date" value={day} />
          {studios.length === 1 && (studio.trialEndsAt ?? studio.currentPeriodEnd) ? <span className="cx-hint">Currently {shortDate(studio.trialEndsAt ?? studio.currentPeriodEnd)}.</span> : null}
        </div>
      </ConfirmDialog>
    );
  }

  if (state.kind === "comp") {
    const until = noEnd ? null : endOfDay(day);
    return (
      <ConfirmDialog
        busy={busyNow}
        confirmLabel="Comp studio"
        description={
          hasStripe(studio)
            ? `${studio.name} keeps its Stripe subscription with a 100% discount${until ? ` until ${shortDate(until)}` : ""}. They're not charged and keep full access.`
            : `${studio.name} gets full access with no card${until ? ` until ${shortDate(until)}, then they're asked to add one` : ""}.`
        }
        onClose={close}
        onConfirm={async ({ reason }) => {
          const result = await run("setComp", { tenantId: studio.tenantId, comped: true, until, reason }, { done: `${studio.name} is comped${until ? ` until ${shortDate(until)}` : ""}.` });
          if (result) close();
        }}
        open
        title={`Comp ${studio.name}`}
      >
        <label className="cx-check">
          <input checked={noEnd} onChange={(event) => setNoEnd(event.target.checked)} type="checkbox" />
          No end date
        </label>
        {!noEnd ? (
          <div className="cx-field">
            <label className="cx-label" htmlFor={dayId}>
              Comp ends
            </label>
            <input className="cx-input" id={dayId} onChange={(event) => setDay(event.target.value)} type="date" value={day} />
          </div>
        ) : null}
      </ConfirmDialog>
    );
  }

  if (state.kind === "uncomp") {
    return (
      <ConfirmDialog
        busy={busyNow}
        confirmLabel="End comp"
        confirmName={studio.name}
        danger
        description={
          hasStripe(studio)
            ? `The 100% discount comes off ${studio.name}'s Stripe subscription. Their card is charged at the next renewal.`
            : `${studio.name} has no card on file. Their studio locks until the owner adds one and starts paying.`
        }
        onClose={close}
        onConfirm={async ({ reason, confirmName }) => {
          const result = await run("setComp", { tenantId: studio.tenantId, comped: false, reason, confirmName }, { done: `Comp ended for ${studio.name}.` });
          if (result) close();
        }}
        open
        title={`End ${studio.name}'s comp`}
      />
    );
  }

  if (state.kind === "plan") {
    const price = PLAN_LIST_PRICE_CENTS[plan]?.[cadence as "monthly" | "yearly"] ?? null;
    return (
      <ConfirmDialog
        busy={busyNow}
        confirmLabel="Change plan"
        description={
          hasStripe(studio) && !studio.comped
            ? "Stripe switches the subscription now and prorates the difference on the next invoice."
            : "Changes the plan and what it includes. There's no Stripe subscription to change."
        }
        onClose={close}
        onConfirm={async ({ reason }) => {
          const result = await run("changePlan", { tenantId: studio.tenantId, plan, cadence, reason }, { done: `${studio.name} is on ${PLAN_LABELS[plan] ?? plan}, ${cadence}.` });
          if (result) close();
        }}
        open
        title={`Change ${studio.name}'s plan`}
      >
        <div className="cx-row-2">
          <div className="cx-field">
            <label className="cx-label" htmlFor={planId}>
              Plan
            </label>
            <select className="cx-select-input" id={planId} onChange={(event) => setPlan(event.target.value)} value={plan}>
              {Object.entries(PLAN_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="cx-field">
            <label className="cx-label" htmlFor={cadenceId}>
              Billing
            </label>
            <select className="cx-select-input" id={cadenceId} onChange={(event) => setCadence(event.target.value)} value={cadence}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        </div>
        {price !== null ? <p className="cx-hint">List price {money(price, { cents: true })} / {cadence === "yearly" ? "year" : "month"}.</p> : null}
        {plan === studio.plan && cadence === studio.cadence ? <Notice tone="warn">That&apos;s the plan they&apos;re on.</Notice> : null}
      </ConfirmDialog>
    );
  }

  if (state.kind === "discount") {
    return (
      <ConfirmDialog
        busy={busyNow}
        confirmLabel="Apply discount"
        description={
          hasStripe(studio)
            ? `Applies to ${studio.name}'s Stripe subscription from the next invoice${studio.discount ? ", replacing the current discount" : ""}.`
            : `${studio.name} hasn't added a card yet. The discount is applied at their first checkout.`
        }
        onClose={close}
        onConfirm={async ({ reason }) => {
          if (!couponId) return;
          const result = await run("applyDiscount", { tenantId: studio.tenantId, couponId, reason }, { done: `Discount applied to ${studio.name}.` });
          if (result) close();
        }}
        open
        title={`Discount for ${studio.name}`}
      >
        <div className="cx-field">
          <label className="cx-label" htmlFor={couponFieldId}>
            Discount
          </label>
          <select className="cx-select-input" id={couponFieldId} onChange={(event) => setCouponId(event.target.value)} value={couponId}>
            <option value="">Choose a discount…</option>
            {couponOptions.map((item) => (
              <option key={item.couponId} value={item.couponId}>
                {item.summary ?? item.code}
                {item.label ? ` · ${item.label}` : item.code ? ` · ${item.code}` : ""}
              </option>
            ))}
          </select>
          <span className="cx-hint">Discounts come from your discount codes. Create one under Billing → Discount codes.</span>
        </div>
      </ConfirmDialog>
    );
  }

  if (state.kind === "removeDiscount") {
    return (
      <ConfirmDialog
        busy={busyNow}
        confirmLabel="Remove discount"
        description={`${studio.name} pays the full price from the next invoice.`}
        onClose={close}
        onConfirm={async ({ reason }) => {
          const result = await run("removeDiscount", { tenantId: studio.tenantId, reason }, { done: `Discount removed from ${studio.name}.` });
          if (result) close();
        }}
        open
        title="Remove discount"
      />
    );
  }

  if (state.kind === "cancel" || state.kind === "resume") {
    const cancel = state.kind === "cancel";
    return (
      <ConfirmDialog
        busy={busyNow}
        confirmLabel={cancel ? "Cancel at period end" : "Resume subscription"}
        confirmName={cancel ? studio.name : null}
        danger={cancel}
        description={
          cancel
            ? `${studio.name} keeps access until ${shortDate(studio.currentPeriodEnd)}, then the subscription ends and the studio locks. Nothing is refunded.`
            : `${studio.name}'s subscription renews on ${shortDate(studio.currentPeriodEnd)} as normal.`
        }
        onClose={close}
        onConfirm={async ({ reason, confirmName }) => {
          const result = await run(
            "setCancelAtPeriodEnd",
            { tenantId: studio.tenantId, cancel, reason, confirmName },
            { done: cancel ? `${studio.name} will cancel on ${shortDate(studio.currentPeriodEnd)}.` : `${studio.name} will renew as normal.` },
          );
          if (result) close();
        }}
        open
        title={cancel ? `Cancel ${studio.name}` : `Resume ${studio.name}`}
      />
    );
  }

  // card
  return (
    <ConfirmDialog
      busy={busyNow}
      confirmLabel="Send link"
      description={`Emails ${studio.ownerName ?? "the owner"} <${studio.ownerEmail}> a link to their subscription page, where they update their card in Stripe. StudioCue never sees the card.`}
      onClose={close}
      onConfirm={async () => {
        const result = await run("sendCardUpdateLink", { tenantId: studio.tenantId }, { done: `Card-update link sent to ${studio.ownerEmail}.` });
        if (result) close();
      }}
      open
      requireReason={false}
      title="Send card-update link"
    />
  );
}

