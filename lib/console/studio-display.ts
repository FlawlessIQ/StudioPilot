import { PLAN_LABELS, SUBSCRIPTION_STATUS, type ConsoleStudio, type Tone } from "@/features/console/model";
import { daysUntil, relative, shortDate } from "./format";

/** How a studio's plan, subscription and next billing moment read in a table. */

export function planLabel(plan: string | null, cadence?: string | null): string {
  if (!plan) return "—";
  const name = PLAN_LABELS[plan] ?? plan;
  return cadence ? `${name} · ${cadence === "yearly" ? "yr" : "mo"}` : name;
}

export function subscriptionBadge(status: string | null, comped = false): { label: string; tone: Tone } {
  if (comped) return { label: "Comped", tone: "accent" };
  return SUBSCRIPTION_STATUS[status ?? ""] ?? { label: status ? status.replace(/_/g, " ") : "None", tone: "neutral" };
}

/** "ends in 3d", "renews 12 Mar", "cancels 30 Oct", "comp ends 31 Dec", "ended 14 Sep". */
export function billingMomentText(moment: ConsoleStudio["billingMoment"] | undefined, now = Date.now()): { text: string; urgent: boolean } {
  if (!moment || !moment.at || moment.kind === "none") return { text: "—", urgent: false };
  const days = daysUntil(moment.at, now) ?? 99;
  switch (moment.kind) {
    case "trial_ends":
      return days < 0 ? { text: `trial ended ${relative(moment.at, now)}`, urgent: true } : { text: `ends ${relative(moment.at, now)}`, urgent: days <= 7 };
    case "renews":
      return { text: `renews ${shortDate(moment.at, now)}`, urgent: false };
    case "cancels":
      return { text: `cancels ${shortDate(moment.at, now)}`, urgent: days <= 14 };
    case "comp_ends":
      return { text: `comp ends ${shortDate(moment.at, now)}`, urgent: days <= 14 };
    case "ended":
      return { text: `ended ${shortDate(moment.at, now)}`, urgent: false };
    default:
      return { text: "—", urgent: false };
  }
}

export function studioHref(tenantId: string, tab?: string): string {
  return `/platform-admin/studios/${encodeURIComponent(tenantId)}${tab ? `?tab=${tab}` : ""}`;
}

export function personHref(uid: string): string {
  return `/platform-admin/people/${encodeURIComponent(uid)}`;
}

export function stripeCustomerUrl(customerId: string | null): string | null {
  return customerId ? `https://dashboard.stripe.com/customers/${encodeURIComponent(customerId)}` : null;
}

export function stripeSubscriptionUrl(subscriptionId: string | null): string | null {
  return subscriptionId ? `https://dashboard.stripe.com/subscriptions/${encodeURIComponent(subscriptionId)}` : null;
}

/** A CSV of rows, quoted properly. */
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
