/**
 * The "Write a one-off package" form, read into the `createOneOffPackage`
 * command (features/packages/one-off.ts has the why). Pure, so the proposal
 * Packages panel and the composer refuse the same things in the same words,
 * before anything is sent.
 */
import type { CoverageItem } from "@/features/packages/coverage";
import { oneOffInclusionLines } from "@/features/packages/one-off";
import { isPaymentShape, type PaymentShape } from "@/features/job-kinds/job-kinds";

export type OneOffFormValues = {
  name: string;
  /** Dollars as typed: "2,500" or "$2500.00". */
  price: string;
  /** One item per line. */
  included: string;
  /** Blank means "leave it to the defaults". */
  photographers: string;
  videographers: string;
  hours: string;
  mode: "add" | "replace";
  saveToLibrary: boolean;
  /** How it is paid; blank follows the kind of job (job-kinds.ts). */
  paymentShape?: PaymentShape | "";
};

/** The command's input, less the job. */
export type OneOffPackageInput = {
  name: string;
  basePriceCents: number;
  included: string[];
  includedCoverage?: CoverageItem[];
  includedCoverageMinutes?: number;
  mode: "add" | "replace";
  saveToLibrary: boolean;
  paymentShape?: PaymentShape;
};

/**
 * Dollars as typed to integer cents. "$2,500" and "2500.5" are fine; a
 * negative, a word or nothing at all is null rather than NaN or zero.
 */
export function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function count(value: string): number | null | "bad" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "bad";
  const number = Number(trimmed);
  return number <= 50 ? number : "bad";
}

export function parseOneOffForm(
  values: OneOffFormValues,
): { ok: true; input: OneOffPackageInput } | { ok: false; message: string } {
  const name = values.name.trim();
  if (name.length < 2) return { ok: false, message: "Give the package a name." };
  if (name.length > 120) return { ok: false, message: "Keep the name under 120 characters." };
  const basePriceCents = dollarsToCents(values.price);
  if (basePriceCents === null) return { ok: false, message: "Give it a price, in dollars — 2500 or 2,500.00." };
  const included = oneOffInclusionLines(values.included);
  if (!included.length) return { ok: false, message: "Say what's included — one item per line." };
  // The package's description is these lines, and a description says a
  // little more than a word or two.
  if (included.join("\n").length < 10) return { ok: false, message: "Say a little more about what's included." };
  const photographers = count(values.photographers);
  const videographers = count(values.videographers);
  if (photographers === "bad" || videographers === "bad") {
    return { ok: false, message: "Photographers and videographers are whole numbers, up to 50." };
  }
  let includedCoverage: CoverageItem[] | undefined;
  if (photographers !== null || videographers !== null) {
    includedCoverage = [
      ...(photographers ? [{ role: "photographer" as const, count: photographers }] : []),
      ...(videographers ? [{ role: "videographer" as const, count: videographers }] : []),
    ];
    if (!includedCoverage.length) {
      return { ok: false, message: "A package sends at least one photographer or videographer." };
    }
  }
  let includedCoverageMinutes: number | undefined;
  if (values.hours.trim()) {
    const hours = Number(values.hours.trim());
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return { ok: false, message: "Hours of coverage are between 0 and 24 — 8, or 7.5." };
    }
    includedCoverageMinutes = Math.max(1, Math.round(hours * 60));
  }
  return {
    ok: true,
    input: {
      name,
      basePriceCents,
      included,
      ...(includedCoverage ? { includedCoverage } : {}),
      ...(includedCoverageMinutes ? { includedCoverageMinutes } : {}),
      mode: values.mode,
      saveToLibrary: values.saveToLibrary,
      ...(isPaymentShape(values.paymentShape) ? { paymentShape: values.paymentShape } : {}),
    },
  };
}

/**
 * The form filled in from a one-off already written — its package document,
 * or the job's snapshot of it — for "Edit" on the job's Packages panel
 * (updateOneOffPackage). Reads back through `parseOneOffForm` to the same
 * name, price, bullets and coverage.
 */
export function oneOffFormValuesFrom(record: unknown): OneOffFormValues {
  const row = typeof record === "object" && record !== null ? (record as Record<string, unknown>) : {};
  const name =
    typeof row.name === "string" ? row.name : typeof row.packageName === "string" ? row.packageName : "";
  const cents =
    typeof row.basePriceCents === "number" && Number.isSafeInteger(row.basePriceCents) && row.basePriceCents >= 0
      ? row.basePriceCents
      : null;
  const price = cents === null ? "" : cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  const lines = Array.isArray(row.includedDeliverables)
    ? row.includedDeliverables.filter((line): line is string => typeof line === "string")
    : [];
  const included = lines.length ? lines.join("\n") : typeof row.description === "string" ? row.description : "";
  const coverage = Array.isArray(row.includedCoverage) ? (row.includedCoverage as Array<Record<string, unknown>>) : [];
  const countOf = (role: string) => {
    const found = coverage.find((item) => item.role === role);
    return typeof found?.count === "number" && found.count > 0 ? String(found.count) : "";
  };
  const legacyPhotographers =
    typeof row.includedPhotographers === "number" && row.includedPhotographers > 0
      ? String(row.includedPhotographers)
      : "";
  const minutes = typeof row.includedCoverageMinutes === "number" ? row.includedCoverageMinutes : 0;
  return {
    name,
    price,
    included,
    photographers: coverage.length ? countOf("photographer") : legacyPhotographers,
    videographers: coverage.length ? countOf("videographer") : "",
    hours: minutes > 0 ? String(Math.round((minutes / 60) * 100) / 100) : "",
    mode: "add",
    saveToLibrary: false,
  };
}
